/**
 * The music cadence's heartbeat (CCB-S5-044, D-216): `music.tick`, the bridge's
 * self-chaining minute-bucket shape reused whole.
 *
 * The varying idempotency key keeps the chain alive (a fixed key would dedupe
 * every future tick into one row - the recital's lesson) and makes chains
 * SELF-COLLAPSING: a boot seed lands on a live chain's own next key and dedupes
 * into it, so a restart can never fork two heartbeats.
 */

import { enqueueJob } from '../store.js';
import type { JobHandler } from '../types.js';
import { getPool } from '../../db/pool.js';
import { log } from '../../log.js';
import { runMusicTick, type MusicDeps } from '../../plugins/music/service.js';
import { noteMusicTick } from '../../plugins/music/music-log.js';

export const MUSIC_TICK_JOB = 'music.tick';

export const MUSIC_TICK_INTERVAL_MS = 60_000;

/** The minute bucket an instant falls in; the key that makes chains collapse. */
export function musicTickKey(at: Date): string {
  return `music.tick:${String(Math.floor(at.getTime() / MUSIC_TICK_INTERVAL_MS))}`;
}

/** The recital's setter pattern: null deps is the ordinary state of a restart. */
let deps: (() => MusicDeps | null) | null = null;

export function setMusicJobDeps(next: (() => MusicDeps | null) | null): void {
  deps = next;
}

async function scheduleNextTick(): Promise<void> {
  const next = new Date(Date.now() + MUSIC_TICK_INTERVAL_MS);
  await enqueueJob(getPool(), MUSIC_TICK_JOB, {
    idempotencyKey: musicTickKey(next),
    lane: 'bulk',
    runAt: next,
    payload: {},
  });
}

export const musicTickHandler: JobHandler = async () => {
  // The chain is booked FIRST, outside the work's try (the bridge's reasoning
  // verbatim): a tick whose work throws cannot take the cadence with it.
  await scheduleNextTick();
  const resolved = deps?.() ?? null;
  if (resolved === null) {
    noteMusicTick(Date.now());
    log.debug('music: tick ran before the deps were registered; the chain continues.');
    return;
  }
  await runMusicTick(resolved);
};

/** Boot seed: starts the chain, or collapses into a live one. */
export async function seedMusicTick(): Promise<void> {
  await enqueueJob(getPool(), MUSIC_TICK_JOB, {
    idempotencyKey: musicTickKey(new Date()),
    lane: 'bulk',
    payload: {},
  });
}
