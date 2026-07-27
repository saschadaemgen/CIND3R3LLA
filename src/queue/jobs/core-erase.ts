/**
 * Durable erasure of the core's copy (CCB-S3-027 §2).
 *
 * The archive row is destroyed synchronously inside a transaction; the core's copy
 * cannot be, because it lives behind an SDK call to an in-process Haskell core
 * that may be down, restarting, or busy. Doing it inline would mean either
 * blocking the destruction on the core, or losing the core deletion when the call
 * failed and reporting a complete erasure that was not one.
 *
 * So it goes on the queue, exactly as a failed in-group deletion does
 * (CCB-S3-023): retried durably, dead-lettered visibly, and surfaced when it
 * dead-letters. "A partial erasure that reports success" is the pattern the
 * swallowed-error audit exists to prevent, and this is a partial erasure by
 * construction until this job succeeds.
 *
 * IDENTIFIERS ONLY IN THE PAYLOAD. `jobs.payload` and `jobs.last_error` are never
 * pruned, so a filename or any content here would outlive the erasure it performed.
 * The core's own group id and chat item id are opaque integers, which is exactly
 * what belongs in a job that is meant to erase something.
 */

import { T } from '@simplex-chat/types';

import { CoreDeleteUnavailableError, coreDeleteAvailable, deleteFromCore } from '../../bot/core-delete.js';
import { log } from '../../log.js';
import { status } from '../../web/status.js';
import { PermanentJobError, type JobHandler } from '../types.js';

/** The stable job type. */
export const CORE_ERASE_JOB = 'core.erase';

export function coreEraseKey(groupId: number, itemId: number): string {
  return `core.erase:${groupId}:${itemId}`;
}

/**
 * Erases one item from the core.
 *
 * The core reports success for an item it no longer has, so a retry after a
 * partial run converges rather than failing. A core that is not running is a
 * TRANSIENT failure and is retried; only a payload that can never be valid
 * dead-letters immediately.
 */
export const coreEraseHandler: JobHandler = async (payload) => {
  const groupId = Number(payload['groupId']);
  const itemId = Number(payload['itemId']);
  if (!Number.isFinite(groupId) || !Number.isFinite(itemId)) {
    throw new PermanentJobError(
      `core.erase: invalid payload (groupId ${String(payload['groupId'])}, itemId ${String(payload['itemId'])}).`,
    );
  }

  if (!coreDeleteAvailable()) {
    // Not a permanent error: the bot may be starting, or stopped while the admin
    // console stays up. Retrying is right, and the queue's backoff handles it.
    throw new CoreDeleteUnavailableError();
  }

  const chatType =
    payload['chatType'] === 'direct' ? T.ChatType.Direct : T.ChatType.Group;

  try {
    await deleteFromCore(groupId, itemId, chatType);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Queue: core erasure of item ${itemId} in group ${groupId} failed: ${message}`);
    // Surfaced on every attempt, not only on the last: an erasure that a member
    // asked for is not something to discover from a dead-letter list later.
    status.error(
      `The archive copy of a destroyed message is gone, but the SimpleX core's own copy of item ` +
        `${itemId} (group ${groupId}) could not be erased yet. It will be retried. Until it ` +
        `succeeds, a copy of that content remains on this host.`,
    );
    throw err;
  }
};
