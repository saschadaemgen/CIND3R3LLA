/**
 * Replies thrown away because they contained the speaking member's name (CCB-S5-031).
 *
 * ── WHY THERE IS A LOG AT ALL ────────────────────────────────────────────────
 *
 * `blockedLiterals` REJECTS: when her prose contains the display name of the member
 * currently speaking, the whole reply is discarded and the caller falls back to the
 * deterministic draft or, in free conversation, to silence. The member never learns that an
 * answer existed and was destroyed on the way out.
 *
 * That is a fallback which hides a fault by design, and CCB-S3-023 settled what to do about
 * exactly that shape: count it, and show the count where an operator can see it. Until now
 * it was a `log.debug` inside a catch, which is one level quieter than the `log.warn nobody
 * reads` the operator complained about. Production lost a real answer and the only trace was
 * a debug line nobody had the level turned up for.
 *
 * ── IT IS NOT A `status.error` ───────────────────────────────────────────────
 *
 * Deliberately, and the standing rule is the reason rather than an exception to it.
 * CCB-S3-023 escalates to the admin dashboard for the consent, capture, publication, media
 * and plugin paths, because those lose a GUARANTEE. This loses a sentence. Alerting on every
 * rejection would be the noise the same rule warns about, and the rejections that matter are
 * visible as a rising count beside the other interaction diagnostics.
 *
 * ── IT KEEPS THE MATCH AND AN EXCERPT ────────────────────────────────────────
 *
 * Same call as `forgery-log.ts`, for the same reason: a bare number cannot be judged. An
 * operator seeing "14 rejected" has no way to tell a bot repeatedly addressing members by
 * name from a guard eating answers over a member whose display name is an ordinary word.
 * The literal that matched is the single most useful thing here, because it answers that
 * question on sight.
 *
 * What is kept is HER OUTPUT plus the name that matched it, never a member's message. The
 * console is passkey-gated and already shows every word she says on the Messages page.
 *
 * IN MEMORY ONLY, capped, gone on restart. Diagnostics, not a record.
 */

export interface BlockedNameEvent {
  /** Epoch ms. */
  at: number;
  botProfileId: number | null;
  /** Which lane she was speaking in, so a pattern by lane is visible. */
  kind: string;
  /** The display name that matched. The most useful field on the card. */
  literal: string;
  /**
   * Whether anything survived for the member.
   *
   * `draft` means the caller had a deterministic line to fall back to and the member got
   * that. `silence` means free conversation, where there is no draft and the rejection costs
   * the member the whole answer. The second is the expensive one and the card says so.
   */
  cost: 'draft' | 'silence';
  /** What she had written. Bounded; see the header for why it is kept at all. */
  text: string;
}

/** How many to keep, matching the forgery log beside it. */
const LIMIT = 50;

/** Long enough to see how she used the name, short enough to read in a table cell. */
const MAX_EXCERPT = 240;

const buffer: BlockedNameEvent[] = [];
let total = 0;

export function recordBlockedName(entry: BlockedNameEvent): void {
  total += 1;
  buffer.unshift({ ...entry, text: entry.text.slice(0, MAX_EXCERPT) });
  if (buffer.length > LIMIT) buffer.length = LIMIT;
}

/** Most recent first. */
export function recentBlockedNames(limit = LIMIT): BlockedNameEvent[] {
  return buffer.slice(0, limit);
}

/**
 * The count since boot, which is NOT `recentBlockedNames().length`.
 *
 * The buffer is capped at fifty and the count is not, so a deployment that has rejected
 * three hundred replies says three hundred rather than fifty.
 */
export function blockedNameCount(): number {
  return total;
}

/** Test hook - the harness asserts on a clean buffer. */
export function clearBlockedNames(): void {
  buffer.length = 0;
  total = 0;
}
