/**
 * Lifting a timed mute (CCB-S4-035, D-139).
 *
 * ── WHY THE EXISTING QUEUE AND NOT A NEW SCHEDULER ───────────────────────────
 *
 * The briefing says to reuse it, and the reasons are the ones the queue was built for
 * (CCB-S3-022). A `setTimeout` dies with the process, so a restart during a ten minute
 * mute would leave a member silenced permanently with nothing anywhere recording that
 * something was owed. The queue is Postgres-backed, survives restarts, retries with
 * backoff, and dead-letters visibly. A mute is exactly the kind of promise that must
 * outlive the process that made it.
 *
 * ── THE THREE WAYS THIS CAN BE RUN TWICE, AND WHY NONE OF THEM DOUBLE-RESTORE ─
 *
 * The queue contract is at-least-once, so idempotence is required rather than nice. It
 * can happen here three ways: a crash between the role change and the row update, a
 * retry after a transient core failure, and an operator clicking undo at the moment the
 * job fires. All three converge, because:
 *
 *   1. The row is re-read at run time, never trusted from the payload. A sanction undone
 *      by hand since the job was enqueued is seen as undone.
 *   2. `markSanctionExpired` guards in its WHERE clause, so a second writer matches no
 *      rows and is told so, rather than both writers passing a read-then-write check.
 *   3. Setting a role to what it already is, is what the SDK does anyway. The worst case
 *      of a genuine double run is one redundant call that changes nothing.
 *
 * The order is act-then-mark, matching `applySanction`. Marking first would mean a row
 * saying the mute was lifted while the member is still an observer, which is the same lie
 * in the opposite direction.
 *
 * ── IDENTIFIERS ONLY IN THE PAYLOAD ──────────────────────────────────────────
 *
 * `jobs.payload` and `jobs.last_error` are never pruned, so a display name here would
 * outlive the sanction it belongs to. The payload is one opaque row id.
 */

import { EnforcementUnavailableError, enforcementAvailable, liveEnforcementPort } from '../../bot/enforcement.js';
import { getPool, type Queryable } from '../../db/pool.js';
import { log } from '../../log.js';
import { restoreSanction } from '../../moderation/apply.js';
import { findSanction, markSanctionExpired } from '../../moderation/store.js';
import { status } from '../../web/status.js';
import { PermanentJobError, type JobHandler } from '../types.js';

/** The stable job type. */
export const MODERATION_EXPIRE_JOB = 'moderation.expire';

export function moderationExpireKey(sanctionId: string): string {
  return `moderation.expire:${sanctionId}`;
}

/**
 * Built with the db handed in at registration, exactly like the other handlers, so the
 * job never reaches for a global pool that a harness has not set up.
 */
export function makeModerationExpireHandler(db: Queryable): JobHandler {
  return async (payload) => {
    // Narrowed rather than stringified. A payload written by a different version, or by
    // hand, must fail as an invalid payload rather than dead-lettering against a sanction
    // literally named "[object Object]".
    const raw = payload['sanctionId'];
    const sanctionId = typeof raw === 'string' ? raw : typeof raw === 'number' ? String(raw) : '';
    if (!sanctionId) {
      throw new PermanentJobError('moderation.expire: payload carries no sanction id.');
    }

    const row = await findSanction(db, sanctionId, new Date());
    if (!row) {
      // The row is gone. Nothing to lift and nothing that retrying could fix.
      throw new PermanentJobError(
        `moderation.expire: sanction ${sanctionId} no longer exists.`,
      );
    }

    if (!enforcementAvailable()) {
      // TRANSIENT. The bot may be starting, or stopped while the console stays up.
      // Dead-lettering here would leave somebody muted over a restart, which is the
      // failure this whole job exists to prevent.
      throw new EnforcementUnavailableError();
    }

    const outcome = await restoreSanction(db, liveEnforcementPort, row);

    if (outcome.status === 'already') {
      log.info(`Moderation: expiry for sanction ${sanctionId} was a no-op, ${outcome.note}.`);
      return;
    }
    if (outcome.status === 'nothing-to-do') {
      // A block or a remove has no timed reversal, and a row carrying no previous role
      // cannot be restored. Neither will ever succeed, so neither is retried.
      throw new PermanentJobError(`moderation.expire: ${outcome.note}.`);
    }

    // Marked only after the role is actually back.
    const marked = await markSanctionExpired(db, sanctionId);
    if (!marked) {
      // Somebody undid it between the restore and this update. The member is in the right
      // place either way, so this is information rather than a fault.
      log.info(
        `Moderation: sanction ${sanctionId} was reversed by another route while its expiry ran.`,
      );
      return;
    }

    log.info(`Moderation: mute ${sanctionId} expired, ${outcome.role} restored.`);
  };
}

/**
 * Re-enqueue mutes whose expiry job never ran.
 *
 * THE SAFETY NET, and it is not the normal path. A job is enqueued the moment a mute is
 * applied; this exists for the window between the row being committed and the job being
 * accepted, which a crash can land in. Without it that mute is permanent and only the
 * Active page's overdue flag would ever say so.
 *
 * Idempotent through the queue's own `idempotencyKey`, which dedupes against live jobs of
 * the same type, so calling this on every boot cannot pile up duplicates.
 */
export async function resweepOverdueMutes(
  db: Queryable,
  overdueIds: readonly string[],
  enqueueOne: (sanctionId: string) => Promise<void>,
): Promise<number> {
  let requeued = 0;
  for (const id of overdueIds) {
    try {
      await enqueueOne(id);
      requeued++;
    } catch (error) {
      // Surfaced rather than swallowed: an overdue mute that cannot even be re-queued is
      // a member stuck as an observer, and the operator has to know to lift it by hand.
      log.warn(
        `Moderation: could not re-queue the expiry for sanction ${id} (${
          error instanceof Error ? error.message : String(error)
        }).`,
      );
      status.error(
        `Moderation: a mute past its expiry could not be re-queued and may need lifting by ` +
          `hand. See the Active page.`,
      );
    }
  }
  if (requeued > 0) {
    log.info(`Moderation: re-queued ${requeued} overdue mute expiry job(s).`);
  }
  return requeued;
}

/**
 * The registered handler, reaching for the process pool like its siblings.
 *
 * The factory above stays exported because the harness drives this against PGlite, where
 * there is no process pool to reach for. Same handler either way: the test exercises the
 * real control flow rather than a parallel copy of it.
 */
export const moderationExpireHandler: JobHandler = (payload, ctx) =>
  makeModerationExpireHandler(getPool())(payload, ctx);
