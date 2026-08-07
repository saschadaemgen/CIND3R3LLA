/**
 * The next beat of a recital (CCB-S4-047, D-149).
 *
 * ── WHY THE QUEUE AND NOT A TIMER ────────────────────────────────────────────
 *
 * The same reasons the mute expiry uses it (CCB-S4-035). A `setTimeout` dies with the
 * process, and a recital interrupted by a restart would leave a group holding an opening and
 * three chapters with nothing anywhere recording that the rest was owed. The queue is
 * Postgres-backed, survives restarts, retries with backoff and dead-letters visibly.
 *
 * It also keeps the reply path free, which the briefing asked for directly: the triggering
 * message is answered with the opening and returns, and the remaining beats are rows with a
 * `run_at`, not a handler holding a socket for half a minute.
 *
 * ── IDEMPOTENCE ─────────────────────────────────────────────────────────────
 *
 * The queue is at-least-once, so a beat can run twice: a crash between the send and the ack,
 * or a retry after a transient core error. The plan is REBUILT from the chapters and the
 * registry rather than carried in the payload, so a second run of beat four sends beat four
 * again. That is a duplicated message in a rare case, which is the failure mode chosen over
 * the alternative: a payload carrying copied rule text would let a retry send a law the Book
 * no longer holds, and a wrong rule is worse than a repeated one.
 *
 * ── IDENTIFIERS ONLY IN THE PAYLOAD ──────────────────────────────────────────
 *
 * `jobs.payload` is never pruned, so nothing member-written goes in it: a group id, a beat
 * index and a language code, all of which are already in the schema many times over.
 */

import { getPool } from '../../db/pool.js';
import { log } from '../../log.js';
import { PermanentJobError } from '../types.js';
import { continueRecital, type RecitalDeps } from '../../interaction/recital-service.js';

export const RECITAL_JOB = 'recital.beat';

/** Bound at startup, because the worker cannot reach into the wiring that built the bot. */
let deps: (() => Omit<RecitalDeps, 'db'>) | null = null;

export function setRecitalJobDeps(next: (() => Omit<RecitalDeps, 'db'>) | null): void {
  deps = next;
}

export interface RecitalJobPayload extends Record<string, unknown> {
  groupId: number;
  lang: string;
  beatIndex: number;
}

export async function handleRecitalBeat(payload: Record<string, unknown>): Promise<void> {
  const groupId = payload['groupId'];
  const lang = payload['lang'];
  const beatIndex = payload['beatIndex'];
  if (typeof groupId !== 'number' || typeof lang !== 'string' || typeof beatIndex !== 'number') {
    // Permanent: a payload this shape can never become valid, so it dead-letters at once
    // rather than consuming the whole backoff schedule to fail the same way six times.
    throw new PermanentJobError(
      `recital.beat payload is not usable: ${JSON.stringify(payload).slice(0, 120)}`,
    );
  }
  const resolved = deps?.();
  if (!resolved) {
    // Not permanent. Nothing is hosting YET is the ordinary state during a restart, and the
    // beat is worth retrying; a recital that resumes late is better than one that stops.
    throw new Error('the recital is not wired yet');
  }
  const sent = await continueRecital({ ...resolved, db: getPool() }, groupId, lang, beatIndex);
  if (!sent) {
    log.warn(
      `Recital: beat ${String(beatIndex)} in group ${String(groupId)} had nothing to send; ` +
        'the reading ends here.',
    );
  }
}
