/**
 * Deciding what she is shown (CCB-S5-022, D-176).
 *
 * Pure. Given candidates with their two raw scores, this fuses them, applies the relevance
 * floor and spends the budget. No database, no model, so `verify:knowledge` can drive every
 * boundary case directly and the diagnostics page can render exactly what this decided.
 *
 * ── HYBRID, BECAUSE NEITHER HALF IS ENOUGH FOR THIS CORPUS ───────────────────
 *
 * The operator's material is protocol work full of exact identifiers (`apiListGroups`,
 * `differentActiveUser`, `CCB-S4-041`) sitting in ordinary prose. Keyword search finds a
 * token like that exactly and is useless for "which bot answers when two are in a group";
 * embeddings do the reverse, and they blur an identifier into its neighbourhood, which is
 * the one thing that must not happen to a symbol name. So both run and the results are
 * fused.
 *
 * ── FUSION IS WEIGHTED RECIPROCAL RANK, AND THE WEIGHT IS REAL ───────────────
 *
 * RRF scores a candidate `Σ weight_i / (k + rank_i)` over the lists it appears in. It is
 * used rather than score normalisation because the two scores are not comparable and never
 * become comparable: `ts_rank` is an unbounded relevance number whose scale depends on the
 * document, and cosine similarity is bounded. Normalising them against each other would
 * invent a common scale and then tune against the invention.
 *
 * k = 60 is the constant from the original RRF paper and is a GUESS here in the sense that
 * nothing about this corpus was measured to choose it. What it controls is how sharply the
 * top of each list dominates.
 *
 * The weights are the control worth having: raising the keyword weight makes an exact
 * identifier win, raising the vector weight makes a paraphrase win.
 *
 * ── THE FLOOR IS ON COSINE, AND ONLY ON COSINE ───────────────────────────────
 *
 * "Is this chunk actually relevant" needs a CALIBRATED number, and only one of the two is:
 * cosine similarity is bounded in [-1, 1] and means the same thing for every query. A floor
 * on the fused RRF score would be a floor on a number whose value depends on how many
 * candidates came back, which is a threshold the operator could never reason about.
 *
 * Every candidate carries a cosine similarity, including the ones only the keyword search
 * found, because the query vector exists and their embeddings exist. So the floor is one
 * number applied to every candidate on one scale.
 *
 * Below the floor, NOTHING is retrieved. That is the whole difference between a knowledge
 * base and a machine for delivering the least-bad chunk with a confident face on it.
 */

/** One chunk that came back from one or both searches. */
export interface Candidate {
  chunkId: number;
  documentId: number;
  documentTitle: string;
  ord: number;
  body: string;
  contextPrefix: string;
  /** Postgres `ts_rank` over the tsvector. 0 when the keyword search did not find it. */
  keywordScore: number;
  /** Cosine similarity in [-1, 1]. Always present: the query vector and the chunk vector both exist. */
  vectorScore: number;
  /** 1-based rank in the keyword list, or null when it was not in it. */
  keywordRank: number | null;
  /** 1-based rank in the vector list, or null when it was not in it. */
  vectorRank: number | null;
  /** The operator's per-document weight, multiplying the fused score. 1 is neutral. */
  documentWeight: number;
}

export interface RetrievalSettings {
  /** How many candidates each search returns before fusion. */
  candidatesPerSearch: number;
  /** How many survive fusion and the floor, before the budget. */
  maxChunks: number;
  /** Weight of the keyword list in the fusion. */
  keywordWeight: number;
  /** Weight of the vector list in the fusion. */
  vectorWeight: number;
  /** Cosine similarity below which a chunk is not retrieved at all. */
  minScore: number;
  /** Hard cap on all retrieved text reaching one prompt, in characters. */
  budgetChars: number;
}

/**
 * ── THE DEFAULTS, AND WHICH OF THEM ARE GUESSES ──────────────────────────────
 *
 * `budgetChars: 2400` is NOT a guess and it is not a tuning knob. It is the same number the
 * web search plugin uses for the same quantity, deliberately: both are untrusted text
 * entering a prompt whose context is 8192 tokens and whose rules already take roughly 2000.
 * 2400 characters is about 600 tokens. Two different numbers for one concept would be a
 * second thing to reason about at the moment somebody is reasoning about a leak.
 *
 * `minScore: 0.55` is MEASURED, and it started life as a guess of 0.45 that was wrong. The
 * measurement, against nomic-embed-text on the operator's own kind of material:
 *
 *   relevant question against the chunk that answers it   0.62 - 0.75
 *   unrelated question (mercury, sourdough, world cup)    0.39 - 0.43
 *   a real project topic that is NOT in this document     0.49
 *
 * 0.45 sat inside the top of the unrelated band, and it showed: a live run answered "what is
 * the boiling point of mercury" from the model and printed "From what you gave me: The Active
 * User Scheduler" underneath it. Nothing was wrong with the pipeline; the number was wrong,
 * and the failure it produced is precisely the one this feature must never have - an answer
 * that looks checked because a document name is under it.
 *
 * 0.55 sits between the bands with margin on both sides, and above the near-domain case,
 * which is the one worth being strict about: a question about media encryption must not be
 * answered from the scheduler document merely because both are about this project.
 *
 * It remains the most consequential number here and the operator will still tune it, which is
 * why the measurement is written down rather than only the value.
 *
 * `keywordWeight: 1.0` and `vectorWeight: 1.0` start neutral because the corpus has both
 * kinds of question in it and there is no evidence yet for tilting either way.
 *
 * `candidatesPerSearch: 20` and `maxChunks: 4` follow the budget: four chunks of a thousand
 * characters is already over 2400, so the budget binds before `maxChunks` does in the normal
 * case, and `maxChunks` is the guard for a document of very short chunks.
 */
export const RETRIEVAL_DEFAULTS: Readonly<RetrievalSettings> = Object.freeze({
  candidatesPerSearch: 20,
  maxChunks: 4,
  keywordWeight: 1.0,
  vectorWeight: 1.0,
  minScore: 0.55,
  budgetChars: 2400,
});

/**
 * Is there anything in this message to look up? (CCB-S5-037, D-195.)
 *
 * ── WHY A FLOOR CANNOT ANSWER THIS ───────────────────────────────────────────
 *
 * A member sent a heart emoji. She announced a lookup, answered with small talk about
 * emoji, and printed a document name about SS7 attacks underneath. Both the announcement
 * and the attribution are gated on the FLOOR having admitted a passage, so the floor was
 * the only thing between an emoji and a document name.
 *
 * MEASURED (`npm run calibrate:knowledge-floor`), and the number is not the point:
 *
 *     corpus A:  ❤️ scored 0.540 - below 0.55 by ONE HUNDREDTH, so it retrieved nothing
 *     corpus B:  ❤️ scored 0.582 - above it, so it retrieved a document
 *
 * Same emoji, same model, same floor; only the documents differed. And `❤️` and `👍`
 * scored IDENTICALLY against every document and ranked them in the same order - because a
 * message with no words carries nothing to distinguish them, so the vector is essentially
 * the query prefix and the result is a property of THE CORPUS, not of the message.
 *
 * That is why this is a predicate and not a bigger number. Raising the floor to 0.60 would
 * have refused "media retention" at 0.647 with almost no margin, and the next document the
 * operator uploads moves the emoji again. D-183 said it in a sentence: when a lane states a
 * bar, the bar is a predicate over the text or it does not exist.
 *
 * ── WHERE THE LINE IS, AND WHY IT IS DRAWN THERE ─────────────────────────────
 *
 * Deliberately narrow. It refuses what provably cannot be a lookup and nothing else, because
 * a member with a real question that this refused would be a worse defect than the one it
 * fixes: she would answer without the documents and say nothing about why.
 *
 *   - NO LETTERS OR DIGITS AT ALL. An emoji, a reaction, punctuation. There is no term to
 *     match, so there is nothing a retrieval could be about. This alone settles the
 *     production case, and it refuses nothing that could be a question.
 *   - FEWER THAN THREE alphanumeric characters. "ok", "ja", "👍!". Same reason.
 *
 * A single real word is NOT refused. "SS7" is three characters and a legitimate lookup, and
 * the measurement shows single words landing at 0.49-0.53 where the floor already handles
 * them. Two guards in series, each doing the part it can decide.
 */
const MIN_CONTENT_CHARS = 3;

export function hasRetrievableContent(text: string): boolean {
  // Unicode-aware: `\w` would count no accented letter and every underscore.
  const alphanumeric = [...text].filter((ch) => /\p{L}|\p{N}/u.test(ch)).length;
  return alphanumeric >= MIN_CONTENT_CHARS;
}

/** The RRF constant. See the header: the paper's value, not a measured one. */
export const RRF_K = 60;

/** Why a candidate did not make it into the prompt. */
export type RejectionReason = 'below-floor' | 'over-budget' | 'past-max-chunks';

export interface ScoredCandidate extends Candidate {
  /** Weighted reciprocal-rank fusion score, before the document weight. */
  fusedScore: number;
  /** `fusedScore * documentWeight`, which is what the ordering uses. */
  finalScore: number;
  /** True when this chunk reaches the prompt. */
  selected: boolean;
  /** Set only when `selected` is false. */
  rejectedBecause?: RejectionReason;
}

export interface RetrievalOutcome {
  /** EVERY candidate, scored and marked, in final order. The diagnostics page renders this. */
  candidates: ScoredCandidate[];
  /** The ones that reach the prompt, in order. */
  selected: ScoredCandidate[];
  /** Characters of chunk body spent. */
  charsUsed: number;
  /** True when the floor rejected everything, which is an honest "I have nothing". */
  emptyBecauseOfFloor: boolean;
}

/**
 * Fuse, floor, and spend the budget.
 *
 * The order of the three is load-bearing. The floor runs BEFORE the budget so a budget with
 * room in it cannot pull in an irrelevant chunk merely because there was space; and the
 * budget drops WHOLE chunks rather than truncating, for the reason the search service gives
 * about results: half a chunk reads as a different chunk than it is.
 */
export function retrieve(
  candidates: readonly Candidate[],
  settings: RetrievalSettings = RETRIEVAL_DEFAULTS,
): RetrievalOutcome {
  const scored: ScoredCandidate[] = candidates.map((c) => {
    const fusedScore =
      (c.keywordRank === null ? 0 : settings.keywordWeight / (RRF_K + c.keywordRank)) +
      (c.vectorRank === null ? 0 : settings.vectorWeight / (RRF_K + c.vectorRank));
    return {
      ...c,
      fusedScore,
      finalScore: fusedScore * c.documentWeight,
      selected: false,
    };
  });

  scored.sort((a, b) => b.finalScore - a.finalScore || a.chunkId - b.chunkId);

  let charsUsed = 0;
  let taken = 0;
  let anyPassedFloor = false;

  for (const c of scored) {
    // THE FLOOR, on the one calibrated number. See the header.
    if (c.vectorScore < settings.minScore) {
      c.rejectedBecause = 'below-floor';
      continue;
    }
    anyPassedFloor = true;
    if (taken >= settings.maxChunks) {
      c.rejectedBecause = 'past-max-chunks';
      continue;
    }
    const cost = c.body.length;
    if (charsUsed + cost > settings.budgetChars) {
      // WHOLE CHUNKS ONLY. Kept scanning rather than stopping, so a short chunk further
      // down can still fit where a long one did not; what it must never do is fit HALF of
      // the long one.
      c.rejectedBecause = 'over-budget';
      continue;
    }
    c.selected = true;
    charsUsed += cost;
    taken += 1;
  }

  return {
    candidates: scored,
    selected: scored.filter((c) => c.selected),
    charsUsed,
    emptyBecauseOfFloor: !anyPassedFloor && scored.length > 0,
  };
}

/**
 * The documents an answer actually drew on, for the attribution line.
 *
 * APPLICATION-WRITTEN, following D-137: the model is never asked which document it used and
 * never writes a character of this line. It says which documents were PUT IN FRONT OF IT,
 * which is a fact the application knows, rather than a claim the model makes.
 *
 * De-duplicated and ordered by best-scoring chunk, so a document contributing three chunks is
 * named once.
 */
export function attributionFor(outcome: RetrievalOutcome): string[] {
  const seen = new Map<number, string>();
  for (const c of outcome.selected) {
    if (!seen.has(c.documentId)) seen.set(c.documentId, c.documentTitle);
  }
  return [...seen.values()];
}
