/**
 * Destruction: the half of revocation that actually erases (CCB-S3-013 Part A).
 *
 * HIDE is already fully expressed by the derived publish model - `revoked_at` is
 * set and every public path stops selecting the member's messages. Nothing in
 * this file is involved in that. This is only the DELETE branch: the member asked
 * for the content to be gone, not merely unpublished.
 *
 * ORDER OF OPERATIONS, and why it is this way round.
 *
 * The row is deleted FIRST, then the files are unlinked, and both happen inside
 * ONE transaction supplied by the caller. That ordering is load-bearing:
 *
 *  - The DB trigger installed by `migrations/020` raises if a live evidence hold
 *    exists. Deleting the row first means that guard fires BEFORE a single byte is
 *    unlinked, so a held item cannot lose its media to a destroy that was going to
 *    be refused anyway. Checking the hold in application code instead would leave
 *    a window between the check and the unlink.
 *  - The file paths live only on the row being deleted, so they are enumerated
 *    before anything is touched (`filesOwnedBy`).
 *  - An unlink failure THROWS, which rolls the row deletion back. The alternative
 *    (row gone, bytes present) is the one outcome that is unrecoverable by retry:
 *    with the row deleted, nothing can ever find those files again.
 *
 * So the states this can end in are: everything destroyed, or nothing destroyed
 * and a fault raised. Never half.
 *
 * IDEMPOTENCE. A retry after a crash re-enumerates from whatever survived. A file
 * that is already gone is not an error (ENOENT), a row that is already gone means
 * there is nothing left to enumerate, so re-running converges rather than failing.
 */

import { unlink } from 'node:fs/promises';

import { liveHold } from '../db/holds.js';
import type { Queryable } from '../db/pool.js';
import { log } from '../log.js';
import { forgetMediaFailures } from '../media/failures.js';
import { filesOwnedBy } from '../media/owned-files.js';
import { status } from '../web/status.js';

export interface DestroyResult {
  /** False when the message was already gone (a converged retry, not a failure). */
  destroyed: boolean;
  filesRemoved: number;
}

/**
 * Records that a member wants this message destroyed once nothing blocks it.
 *
 * The intent is persisted rather than living only in a queue job, so a dead
 * letter, a cancelled job or a restart cannot lose it. "The member must not have
 * to ask twice."
 */
export async function recordPendingDestruction(
  db: Queryable,
  messageId: number,
  memberId: string,
  requestedBy: 'member' | 'operator',
): Promise<void> {
  await db.query(
    `INSERT INTO pending_destructions (message_id, member_id, requested_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (message_id) DO NOTHING`,
    [messageId, memberId, requestedBy],
  );
}

/** Message ids this member asked to destroy that are still waiting. */
export async function pendingDestructionIds(
  db: Queryable,
  memberId: string,
): Promise<number[]> {
  const { rows } = await db.query<{ message_id: string }>(
    'SELECT message_id FROM pending_destructions WHERE member_id = $1 ORDER BY message_id',
    [memberId],
  );
  return rows.map((r) => Number(r.message_id));
}

/** Every message id belonging to a member, newest first. */
export async function memberMessageIds(db: Queryable, memberId: string): Promise<number[]> {
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM messages WHERE sender_member_id = $1 ORDER BY id',
    [memberId],
  );
  return rows.map((r) => Number(r.id));
}

/**
 * Destroys one message: its row, everything that cascades from it, and every file
 * it owns on disk.
 *
 * `db` MUST be inside a transaction. On any failure this throws, and the caller's
 * rollback is what keeps the row and its bytes consistent with each other.
 *
 * What the row deletion takes with it, by cascade: `links`, `message_mentions`,
 * `reports` (including the reporter's free-text note), `pending_destructions`,
 * resolved `evidence_holds`, and - through `messages.reply_to_id` - Cinderella's
 * paired answer to a destroyed member question. The generated `search` tsvector
 * and its GIN entry go with the row too, so there is no separate index to purge.
 */
export async function destroyMessage(
  db: Queryable,
  mediaRoot: string,
  messageId: number,
): Promise<DestroyResult> {
  // Enumerated first: `media_path` and `media_derived_path` exist only on the row
  // that is about to be deleted.
  const owned = await filesOwnedBy(db, mediaRoot, messageId);
  if (owned.rejected.length > 0) {
    throw new Error(
      `destroy: message ${messageId} has stored media path(s) outside the media root; refusing to destroy ` +
        `while bytes would be left behind.`,
    );
  }

  // Raises `restrict_violation` from the trigger if a live hold exists. Nothing
  // has been unlinked at this point.
  const { rowCount } = await db.query('DELETE FROM messages WHERE id = $1', [messageId]);
  if ((rowCount ?? 0) === 0) {
    // Already destroyed by an earlier attempt. Files named after the id may still
    // be present if that attempt died between the delete and the unlink, so they
    // are still swept below.
    let swept = 0;
    for (const p of owned.paths) if (await unlinkOne(p, messageId)) swept += 1;
    forgetMediaFailures(messageId);
    return { destroyed: false, filesRemoved: swept };
  }

  let removed = 0;
  for (const p of owned.paths) if (await unlinkOne(p, messageId)) removed += 1;

  // The dashboard's media-failure list is keyed by message id and is in memory,
  // so a destroyed message would otherwise keep appearing there until restart.
  forgetMediaFailures(messageId);

  log.info(
    `Archive: destroyed message ${messageId} (${removed} file(s) removed from the media store).`,
  );
  return { destroyed: true, filesRemoved: removed };
}

/**
 * Unlinks one file. Returns whether it was actually removed.
 *
 * ENOENT is success: the file is gone, which is the goal. Anything else is a
 * FAULT and is rethrown - a permission error swallowed as "already gone" would
 * report a successful erasure over bytes that are still on disk, which is exactly
 * the masking the standing rule forbids.
 */
async function unlinkOne(absPath: string, messageId: number): Promise<boolean> {
  try {
    await unlink(absPath);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return false;
    status.error(
      `Destruction of message ${messageId} could not remove a media file (${code ?? 'unknown'}). ` +
        `The deletion was rolled back and will be retried; the content is not public in the meantime.`,
    );
    // The errno ONLY, never `err.message`: Node embeds the absolute path in it
    // ("EACCES: permission denied, unlink '<abs>'"), and that path contains the
    // member's own uploaded filename. This error becomes `jobs.last_error`, which
    // nothing prunes, so the untouched message would leave the very identifier the
    // destruction was meant to erase sitting in the database afterwards.
    throw new Error(
      `destroy: unlink failed for message ${messageId} (${code ?? 'unknown'}); path withheld.`,
    );
  }
}

/**
 * Whether this message can be destroyed right now, and why not if it cannot.
 *
 * Advisory only - the binding check is the DB trigger. This exists so the member
 * can be told honestly which of their items are deferred, and so the admin can
 * render the right controls, without either of them having to provoke an
 * exception to find out.
 */
export async function destructionBlockedBy(
  db: Queryable,
  messageId: number,
): Promise<'hold' | 'escalated' | null> {
  const hold = await liveHold(db, messageId);
  if (!hold) return null;
  return hold.state === 'escalated' ? 'escalated' : 'hold';
}
