/**
 * The relevance bar for web search (CCB-S5-028, D-183).
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────────
 *
 * The operator asked a question about his own protocol work. Two university pages about
 * amending human-subjects research protocols for ethics review came back, were handed to the
 * model as though they were answers, and the reply that followed stated a technical position,
 * invented a provenance for it, called his documentation outdated and pointed at his own
 * GitHub repository as confirmation. Then the application printed
 * `🔎 From the web: research.uoregon.edu, hrpp.research.virginia.edu` underneath it.
 *
 * The word "protocol" matched. Nothing else did.
 *
 * The knowledge base has refused to hand over anything below a measured floor since
 * CCB-S5-022 and says so honestly instead (D-176). Web search had no equivalent, so
 * everything a provider returned was evidence.
 *
 * ── WHAT SIGNAL IS AVAILABLE, ESTABLISHED RATHER THAN ASSUMED ────────────────
 *
 * A {@link SearchResult} is a title, a snippet and a URL, and that is deliberately the whole
 * shape: nothing in this codebase fetches a page. No shipped provider returns a score. Result
 * ORDER is a ranking, but a ranking of an empty field still has a first place, which is
 * exactly what happened.
 *
 * So the signal has to be computed here, and there is one already in the building: the
 * `nomic-embed-text` embedder the knowledge base uses. Same model, same task prefixes, one
 * batched call for the results and one for the query. It is deterministic given the model,
 * which is what lets a check mutation-prove it.
 *
 * **A LEXICAL OVERLAP CHECK WAS CONSIDERED AND REJECTED, and the reason is the defect
 * itself.** Query and result shared the word "protocol"; a term-overlap test passes that case
 * with room to spare. It would have looked like a safety net while admitting the exact
 * failure it was built for, which is worse than no net. It is not here, and this paragraph is
 * why.
 *
 * A model gate was considered too: ask the reply model whether each result answers the
 * question. D-145 settled the shape of that argument for the pre-search gate - a model gate
 * is another inference on untrusted input, it can be argued out of its answer, and it cannot
 * be mutation-tested - and it costs an inference per result. Cosine is none of those things.
 *
 * ── THE FLOOR IS MEASURED, AND IT IS NOT THE KNOWLEDGE BASE'S ────────────────
 *
 * `npm run calibrate:search-relevance` is the measurement, and it exists because D-176
 * records the knowledge floor being guessed at 0.45 and being wrong. The numbers are in
 * {@link SEARCH_RELEVANCE_FLOOR}.
 *
 * ── PURE ─────────────────────────────────────────────────────────────────────
 *
 * No transport, no settings, no database. Vectors in, a decision out, so a harness drives
 * every branch with arrays and no model at all.
 */

import type { SearchResult } from './providers/types.js';

/**
 * The floor, MEASURED against `nomic-embed-text` over six queries and 27 results
 * (`npm run calibrate:search-relevance`, CCB-S5-028).
 *
 * ── WHY IT IS NOT 0.55 ───────────────────────────────────────────────────────
 *
 * Because the knowledge base's 0.55 would not have caught this. Measured on the production
 * failure itself, the two irrelevant university pages score **0.5813 and 0.5538**, both above
 * it. A floor copied across from the knowledge base would have shipped, passed every check,
 * and admitted the exact result set that caused the briefing. That is the whole reason the
 * calibration script exists rather than a constant somebody was confident about.
 *
 * The shapes are different and that is why the numbers are. A knowledge chunk is a thousand
 * characters of connected prose about one thing; a web result is a title and a 400-character
 * snippet written by a stranger to be clicked on. The whole usable range is compressed:
 * plainly unrelated material sits at 0.38-0.57 rather than near zero.
 *
 * ── THE MEASURED BANDS ───────────────────────────────────────────────────────
 *
 * | band | n | min | mean | max |
 * |---|---|---|---|---|
 * | relevant   | 7 | 0.7592 | 0.8206 | 0.8383 |
 * | adjacent   | 7 | 0.5813 | 0.6694 | 0.7526 |
 * | word-match | 7 | 0.4674 | 0.5959 | 0.7091 |
 * | unrelated  | 6 | 0.3780 | 0.4252 | 0.5738 |
 *
 * At 0.70: every relevant result survives, both production failures are rejected with 0.12 of
 * margin, six of seven word-matches go, and every unrelated result goes. 0.72 would take the
 * seventh word-match as well and would halve the margin under the lowest relevant result,
 * which is the wrong thing to spend margin on.
 *
 * ── WHAT IT DOES NOT DO, STATED RATHER THAN GLOSSED ──────────────────────────
 *
 * **It does not separate "same field, does not answer it" from "answers it".** The lowest
 * relevant result scored 0.7592 and the highest adjacent one 0.7526: a gap of 0.0066, which is
 * not a gap. Two adjacent results survive this floor, and no threshold on this signal would
 * remove them without dropping real answers.
 *
 * That is not a hole in the floor, it is the boundary between two different jobs, and the
 * second one belongs to the rule the same briefing adds. The floor removes material that is
 * about something ELSE, which is what produced the fabrication. Deciding that material about
 * the right subject still does not answer the question is a reading task, and she is now told
 * to say so plainly when it happens. Neither half is sufficient alone, which is why both are
 * in this briefing.
 *
 * The trade is stated too: a high bar will sometimes drop a result that would have helped. The
 * failure it prevents is a confident answer wearing a citation; the failure it causes is "I
 * looked and found nothing I would stand behind", which is a sentence she can say honestly.
 *
 * And the honest limit on the measurement itself: the calibration snippets were AUTHORED for
 * the bands they sit in, apart from the two production ones, so the numbers describe a set
 * chosen to be decidable. Re-run the script when the embedder changes, and read
 * `verify:search-live` rather than trusting this constant.
 */
export const SEARCH_RELEVANCE_FLOOR = 0.7;

/** Cosine similarity. The one calibrated number, exactly as the knowledge base uses it. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * What actually gets embedded for a result.
 *
 * Title and snippet TOGETHER, as one string. Measured both ways during calibration: the title
 * alone separates the bands less well, because a title is written to be clicked on and a
 * snippet is where the subject matter is. The exported helper means the calibration script and
 * the service embed the identical string, which is the same reasoning that keeps the
 * `search_document:` prefix inside `Embedder` rather than at its call sites.
 */
export function searchRelevanceText(result: { title: string; snippet: string }): string {
  return `${result.title}. ${result.snippet}`.trim();
}

/** One result and what the floor thought of it. */
export interface ScoredResult {
  result: SearchResult;
  score: number;
  kept: boolean;
}

export interface RelevanceOutcome {
  /** What survives, in the provider's own order. Possibly empty, which is a real answer. */
  kept: SearchResult[];
  /** Every result with its score, for the console and the checks. Never sent to a model. */
  scored: ScoredResult[];
  /** The best score seen, or null when there was nothing to score. For the operator. */
  best: number | null;
  /**
   * True when results came back and the floor rejected ALL of them.
   *
   * This is the honest-nothing signal, and it is deliberately distinct from "the provider
   * returned nothing": one is an internet with nothing relevant in it, the other is an
   * internet that did not answer. She says different things about them, which is the same
   * distinction `SearchFailure` already draws between `no-results` and `provider-error`.
   */
  emptyBecauseOfFloor: boolean;
}

/**
 * Apply the floor.
 *
 * `scores` is positional against `results`. A missing or non-finite score counts as BELOW the
 * floor rather than above it: a result nobody could score is a result nobody can vouch for,
 * and the direction to fail in is the one that hands the model less.
 */
export function applyRelevanceFloor(
  results: readonly SearchResult[],
  scores: readonly number[],
  floor: number = SEARCH_RELEVANCE_FLOOR,
): RelevanceOutcome {
  const scored: ScoredResult[] = results.map((result, i) => {
    const raw = scores[i];
    const score = typeof raw === 'number' && Number.isFinite(raw) ? raw : Number.NEGATIVE_INFINITY;
    return { result, score, kept: score >= floor };
  });

  const kept = scored.filter((s) => s.kept).map((s) => s.result);
  const finite = scored.map((s) => s.score).filter((s) => Number.isFinite(s));

  return {
    kept,
    scored,
    best: finite.length > 0 ? Math.max(...finite) : null,
    emptyBecauseOfFloor: results.length > 0 && kept.length === 0,
  };
}
