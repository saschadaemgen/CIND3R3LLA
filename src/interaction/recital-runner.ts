/**
 * Reading one beat of the Book out loud (CCB-S4-047, D-149).
 *
 * ── PORTS, SO THIS IS TESTABLE WITH NOTHING RUNNING ──────────────────────────
 *
 * Everything that touches the world arrives as a {@link RecitalPort}: the model that writes a
 * transition, the renderer that fills a rule's placeholders, the transport that sends, and
 * the scheduler that books the next beat. So the whole of the performance logic, including
 * every degradation path, can be driven in a harness with no Ollama, no SimpleX core and no
 * Postgres, which is what makes "prove it degrades" a check rather than a claim.
 *
 * ── ONE BEAT AT A TIME, AND WHY ──────────────────────────────────────────────
 *
 * This sends beat N and books beat N+1. It does not loop. The reply path must not block for
 * the length of a recital, and a chain of durable jobs survives a restart in a way a loop
 * holding a socket does not: if the process dies after beat three, beat four is a row in
 * Postgres with a `run_at`, not a promise nobody kept.
 *
 * ── AND WHY IT CANNOT GO SILENT IN THE MIDDLE ────────────────────────────────
 *
 * Three things can fail: the model, the image, and the send. The first two degrade in place,
 * to the chapter's authored line and to text respectively, and the beat still goes out whole.
 * Only the send can actually fail, and when it does the chain stops with a logged error
 * rather than with a half-written sentence. The message budget is reserved in one piece
 * before any of this starts, so a rate limit can never be what interrupts a reading.
 */

import { log } from '../log.js';
import {
  recitalClosing,
  renderRecitalBeat,
  type RecitalBeat,
  type RecitalPlan,
} from './recital.js';
import type { PromptRule } from './prompt-rules.js';

export interface RecitalPort {
  /**
   * Her words leading into this beat, or `null` when the model gave nothing usable.
   *
   * `null` is an expected return, not an error: the chapter's authored fallback takes its
   * place and the reading continues. Implementations must not throw for an ordinary model
   * failure, so that the one thing this cannot recover from stays the one thing it cannot
   * recover from.
   */
  transition(beat: RecitalBeat, index: number): Promise<string | null>;
  /** One rule as a member will read it, placeholders filled. */
  renderRule(rule: PromptRule): string;
  /** Sends one message. `imagePath` is relative to the asset root, or null for text. */
  send(text: string, imagePath: string | null): Promise<void>;
  /** Books the next beat. Absent scheduling ends the recital after this one. */
  scheduleNext(nextIndex: number, delayMs: number): Promise<void>;
}

export interface RecitalRunOptions {
  german: boolean;
  pacingMs: number;
}

/**
 * Sends beat `index` and books the next.
 *
 * Returns whether anything was sent, so a caller starting a recital can tell the difference
 * between "reading" and "there was nothing to read" without inspecting the plan again.
 */
export async function sendRecitalBeat(
  port: RecitalPort,
  plan: RecitalPlan,
  index: number,
  opts: RecitalRunOptions,
): Promise<boolean> {
  const beat = plan.beats[index];
  if (!beat) return false;

  // THE MODEL IS ALLOWED TO FAIL AND NOT ALLOWED TO STOP THIS. A throw here would take the
  // chapter with it, so it is caught and treated exactly like an unusable answer.
  let transition: string | null = null;
  try {
    transition = await port.transition(beat, index);
  } catch (err) {
    log.warn(
      `Recital beat ${String(index)}: the model failed (${
        err instanceof Error ? err.message : String(err)
      }); reading the authored line instead.`,
    );
  }

  const last = index === plan.beats.length - 1;
  const text = renderRecitalBeat(beat, {
    transition: transition ?? '',
    rules: beat.rules.map((rule) => port.renderRule(rule)),
    german: opts.german,
    // THE CLOSING IS AUTHORED AND IS APPENDED HERE, not asked for. CCB-S4-046 promised a
    // member is told that rules are withheld; a promise kept only when a model remembers it
    // is not kept.
    ...(last ? { closing: recitalClosing(plan, opts.german) } : {}),
  });

  await port.send(text, beat.imagePath);

  if (!last) await port.scheduleNext(index + 1, opts.pacingMs);
  return true;
}
