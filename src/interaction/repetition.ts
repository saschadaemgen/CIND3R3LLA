/**
 * The repetition gate: she does not send the same reply twice (CCB-S5-060 stage 2, D-253).
 *
 * ── WHY A GATE EXISTS WHEN THE SAMPLER ALREADY SHIPS ─────────────────────────
 *
 * D-252's repetition window makes the verbatim repeat IMPROBABLE - 0 of 5 on the known
 * trigger - and improbable is not a property. The mechanism behind the defect is the
 * model's own induction circuitry completing a quoted prefix with what followed it last
 * time (Olsson et al., arXiv 2209.11895), which is the same circuitry that makes
 * in-context learning work at all, so no sampler setting and no prompt sentence retires
 * it. The gate is the property: a near-duplicate of something she recently said in this
 * room is not sent, whatever produced it.
 *
 * ── SCOPED TO HER OWN WORDS, WHICH THE MEASUREMENT DECIDED ───────────────────
 *
 * Measured on the operator's 723 archived replies (stage 0): a naive gate over everything
 * flags 55 repeats, and 29 of them are APPLICATION TEMPLATES that must repeat - the help
 * text, the nickname retort, and seven consent confirmations, where refusing to send the
 * second one would break the guarantee CCB-S3-023 exempts from the rate limiter because a
 * publication that is silently not confirmed is the one failure this product cannot have.
 *
 * So the gate never sees a template. It is wired around the MODEL-WORDED text of the
 * conversation and lookup lanes only, before the application appends anything, and the
 * deterministic lines those lanes fall back to never pass through it.
 *
 * ── THE NUMBERS, AND WHERE EACH ONE COMES FROM ───────────────────────────────
 *
 * Character 5-gram Jaccard, which is what the stage-0 measurement used: robust to
 * punctuation drift and reordering, cheap at these lengths, and the 486 case - the known
 * reproducible trigger - scores 1.0000 on both of its pairs.
 *
 * THRESHOLD 0.8: the measured operating point. Her-lane false positives at 0.8 were 26 of
 * 520 replies, and 10 of those are removed by the floor below; the residue is genuine
 * near-repeats a resample improves.
 *
 * FLOOR 40 CHARACTERS: the short-confirmation exemption the research warned about and the
 * measurement confirmed - 8 of the 26 her-lane hits were the 18-character holding line.
 * Two short replies agreeing is conversation, not a defect.
 *
 * WINDOW 5 REPLIES: what the measurement compared against. In-memory and per room; a
 * restart forgets it, which costs at most one repeat after a deploy and keeps this module
 * free of the database.
 *
 * RESAMPLES 2: the briefing's own bound ("after two or three failures, send a
 * deterministic line rather than the duplicate"). Each retry is one more model call at
 * temperature 0.7 under the D-252 window, which is usually enough to land elsewhere.
 */

/** Character n-grams. Lowercased, whitespace collapsed, so punctuation drift scores high. */
export function shingles(text: string, n = 5): Set<string> {
  const s = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (s.length < n) return new Set(s === '' ? [] : [s]);
  const out = new Set<string>();
  for (let i = 0; i + n <= s.length; i++) out.add(s.slice(i, i + n));
  return out;
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return a.size === b.size ? 1 : 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export const REPETITION_THRESHOLD = 0.8;
export const REPETITION_MIN_CHARS = 40;
export const REPETITION_WINDOW = 5;
export const REPETITION_RESAMPLES = 2;

/**
 * Whether this reply is a near-duplicate of something she recently said here.
 *
 * Pure, so the check can drive every branch. A reply under the floor is never a duplicate;
 * a prior under the floor is never a witness against it, for the same reason in the other
 * direction.
 */
export function isNearDuplicate(text: string, priors: readonly string[]): boolean {
  if (text.length < REPETITION_MIN_CHARS) return false;
  const candidate = shingles(text);
  for (const prior of priors) {
    if (prior.length < REPETITION_MIN_CHARS) continue;
    if (jaccard(candidate, shingles(prior)) >= REPETITION_THRESHOLD) return true;
  }
  return false;
}
