/**
 * Job queue — public surface (CCB-S3-022). Registers the built-in handlers and
 * starts one worker in the shared process. Callers enqueue through the helpers
 * here; nothing else needs to know the store or the worker exist.
 */

import type { Queryable } from '../db/pool.js';
import { QueueWorker } from './worker.js';
import { getJobHandler, registerJobHandler } from './registry.js';
import { enqueueJob } from './store.js';
import { DEFAULT_QUEUE_CONFIG, type EnqueueOptions, type JobLane, type QueueConfig } from './types.js';
import {
  CONTENT_ANALYSIS_JOB,
  contentAnalysisHandler,
  contentAnalysisKey,
} from './jobs/analysis.js';
import { DELETION_APPLY_JOB, deletionApplyHandler, deletionApplyKey } from './jobs/deletion.js';
import { SCREENING_SCAN_JOB, screeningScanHandler, screeningScanKey } from './jobs/screening.js';
import {
  DESTRUCTION_RUN_JOB,
  HOLD_EXPIRE_JOB,
  destructionRunHandler,
  destructionRunKey,
  holdExpireHandler,
  holdExpireKey,
} from './jobs/destruction.js';
import { CAPTURE_DRAIN_JOB, captureDrainHandler } from '../capture/events/replay.js';

let worker: QueueWorker | undefined;

/** Register the built-in job handlers. Idempotent, so a second call is harmless. */
export function registerBuiltinJobs(): void {
  if (!getJobHandler(CONTENT_ANALYSIS_JOB)) {
    registerJobHandler(CONTENT_ANALYSIS_JOB, contentAnalysisHandler);
  }
  // Durable in-group deletion retry (CCB-S3-023 follow-up).
  if (!getJobHandler(DELETION_APPLY_JOB)) {
    registerJobHandler(DELETION_APPLY_JOB, deletionApplyHandler);
  }
  // Capture write-ahead drain: retries recorded events that did not apply on
  // arrival (CCB-S3-024). Interactive lane — a member's own message is not bulk work.
  if (!getJobHandler(CAPTURE_DRAIN_JOB)) {
    registerJobHandler(CAPTURE_DRAIN_JOB, captureDrainHandler);
  }
  // Deferred destruction and hold expiry (CCB-S3-013). Both MUST be registered:
  // the worker builds its claim list from the registered types, so an unregistered
  // type is never even selected and its jobs sit `queued` forever with no error.
  // For a member's erasure request that would be a silent consent breach.
  if (!getJobHandler(DESTRUCTION_RUN_JOB)) {
    registerJobHandler(DESTRUCTION_RUN_JOB, destructionRunHandler);
  }
  if (!getJobHandler(HOLD_EXPIRE_JOB)) {
    registerJobHandler(HOLD_EXPIRE_JOB, holdExpireHandler);
  }
  // Hash screening at receipt (CCB-S3-012). Registered unconditionally: with no
  // provider configured the handler runs, forms no opinion and contacts nothing,
  // which is what keeps the whole pipeline exercised in the shipped configuration.
  if (!getJobHandler(SCREENING_SCAN_JOB)) {
    registerJobHandler(SCREENING_SCAN_JOB, screeningScanHandler);
  }
  // The media-derivative handler is registered when its migration lands (§5).
}

export interface QueueDeps {
  db: Queryable;
  /** Live config provider; defaults to the shipped defaults until the admin page edits them. */
  config?: () => QueueConfig;
}

/** Starts (or returns) the single process-wide worker. */
export async function startQueue(deps: QueueDeps): Promise<QueueWorker> {
  if (worker) return worker;
  registerBuiltinJobs();
  worker = new QueueWorker({ db: deps.db, config: deps.config ?? (() => DEFAULT_QUEUE_CONFIG) });
  await worker.start();
  return worker;
}

export async function stopQueue(): Promise<void> {
  if (worker) await worker.stop();
  worker = undefined;
}

/** A thin, typed enqueue for callers that do not want the raw store. */
export async function enqueue(
  db: Queryable,
  type: string,
  opts: EnqueueOptions,
): Promise<{ id: number; created: boolean }> {
  return enqueueJob(db, type, opts);
}

/**
 * The content-analysis attach point (§7). Capture and publication call this so the
 * future AI work needs no change to the capture pipeline. Idempotent per message.
 */
export async function enqueueContentAnalysis(
  db: Queryable,
  messageId: number,
  lane: JobLane = 'bulk',
): Promise<void> {
  await enqueueJob(db, CONTENT_ANALYSIS_JOB, {
    idempotencyKey: contentAnalysisKey(messageId),
    lane,
    payload: { messageId },
  });
}

/**
 * Enqueue a durable retry of an in-group deletion (CCB-S3-023 follow-up). Called
 * when the immediate `markDeleted` fails, so the deletion is applied when the DB
 * recovers instead of being lost with the un-redelivered SDK event. Interactive
 * lane: consent is not bulk work. Idempotent per (group, message-set).
 */
export async function enqueueDeletionRetry(
  db: Queryable,
  groupId: number,
  groupMsgIds: readonly number[],
): Promise<void> {
  await enqueueJob(db, DELETION_APPLY_JOB, {
    idempotencyKey: deletionApplyKey(groupId, groupMsgIds),
    lane: 'interactive',
    payload: { groupId, groupMsgIds: [...groupMsgIds] },
  });
}

/**
 * Enqueue a drain of the capture write-ahead log (CCB-S3-024). Called when a
 * real-time capture failed to apply an event (so it retries when the DB recovers)
 * and at boot (to clear anything left pending by a crash). One constant key, so
 * while a drain is live a second enqueue is a harmless no-op: one drain sweeps the
 * whole backlog. Interactive lane.
 */
export async function enqueueCaptureDrain(db: Queryable): Promise<void> {
  await enqueueJob(db, CAPTURE_DRAIN_JOB, {
    idempotencyKey: 'capture.drain',
    lane: 'interactive',
  });
}

/**
 * Enqueue the destruction of one message the member asked to delete
 * (CCB-S3-013). Interactive lane on purpose: `bulkPaused` stops the bulk lane
 * entirely, and an operator shedding load must not silently halt erasure.
 * Idempotent per message.
 */
export async function enqueueDestructionRun(db: Queryable, messageId: number): Promise<void> {
  await enqueueJob(db, DESTRUCTION_RUN_JOB, {
    idempotencyKey: destructionRunKey(messageId),
    lane: 'interactive',
    payload: { messageId },
  });
}

/**
 * Schedule a hold to lapse at its expiry (CCB-S3-013).
 *
 * `runAt` is evaluated against the Postgres clock in the claim predicate, so a
 * thirty-day delay costs nothing at claim time and survives any number of
 * restarts. Note that re-enqueuing with the same key does NOT move `run_at` on a
 * live job, so extending or shortening a hold means cancelling this job and
 * enqueuing again rather than calling this twice.
 */
export async function enqueueHoldExpiry(
  db: Queryable,
  holdId: number,
  expiresAt: Date,
): Promise<void> {
  await enqueueJob(db, HOLD_EXPIRE_JOB, {
    idempotencyKey: holdExpireKey(holdId),
    lane: 'interactive',
    runAt: expiresAt,
    payload: { holdId },
  });
}

/**
 * Enqueue hash screening for one received image (CCB-S3-012).
 *
 * INTERACTIVE lane, not bulk: `bulkPaused` stops the bulk lane entirely, and an
 * operator shedding load must never silently stop screening. Idempotent per
 * message, so a re-delivered receipt does not queue a second scan.
 */
export async function enqueueScreeningScan(db: Queryable, messageId: number): Promise<void> {
  await enqueueJob(db, SCREENING_SCAN_JOB, {
    idempotencyKey: screeningScanKey(messageId),
    lane: 'interactive',
    payload: { messageId },
  });
}

export { SCREENING_SCAN_JOB } from './jobs/screening.js';
export { CONTENT_ANALYSIS_JOB } from './jobs/analysis.js';
export { DELETION_APPLY_JOB } from './jobs/deletion.js';
export { DESTRUCTION_RUN_JOB, HOLD_EXPIRE_JOB } from './jobs/destruction.js';
export { CAPTURE_DRAIN_JOB } from '../capture/events/replay.js';
