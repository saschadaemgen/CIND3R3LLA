/**
 * What the protected-text guard took out of her replies (CCB-S5-027).
 *
 * ── WHY THERE IS A LOG AT ALL ────────────────────────────────────────────────
 *
 * `protected-text.ts` STRIPS rather than rejects, and a strip is a fallback: the member
 * gets a reply that reads correctly and nobody downstream can tell that a forged
 * attribution was removed on the way. CCB-S3-023 settled what to do about that shape - a
 * fallback that can mask a fault is counted, and the count is shown in the admin. So this
 * is the count, on the Diagnostics page beside the near misses and the conversation log.
 *
 * It is also the only way to answer the question the operator will actually ask, which is
 * whether the other three layers are working. A rising count means she is still reaching for
 * the format; a count that stays at zero after a week of traffic means the memory strip and
 * the unnamed passages did their job.
 *
 * ── THIS ONE KEEPS THE TEXT, UNLIKE THE CONVERSATION LOG ─────────────────────
 *
 * `conversation-log.ts` is deliberately content-free, because its questions are "did it
 * fire, when, where, how fast". This log's whole question is WHAT she wrote, and a count
 * with no example cannot be judged: an operator seeing "14 removed" has no way to tell a
 * forged document name from an over-eager guard eating a legitimate sentence. That is the
 * same call `near-misses.ts` makes when it keeps an excerpt.
 *
 * What is kept is HER OUTPUT, bounded, and never a member's message. The console is
 * passkey-gated, and it already shows every word she says on the Messages page.
 *
 * THE BUFFER IS IN MEMORY, capped, and gone on restart: it is the Diagnostics tile, not a
 * record. Every strip ALSO writes one INFO line to the journal (CCB-S5-053), because five
 * reports of a false source line arrived without anybody being able to say whether the guard
 * had fired, and a tile that a restart empties cannot answer that.
 */
import { log } from '../log.js';
import type { RemovedLine } from './protected-text.js';

export interface ForgeryEvent {
  /** Epoch ms. */
  at: number;
  botProfileId: number | null;
  /** Which lane she was speaking in, so a pattern by lane is visible. */
  kind: string;
  /** On its own line, or tacked onto the end of a sentence. */
  where: RemovedLine['where'];
  /** What was removed. Bounded; see the header for why it is kept at all. */
  text: string;
}

/** How many to keep, matching the conversation log beside it. */
const LIMIT = 50;

/** Longer than any real attribution line and short enough to read in a table cell. */
const MAX_EXCERPT = 160;

const buffer: ForgeryEvent[] = [];
let total = 0;

export function recordForgedLine(entry: Omit<ForgeryEvent, 'text'> & { text: string }): void {
  total += 1;
  buffer.unshift({ ...entry, text: entry.text.slice(0, MAX_EXCERPT) });
  if (buffer.length > LIMIT) buffer.length = LIMIT;

  // ── IT ALSO REACHES THE JOURNAL (CCB-S5-053, D-239) ────────────────────────
  //
  // This buffer is in memory and capped at fifty, so it is emptied by every restart and
  // overwritten by volume. That is fine for a dashboard tile and useless for an
  // investigation, and the false source line has now been reported FIVE times without
  // anybody being able to say whether the guard fired.
  //
  // That is the whole difficulty: with no record, "she printed a source line" is compatible
  // with the guard never running AND with the guard running and something later re-adding
  // one, and the two need opposite fixes. Four of the five diagnoses reached for the
  // relevance floor because it was the only number anybody could see.
  //
  // INFO, because the default level is info and a line nobody sees is the state this is
  // fixing. The EXCERPT only, never the whole reply: this is her output about a member's
  // question, and the marker plus a fragment is what identifies the shape without putting a
  // conversation in the log.
  log.info('Interaction: removed a forged application line from her reply', {
    kind: entry.kind,
    where: entry.where,
    botProfileId: entry.botProfileId,
    excerpt: entry.text.slice(0, 80),
  });
}

/** Most recent first. */
export function recentForgedLines(limit = LIMIT): ForgeryEvent[] {
  return buffer.slice(0, limit);
}

/**
 * The count since boot, which is NOT `recentForgedLines().length`.
 *
 * The buffer is capped at fifty and the count is not, so a deployment that has stripped
 * three hundred lines says three hundred rather than fifty. A capped number presented as a
 * total is the kind of quiet understatement this log exists to avoid.
 */
export function forgedLineCount(): number {
  return total;
}

/** Test hook - the harness asserts on a clean buffer. */
export function clearForgedLines(): void {
  buffer.length = 0;
  total = 0;
}
