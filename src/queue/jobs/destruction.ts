/**
 * Deferred destruction and hold expiry (CCB-S3-013).
 *
 * When a member asks for deletion and an evidence hold defers part of it, the
 * request must not evaporate. Two job types carry it:
 *
 *   `destruction.run` - destroy one message, if nothing blocks it any more.
 *   `hold.expire`     - a time-boxed hold lapses, and whatever it was deferring
 *                       proceeds.
 *
 * WHY BOTH HANDLERS RE-READ STATE INSTEAD OF TRUSTING THE PAYLOAD. Between
 * enqueue and run, an operator may have escalated the hold, released it, or
 * destroyed the item themselves; a dead-lettered job may be revived from a future
 * admin page by someone who cannot see what it would erase. The payload is a
 * pointer to work, never authority to do it. `retryJob` in particular resurrects
 * ANY dead job with no idea what it destroys, so the authority has to be checked
 * here, every run.
 *
 * Payloads carry internal ids ONLY. The jobs table is never pruned, so a payload
 * containing a display name or a media path would outlive the erasure it
 * performed and leave that identifier in the database afterwards.
 */

import { destroyMessage } from '../../archive/destroy.js';
import { liveHold, resolveHold } from '../../db/holds.js';
import { getPool, withTransaction } from '../../db/pool.js';
import { loadConfig } from '../../config.js';
import { log } from '../../log.js';
import { status } from '../../web/status.js';
import { enqueueJob } from '../store.js';
import { PermanentJobError, type JobHandler } from '../types.js';

/** The stable job types. */
export const DESTRUCTION_RUN_JOB = 'destruction.run';
export const HOLD_EXPIRE_JOB = 'hold.expire';

export function destructionRunKey(messageId: number): string {
  return `destruction.run:${messageId}`;
}

export function holdExpireKey(holdId: number): string {
  return `hold.expire:${holdId}`;
}

/**
 * Destroys one message whose deletion the member already asked for.
 *
 * Idempotent and convergent: a message that is already gone, or that was never
 * pending, is a no-op. A message still under a live hold is left alone WITHOUT
 * failing - the hold's release or expiry re-enqueues this job, so retrying here
 * would only burn the attempt budget and dead-letter a request that is merely
 * waiting.
 */
export const destructionRunHandler: JobHandler = async (payload) => {
  const messageId = Number(payload['messageId']);
  if (!Number.isFinite(messageId)) {
    throw new PermanentJobError(
      `destruction.run: invalid payload (messageId ${String(payload['messageId'])}).`,
    );
  }
  const db = getPool();

  // The member's standing request. Its absence means the request was already
  // fulfilled (the row cascade removed it) or withdrawn - either way, nothing to do.
  const { rows } = await db.query<{ message_id: string }>(
    'SELECT message_id FROM pending_destructions WHERE message_id = $1',
    [messageId],
  );
  if (rows.length === 0) return;

  const hold = await liveHold(db, messageId);
  if (hold) {
    log.info(
      `Queue: destruction of message ${messageId} stays deferred, ${hold.state} evidence hold ${hold.id}.`,
    );
    return;
  }

  const mediaRoot = loadConfig().mediaRoot;
  const result = await withTransaction((tx) => destroyMessage(tx, mediaRoot, messageId));
  if (result.destroyed) {
    log.info(
      `Queue: deferred destruction of message ${messageId} completed (${result.filesRemoved} file(s)).`,
    );
  }
};

/**
 * Lapses a time-boxed hold and lets any deferred deletion proceed.
 *
 * Scheduled with `runAt = expires_at`, so it fires on the Postgres clock: a
 * process that is down when a hold expires does not miss it, the job is simply
 * claimed on the next poll after restart.
 *
 * An escalated hold is never expired here. `resolveHold` only matches a live row
 * and the handler re-checks the state first, so an escalation between enqueue and
 * run wins - which is the point of escalation.
 */
export const holdExpireHandler: JobHandler = async (payload) => {
  const holdId = Number(payload['holdId']);
  if (!Number.isFinite(holdId)) {
    throw new PermanentJobError(`hold.expire: invalid payload (holdId ${String(payload['holdId'])}).`);
  }
  const db = getPool();

  const { rows } = await db.query<{
    id: string;
    message_id: string;
    state: string;
    expires_at: string | null;
  }>('SELECT id, message_id, state, expires_at FROM evidence_holds WHERE id = $1', [holdId]);
  const row = rows[0];
  if (!row) return;

  if (row.state !== 'active') {
    // Escalated, or already resolved by the operator. Both outrank the clock.
    return;
  }
  if (!row.expires_at || new Date(row.expires_at).getTime() > Date.now()) {
    // The hold was extended or cleared of its expiry after this job was scheduled.
    log.info(`Queue: hold ${holdId} is no longer due to expire; leaving it active.`);
    return;
  }

  const resolved = await resolveHold(db, holdId, 'expired', 'system');
  if (!resolved) return;

  const messageId = Number(row.message_id);
  log.warn(
    `Queue: evidence hold ${holdId} on message ${messageId} expired without an operator decision ` +
      `and has been released. Any deferred deletion now proceeds.`,
  );
  // A hold that lapses by neglect rather than by decision is worth the operator
  // seeing, because the review it was protecting never happened.
  status.error(
    `An evidence hold on message ${messageId} expired before it was reviewed. The hold has lapsed ` +
      `and any deletion the member asked for will now run.`,
  );

  await enqueueDestructionFor(messageId);
};

/**
 * Enqueues the destruction of one message, if the member asked for it.
 *
 * Exported so the hold-release paths (operator release, expiry) share exactly one
 * way of letting a deferred deletion proceed.
 */
export async function enqueueDestructionFor(messageId: number): Promise<void> {
  const db = getPool();
  const { rows } = await db.query('SELECT 1 FROM pending_destructions WHERE message_id = $1', [
    messageId,
  ]);
  if (rows.length === 0) return;
  // Enqueued through the store rather than the `queue/index.ts` helper, because
  // that module imports this one to register the handler.
  await enqueueJob(db, DESTRUCTION_RUN_JOB, {
    idempotencyKey: destructionRunKey(messageId),
    lane: 'interactive',
    payload: { messageId },
  });
}
