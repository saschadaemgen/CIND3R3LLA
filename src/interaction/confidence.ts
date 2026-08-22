/**
 * The confidence hedge and the snippet rule (CCB-S5-060 stages 3 and 4, D-255).
 *
 * ── HEDGE, NEVER SUPPRESS - THE OPERATOR'S DECISION, VERBATIM ────────────────
 *
 * The confidence signal separates fabrication from knowledge well enough to act on and not
 * well enough to silence anybody: at the measured threshold it catches 9 of 9 induced
 * fabrications and wrongly flags 2 of 10 correct answers. Losing one correct answer in
 * five to silence is too high a price; a wrongly-hedged correct answer costs one honest
 * sentence. So the signal APPENDS an application-written caveat and never withholds the
 * reply. Suppression stays available to the operator later if hedging proves too weak.
 *
 * ── THE SIGNAL, AND THE TRAP THE FIRST MEASUREMENT FELL INTO ─────────────────
 *
 * The signal is the MINIMUM token probability across the reply. The mean does not separate
 * (0.98 known against 0.94 fabricated) because a fabrication is fluent; the low point is
 * where the invented specific was chosen against live alternatives.
 *
 * But the reply ships inside a strict JSON schema, and the grammar FORCES tokens: the key
 * token `"reply"` carries the model's raw probability for a token it was never free to
 * refuse, measured at 0.000 on every single reply in both classes. A naive minimum over
 * the whole span is therefore a constant zero and separates nothing. The minimum is taken
 * over the tokens INSIDE the reply's string value, where the grammar leaves the model
 * free and the probabilities mean what they say.
 *
 * ── THE THRESHOLD IS MEASURED, TWICE ─────────────────────────────────────────
 *
 * 0.70. On plain-text replies (stage 0): best split at 0.708, catching 11 of 14. In the
 * shipping envelope with value-interior extraction: every induced fabrication scored at or
 * below 0.696 and eight of ten knowns at or above 0.775, so 0.70 catches 9 of 9 with 2 of
 * 10 wrongly hedged. Both runs on the operator's hardware against the production model.
 *
 * ── THE SNIPPET RULE (STAGE 4) ───────────────────────────────────────────────
 *
 * No search API returns the crawl date, so a stale snippet cannot be recognised as stale,
 * and the v7.0 answer was unavoidable given what she was handed (D-244). Until fetching
 * the page exists - deliberately unbuilt, it is an injection surface with its own briefing
 * behind it - one rule is enforceable today: a VALUE seen in a snippet may not be stated
 * as bare fact. Deterministically: when her answer contains a version or price and that
 * value appears in the snippets she was handed, the value came from a preview nobody
 * opened, and the application says so under the answer. Values she produced WITHOUT a
 * snippet source are the confidence hedge's territory, one lane over.
 */

/** Ollama's per-token logprob entry, as the native endpoint returns it. */
export interface TokenLogprob {
  token: string;
  logprob: number;
}

export const CONFIDENCE_HEDGE_THRESHOLD = 0.7;

/**
 * The span of the reply VALUE inside the raw structured content, escape-aware.
 *
 * Returns null when the content does not carry the envelope, which the caller treats as
 * "no signal" rather than as confidence in either direction.
 */
export function replyValueSpan(content: string): { lo: number; hi: number } | null {
  const m = /"reply"\s*:\s*"/.exec(content);
  if (!m) return null;
  const lo = m.index + m[0].length;
  let i = lo;
  while (i < content.length) {
    if (content[i] === '\\') {
      i += 2;
      continue;
    }
    if (content[i] === '"') break;
    i += 1;
  }
  return { lo, hi: i };
}

/**
 * The minimum probability over the tokens inside the reply value.
 *
 * Null when there is nothing to measure - no entries, no envelope, or no token overlapping
 * the value - and null means NO HEDGE, because hedging on a missing instrument would hedge
 * every reply the moment logprobs break, which is a silent regression wearing a caveat.
 */
export function minReplyTokenProb(
  content: string,
  entries: readonly TokenLogprob[],
): number | null {
  const span = replyValueSpan(content);
  if (!span || entries.length === 0) return null;
  let min: number | null = null;
  let offset = 0;
  for (const entry of entries) {
    const start = offset;
    const end = offset + entry.token.length;
    offset = end;
    if (start >= span.hi || end <= span.lo) continue;
    const p = Math.exp(entry.logprob);
    if (min === null || p < min) min = p;
  }
  return min;
}

/**
 * Version strings and prices - the two value shapes production actually fabricated or
 * copied stale ("v7.0", "$4.99 per month"). Deliberately narrow: a value pattern that
 * matched years or bare integers would hedge half of ordinary conversation.
 */
const VALUE_PATTERN = /\bv?\d+(?:\.\d+)+\b|[$€£]\s?\d[\d.,]*|\b\d[\d.,]*\s?(?:USD|EUR|BTC)\b/g;

/**
 * The first value in the reply that also appears in a snippet she was handed, or null.
 *
 * A value in BOTH is a value copied from a preview nobody opened - the v7.0 case, where
 * the snippet said 7.0 and the page it pointed at said 7.1. A value in the reply alone
 * came from the model and is the confidence hedge's problem, not this rule's.
 */
export function snippetValueAsserted(
  reply: string,
  snippetTexts: readonly string[],
): string | null {
  const haystack = snippetTexts.join('\n');
  for (const match of reply.match(VALUE_PATTERN) ?? []) {
    // Normalised containment: "v7.0" in the reply matches "7.0" in the snippet and the
    // other way round, because the prefix is style, not value.
    const bare = match.replace(/^v/i, '');
    if (haystack.includes(match) || haystack.includes(bare)) return match;
  }
  return null;
}
