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
import type { Queryable } from '../../db/pool.js';
import { log } from '../../log.js';
import { runMusicTick, type MusicDeps } from '../../plugins/music/service.js';
import { ensureEncoded } from '../../plugins/music/library.js';
import { ENCODE_VERSION } from '../../media/encode.js';
import { getTrack } from '../../plugins/music/store.js';
import { PermanentJobError } from '../types.js';
import { noteMusicTick } from '../../plugins/music/music-log.js';

export const MUSIC_TICK_JOB = 'music.tick';
export const MUSIC_ENCODE_JOB = 'music.encode';

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
  // D-222: encodes stamped with an older version are retired stock. Re-queue
  // them here so a version bump heals in the queue within minutes of deploy,
  // rather than synchronously inside the first send of every stale track -
  // the 504 lesson's cost, moved onto the bot path. The idempotency key
  // collapses repeats, so re-listing every minute enqueues each track once.
  try {
    const stale = await resolved.db.query<{ id: string | number }>(
      `SELECT id FROM cinderella_tracks
        WHERE cover_path IS NOT NULL
          AND (encode_version IS NULL OR encode_version <> $1)
        ORDER BY id LIMIT 50`,
      [ENCODE_VERSION],
    );
    for (const row of stale.rows) {
      await enqueueMusicEncode(resolved.db, Number(row.id), ENCODE_VERSION);
    }
  } catch (error) {
    resolved.onFault(`Music: re-queueing stale encodes failed: ${String(error)}`);
  }

  await runMusicTick(resolved);
};

/**
 * The encode, OUT of the request (CCB-S5-044 follow-up): the first real upload
 * hit nginx's 60-second proxy_read_timeout and died as a 504 the operator could
 * not explain, because the encode ran inside the upload request. Upload now
 * stores the file and returns; this job does the work the queue exists for.
 *
 * The key is (track, recipe version): while one encode for a track is queued or
 * running, duplicate enqueues collapse into it; once it is terminal, a fresh
 * enqueue (a REPLACED cover) creates a fresh job, which is the store's stated
 * idempotency semantics and exactly the re-encode a new cover needs.
 */
export function musicEncodeKey(trackId: number, version: number): string {
  return `music.encode:${String(trackId)}:v${String(version)}`;
}

export async function enqueueMusicEncode(
  db: Queryable,
  trackId: number,
  version: number,
): Promise<void> {
  await enqueueJob(db, MUSIC_ENCODE_JOB, {
    idempotencyKey: musicEncodeKey(trackId, version),
    lane: 'bulk',
    payload: { trackId },
  });
}

export const musicEncodeHandler: JobHandler = async (payload) => {
  const trackId = Number(payload['trackId']);
  if (!Number.isFinite(trackId)) {
    throw new PermanentJobError(`music.encode payload is unusable: ${JSON.stringify(payload)}`);
  }
  const resolved = deps?.() ?? null;
  // A plain throw: the queue retries with backoff, and an encode that waits for
  // boot beats one that silently never happens.
  if (resolved === null) throw new Error('music: the encode must wait for the deps.');
  const track = await getTrack(resolved.db, trackId);
  // A deleted track, or one whose cover went away, has nothing to encode; both
  // are normal outcomes of the gap between enqueue and run, not faults.
  if (track === null || track.coverPath === null) return;
  await ensureEncoded(resolved.db, resolved.musicRoot, track, resolved.onFault);
};

/** Boot seed: starts the chain, or collapses into a live one. */
export async function seedMusicTick(): Promise<void> {
  await enqueueJob(getPool(), MUSIC_TICK_JOB, {
    idempotencyKey: musicTickKey(new Date()),
    lane: 'bulk',
    payload: {},
  });
}
