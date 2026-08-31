/**
 * The bridge's queue jobs (CCB-S5-032, D-187): the recurring tick, and the
 * propagation of a source edit or deletion to every live copy.
 *
 * ── THE TICK IS A SELF-CHAINING JOB WITH A MINUTE-BUCKET KEY ─────────────────
 *
 * The recital taught the shape: a handler that re-enqueues its successor must
 * VARY the idempotency key, because the running job still holds its (type, key)
 * slot in the live-unique index and a constant key would dedupe the successor
 * into nothing, killing the chain silently. The recital varies by beat index;
 * the tick varies by TIME BUCKET - the minute the next run is due in - which
 * buys a second property the recital never needed: chains are SELF-COLLAPSING.
 * A boot seed while a chain is already live lands on the same bucket key as the
 * chain's own next link and dedupes into it, so there is never a second chain,
 * without any "is one already running" read.
 *
 * ── WHY A QUEUE JOB AND NOT A setInterval ────────────────────────────────────
 *
 * The sweeper's timer shape would work, but the cadence is a PROMISE to the
 * operator ("once an hour"), and the queue is where this codebase keeps
 * promises that must survive a restart: a due tick lost to a crash is retried
 * with backoff, and `run_at` is evaluated against the Postgres clock.
 */

import { getPool } from '../../db/pool.js';
import { enqueueJob } from '../store.js';
import { PermanentJobError, type JobHandler } from '../types.js';
import { log } from '../../log.js';
import {
  propagateForPost,
  runBridgeTick,
  type BridgeDeps,
} from '../../plugins/channel-bridge/service.js';
import { noteBridgeTickAlive } from '../../plugins/channel-bridge/bridge-log.js';
import { maybeSweepBridgeMedia } from '../../plugins/channel-bridge/media-retention.js';

export const BRIDGE_TICK_JOB = 'bridge.tick';
export const BRIDGE_PROPAGATE_JOB = 'bridge.propagate';

export const TICK_INTERVAL_MS = 60_000;

/** The minute bucket an instant falls in; the key that makes chains collapse. */
export function bridgeTickKey(at: Date): string {
  return `bridge.tick:${String(Math.floor(at.getTime() / TICK_INTERVAL_MS))}`;
}

export function bridgePropagateKey(postId: number, action: string, at: Date): string {
  // The edit timestamp is in the key so a SECOND edit of the same post enqueues
  // its own propagation rather than deduping into one already running.
  return `bridge.propagate:${String(postId)}:${action}:${String(at.getTime())}`;
}

/**
 * Deps are registered at boot, the recital's setter pattern: while they are
 * null the handler throws a PLAIN error so the queue retries with backoff,
 * because "nothing is hosting YET" is the ordinary state during a restart.
 */
let deps: (() => BridgeDeps | null) | null = null;

export function setBridgeJobDeps(next: (() => BridgeDeps | null) | null): void {
  deps = next;
}

async function scheduleNextTick(): Promise<void> {
  const next = new Date(Date.now() + TICK_INTERVAL_MS);
  await enqueueJob(getPool(), BRIDGE_TICK_JOB, {
    idempotencyKey: bridgeTickKey(next),
    lane: 'bulk',
    runAt: next,
    payload: {},
  });
}

export const bridgeTickHandler: JobHandler = async () => {
  // THE CHAIN IS BOOKED FIRST, before the work and outside its try, so a tick
  // whose work throws (and eventually dead-letters) cannot take the whole
  // cadence with it: the next link is already queued. The work itself never
  // throws for one mapping's failure (runBridgeTick contains those); what can
  // throw here is the infrastructure, and that is worth a retry of THIS tick
  // while the successor stands.
  await scheduleNextTick();
  const resolved = deps?.() ?? null;
  if (resolved === null) {
    noteBridgeTickAlive(Date.now());
    log.debug('bridge: tick ran before the deps were registered; the chain continues.');
    return;
  }
  await runBridgeTick(resolved);
  // The media retention pass rides the tick and gates itself to once per local day
  // (CCB-S5-064). Its own try, because a sweep that throws must cost the sweep and not
  // the announcements: a failed unlink is not a reason to retry forwarding.
  try {
    await maybeSweepBridgeMedia({
      db: resolved.db,
      root: resolved.mediaRoot,
      retention: resolved.mediaRetention(),
      now: resolved.now?.() ?? new Date(),
    });
  } catch (err) {
    log.error(
      `bridge: the media retention pass failed and will retry on the next tick (${
        err instanceof Error ? err.message : String(err)
      }).`,
    );
  }
};

export const bridgePropagateHandler: JobHandler = async (payload) => {
  const postId = Number(payload['postId']);
  const action = payload['action'];
  if (!Number.isFinite(postId) || (action !== 'edit' && action !== 'withdraw')) {
    throw new PermanentJobError(
      `bridge.propagate payload is unusable: ${JSON.stringify(payload)}`,
    );
  }
  const resolved = deps?.() ?? null;
  // A plain throw: the queue retries with backoff, and a withdrawal that waits
  // for the core beats one that silently never happens.
  if (resolved === null) throw new Error('bridge: propagation must wait for a hosting runtime.');
  await propagateForPost(resolved, postId, action);
};

/** Boot seed: starts the chain, or collapses into a live one (see header). */
export async function seedBridgeTick(): Promise<void> {
  await enqueueJob(getPool(), BRIDGE_TICK_JOB, {
    idempotencyKey: bridgeTickKey(new Date()),
    lane: 'bulk',
    payload: {},
  });
}

export async function enqueueBridgePropagation(
  postId: number,
  action: 'edit' | 'withdraw',
): Promise<void> {
  await enqueueJob(getPool(), BRIDGE_PROPAGATE_JOB, {
    idempotencyKey: bridgePropagateKey(postId, action, new Date()),
    lane: 'interactive',
    payload: { postId, action },
  });
}
