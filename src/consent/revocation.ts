/**
 * Hide or delete, and how holds change the answer (CCB-S3-013).
 *
 * The member has revoked. Their content is ALREADY hidden at that moment - the
 * publish views stopped selecting it the instant `revoked_at` was set - and this
 * module handles what they choose next.
 *
 * HOW THE TWO PARTS INTERACT, which is the whole design:
 *
 *   1. The hide half executes immediately for everything, held or not.
 *   2. The delete half executes immediately for unheld items, and QUEUES for
 *      held ones.
 *   3. The member is told which is which.
 *   4. When the hold is released or expires, the queued deletion runs by itself.
 *   5. The intent is recorded in the journal and in `pending_destructions`, so it
 *      survives a restart and the member never has to ask twice.
 *
 * Each message is destroyed in ITS OWN transaction, deliberately. One held item
 * must not roll back the destruction of the twenty unheld ones beside it, and a
 * single unlink fault must not strand the whole request.
 */

import { recordRevocationMode, restoreHidden } from '../db/consent.js';
import { journalConsentAction, readConsentState, type ConsentSource } from '../db/consent-actions.js';
import { withTransaction, type Queryable } from '../db/pool.js';
import { log } from '../log.js';
import { enqueueDestructionRun } from '../queue/index.js';
import { status } from '../web/status.js';
import {
  destroyMessage,
  memberMessageIds,
  recordPendingDestruction,
} from '../archive/destroy.js';

/** Lets the verification harness supply its own transaction boundary. */
export type TxRunner = <T>(fn: (db: Queryable) => Promise<T>) => Promise<T>;

export interface RevocationChoice {
  memberId: string;
  /** Group-message timestamp of the message that carried the choice (ISO 8601). */
  at: string;
  source: ConsentSource;
}

export interface DeleteOutcome {
  /** Whether this call was the one that recorded the choice. */
  recorded: boolean;
  destroyed: number;
  /** Items a live evidence hold defers. Their deletion is queued, not dropped. */
  deferred: number;
  /** Items that failed to destroy and will be retried. */
  failed: number;
}

/**
 * Records HIDE.
 *
 * Nothing is erased and nothing needs to be: the content is already out of every
 * public path by derivation. This makes the choice explicit and durable so the
 * member can restore later, and so the interim `pending` state ends.
 */
export async function chooseHide(
  db: Queryable,
  choice: RevocationChoice,
): Promise<{ recorded: boolean }> {
  const prior = await readConsentState(db, choice.memberId);
  const recorded = await recordRevocationMode(db, choice.memberId, 'hide');
  if (recorded) {
    await journalConsentAction(db, {
      memberId: choice.memberId,
      action: 'hide',
      source: choice.source,
      at: choice.at,
      prior,
    });
  }
  // CHOOSING HIDE CANCELS ANY DESTRUCTION STILL WAITING ON A HOLD.
  //
  // Without this a member could ask to delete, have part of it deferred by an
  // evidence hold, change their mind, be told "hidden, and you can bring them
  // back whenever you like", and then have the deferred deletion run anyway when
  // the hold lapsed. She would have said something untrue and the content would
  // be gone. Hiding is the exposure-reducing, reversible choice, so it must be
  // able to withdraw the irreversible one.
  //
  // Unconditional on `recorded`: a member whose mode is ALREADY 'hide' saying so
  // again must still cancel, and that is exactly the case `recorded` is false.
  const cancelled = await db.query(
    'DELETE FROM pending_destructions WHERE member_id = $1 AND requested_by = $2',
    [choice.memberId, 'member'],
  );
  if ((cancelled.rowCount ?? 0) > 0) {
    log.info(
      `Revocation: hide cancelled ${cancelled.rowCount ?? 0} pending destruction(s) for one member.`,
    );
  }
  return { recorded };
}

/**
 * Records DELETE and carries it out as far as it can go right now.
 *
 * Returns counts rather than a bare success, because the member has to be told
 * honestly when part of their request is deferred. Silently not deleting is worse
 * than openly deferring.
 */
export async function chooseDelete(
  db: Queryable,
  choice: RevocationChoice,
  mediaRoot: string,
  runTx: TxRunner = withTransaction,
  quarantineRoot?: string,
): Promise<DeleteOutcome> {
  const prior = await readConsentState(db, choice.memberId);
  const recorded = await recordRevocationMode(db, choice.memberId, 'delete');
  if (!recorded) {
    // The choice was not this call's to make: the member is not revoked, or they
    // already answered. DESTROYING ANYWAY WOULD BE THE WORST BUG IN THE FEATURE.
    // `recordRevocationMode` only matches a row that is revoked and still
    // 'pending', so a false here means a late duplicate, a replay, or a member
    // whose settled choice was 'hide'. Running the loop regardless would erase an
    // archive while `consent.revocation_mode` still read 'hide' and no journal
    // entry recorded a delete.
    log.warn(
      `Revocation: a delete was requested for a member whose revocation is not awaiting a choice; ` +
        `nothing was destroyed.`,
    );
    return { recorded: false, destroyed: 0, deferred: 0, failed: 0 };
  }
  await journalConsentAction(db, {
    memberId: choice.memberId,
    action: 'delete',
    source: choice.source,
    at: choice.at,
    prior,
  });

  const ids = await memberMessageIds(db, choice.memberId);
  let destroyed = 0;
  let deferred = 0;
  let failed = 0;

  for (const id of ids) {
    // The intent is recorded BEFORE the attempt, so a crash mid-run leaves a
    // durable record of what was asked for rather than a half-finished request.
    // The row is removed by cascade when the message is actually destroyed.
    await recordPendingDestruction(db, id, choice.memberId, 'member');
    try {
      const result = await runTx((tx) => destroyMessage(tx, mediaRoot, id, quarantineRoot));
      if (result.destroyed) destroyed += 1;
    } catch (err) {
      if (isHoldViolation(err)) {
        deferred += 1;
        continue;
      }
      failed += 1;
      log.error(
        `Revocation: destroying message ${id} for a member who asked for deletion failed: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      // A failure MUST become retryable work. Counting it and moving on left the
      // rows and media in place forever while the member had been told their
      // deletion was in hand, which is a silent consent breach of exactly the
      // shape CCB-S3-023 forbids. The `pending_destructions` row above records
      // the intent; this is what makes something act on it.
      try {
        await enqueueDestructionRun(db, id);
      } catch (enqueueErr) {
        status.error(
          `A member's deletion of message ${id} failed AND could not be queued for retry. The ` +
            `content is hidden but not destroyed: ` +
            `${enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr)}`,
        );
      }
    }
  }

  if (destroyed > 0 || deferred > 0 || failed > 0) {
    log.info(
      `Revocation: delete for one member - ${destroyed} destroyed, ${deferred} deferred by an ` +
        `evidence hold, ${failed} failed and pending retry.`,
    );
  }
  return { recorded, destroyed, deferred, failed };
}

/**
 * Brings back content the member chose to HIDE.
 *
 * Only reachable after 'hide' (`restoreHidden` scopes the UPDATE), so there is no
 * path from here to content that was deleted. This is NOT routed through
 * `undoLastConsentAction`: undo may only ever reduce exposure, and this
 * deliberately increases it - which is legitimate precisely because it is the
 * member's own explicit, first-person request rather than the reversal of one.
 */
export async function restoreHiddenContent(
  db: Queryable,
  choice: RevocationChoice,
): Promise<{ restored: boolean }> {
  const prior = await readConsentState(db, choice.memberId);
  const restored = await restoreHidden(db, choice.memberId);
  if (restored) {
    await journalConsentAction(db, {
      memberId: choice.memberId,
      action: 'restore',
      source: choice.source,
      at: choice.at,
      prior,
    });
  }
  return { restored };
}

/**
 * Whether an error is the hold guard refusing a destruction.
 *
 * Matched on the SQLSTATE the trigger raises (`restrict_violation`, 23001) rather
 * than on message text, so it keeps working in any locale. Anything else is a
 * real failure and must not be quietly reclassified as "deferred" - that would
 * tell a member their deletion is waiting on a review when it actually broke.
 */
export function isHoldViolation(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (code === '23001') return true;
  const message = err instanceof Error ? err.message : '';
  return /evidence hold/i.test(message);
}
