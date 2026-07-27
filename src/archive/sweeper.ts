/**
 * The safety net under deferred destruction (CCB-S3-013, adversarial review).
 *
 * The queue actuates deletions; this makes sure none of them can be forgotten.
 * Three ways a member's erasure request could otherwise stall forever, all found
 * by review rather than in production:
 *
 *  1. **A hold whose expiry job never ran.** `placeHold` and `enqueueHoldExpiry`
 *     are two statements. If the enqueue failed, or the job was later cancelled or
 *     dead-lettered, the hold stayed `active` past `expires_at` with nothing left
 *     to lapse it, and the deletion behind it waited on a review that had already
 *     timed out.
 *  2. **A destruction blocked by a hold on a DIFFERENT row.** The delete of a
 *     member's question cascades into Cinderella's reply; a hold on that reply
 *     aborts the whole delete. Releasing the reply's hold enqueues destruction for
 *     the REPLY's id, and nothing ever went back for the question.
 *  3. **A destruction that failed for a transient reason** and exhausted its
 *     retries, or failed before anything was enqueued at all.
 *
 * In every case the durable record of intent (`pending_destructions`) survives.
 * This sweep reads that record and re-enqueues whatever is now unblocked, so the
 * queue's job is to be fast and this one's job is to be certain.
 *
 * Deliberately dumb and idempotent: it enqueues on the same idempotency keys, so a
 * job already queued is a no-op, and it never destroys anything itself.
 */

import { expiredHolds, liveHold, resolveHold } from '../db/holds.js';
import type { Queryable } from '../db/pool.js';
import { log } from '../log.js';
import { enqueueDestructionRun } from '../queue/index.js';
import { status } from '../web/status.js';
import { sweepFileStubs } from '../bot/file-stubs.js';

export interface SweepResult {
  holdsExpired: number;
  destructionsQueued: number;
  /** Abandoned receipt placeholders removed from the files folder (CCB-S3-027 §4). */
  stubsRemoved: number;
}

/**
 * Lapses holds whose time is up and re-queues every unblocked deletion.
 *
 * Escalations and hash-match quarantines are structurally excluded from the
 * expiry half (`expires_at IS NULL`), so nothing here can lift one.
 */
export async function sweepDestructions(
  db: Queryable,
  filesFolder?: string,
): Promise<SweepResult> {
  let holdsExpired = 0;
  let destructionsQueued = 0;
  let stubsRemoved = 0;

  for (const hold of await expiredHolds(db)) {
    const resolved = await resolveHold(db, hold.id, 'expired', 'system');
    if (!resolved) continue;
    holdsExpired += 1;
    log.warn(
      `Sweep: evidence hold ${hold.id} on message ${hold.messageId} expired without an operator ` +
        `decision and has been released.`,
    );
    // A hold that lapses by neglect rather than by decision is worth surfacing:
    // the review it was protecting never happened.
    status.error(
      `An evidence hold on message ${hold.messageId} expired before it was reviewed. Any deletion ` +
        `the member asked for will now run.`,
    );
  }

  // Every outstanding request, not only the ones whose own hold just lapsed. This
  // is what catches a destruction blocked by a hold on a row it cascades into.
  const { rows } = await db.query<{ message_id: string }>(
    'SELECT message_id FROM pending_destructions ORDER BY requested_at',
  );
  for (const row of rows) {
    const messageId = Number(row.message_id);
    if (await liveHold(db, messageId)) continue;
    await enqueueDestructionRun(db, messageId);
    destructionsQueued += 1;
  }

  // Abandoned receipt placeholders (CCB-S3-027 §4). A failed receipt leaves a
  // zero-byte file named after the member's own device filename; that name is
  // member metadata and outlives any erasure request. Swept here because a
  // destroyed message's placeholder is already removed by the core deletion, and
  // everything else has no per-message handle to hang an unlink on.
  if (filesFolder) {
    try {
      stubsRemoved = (await sweepFileStubs(filesFolder)).removed;
    } catch (err) {
      log.error(
        `Sweep: could not sweep receipt placeholders: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (holdsExpired > 0 || destructionsQueued > 0 || stubsRemoved > 0) {
    log.info(
      `Sweep: ${holdsExpired} hold(s) expired, ${destructionsQueued} pending destruction(s) queued, ` +
        `${stubsRemoved} receipt placeholder(s) removed.`,
    );
  }
  return { holdsExpired, destructionsQueued, stubsRemoved };
}

/** How often the sweep runs. Deliberately unhurried: it is a backstop, not the path. */
export const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Starts the periodic sweep and runs one immediately.
 *
 * The boot run matters as much as the interval: a process that was down when a
 * hold expired, or that died mid-destruction, resolves it on the way back up.
 */
export function startDestructionSweeper(db: Queryable, filesFolder?: string): NodeJS.Timeout {
  const run = (): void => {
    void sweepDestructions(db, filesFolder).catch((err: unknown) => {
      // The sweep is the backstop for a consent guarantee, so its own failure has
      // to be visible rather than leaving everything quietly unswept.
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Sweep: the destruction sweep failed: ${message}`);
      status.error(`The deferred-destruction sweep failed: ${message}`);
    });
  };
  run();
  const timer = setInterval(run, SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}
