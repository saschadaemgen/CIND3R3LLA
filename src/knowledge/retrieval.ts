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
 * `minScore: 0.60` is MEASURED TWICE, and both of its predecessors were measured failing.
 * It started life as a guess of 0.45; the first measurement, against nomic-embed-text on the
 * operator's own kind of material, moved it to 0.55:
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
 * Then 0.55 failed the same way in production (the fourth sighting of the false source line,
 * D-226): the ingested SimpleGo README turned out to carry a NOISE BAND of 0.53 - 0.58
 * against questions it has nothing to say about, and the operator's own sentence - "do you
 * have Chillstep Music" - scored 0.575 against it. The chunk cleared the floor, the passages
 * could not answer, and knowledge.no-invention then instructed her to deny what her own DJ
 * sheet in the same prompt stated. Genuinely covered questions against the same document
 * scored 0.65 - 0.77, so the gap between every measured noise value and every measured
 * relevant value is [0.58, 0.62]; 0.60 sits in its middle with margin both ways.
 *
 * It remains the most consequential number here and the operator will still tune it, which is
 * why the measurement is written down rather than only the value, and why
 * `npm run calibrate:knowledge-relevance` exists: it prints these bands for whatever material a
 * deployment actually ingests, on the deployment, per D-184.
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
  minScore: 0.6,
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

/**
 * Whether this message is ASKING something, which is the upstream half of the attribution
 * defect (CCB-S5-055 stage 1, D-243).
 *
 * ── WHY THE FLOOR WAS NEVER GOING TO CARRY THIS ──────────────────────────────
 *
 * The trigger's own comment argued that `always` is safe because "the RELEVANCE FLOOR is
 * what decides whether anything is used". Measured on the operator's deployment, it does
 * not. Of 38 source lines emitted, all 38 came from free conversation and 16 named a
 * document with nothing to do with the answer - a greeting, a translation, an
 * acknowledgement, and a pasted deploy log, each of which cleared a 0.60 floor against his
 * corpus. The reason is the one `hasRetrievableContent` already states for emoji and which
 * turns out to be true of ordinary sentences too: **a similarity score is a property of the
 * corpus, not a statement about the message.** Two documents in his corpus sit high enough
 * against almost anything that they were handed over for a migration log.
 *
 * D-183 is the rule: when a lane states a bar, the bar is a predicate over the TEXT or it
 * does not exist. This is that predicate.
 *
 * ── IT IS AN ALLOW-LIST, PER D-201 ───────────────────────────────────────────
 *
 * The obvious shape is a list of things that are not questions - greetings, thanks, log
 * output - and that is a deny-list on a path where the unlisted case is the one that leaks.
 * So this states what MAY retrieve: a message that asks something. A question mark, an
 * interrogative word, or an explicit request to look in his documents.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────────
 *
 * It does not try to judge whether the question is ABOUT his documents. Nothing in the text
 * can know that, the floor cannot know it either, and guessing would refuse real questions -
 * which the trigger's comment correctly calls the worse defect, because she would answer
 * without the documents and say nothing about why. It removes the class that provably is not
 * a question, and the declaration downstream removes the rest.
 *
 * SELF-QUESTIONS ARE EXCLUDED, reusing D-238's closed set through `asksAboutSelf`: "what are
 * your functions" is a question, and the answer is never in the operator's documents. That
 * sighting named an SS7 paper.
 */
/**
 * Interrogatives that mark a question WHEREVER they appear.
 *
 * German `was` is deliberately absent, and that is the kind of collision a word list has to
 * be built around rather than discovered by: it is "what" in German and a past copula in
 * English, so admitting it anywhere would admit every English sentence containing "it was".
 * It is handled as a leading word below, where "Was ist..." is a question and "it was live"
 * is not.
 */
const INTERROGATIVE =
  /\b(what|whats|who|whose|whom|when|where|why|how|which|wer|wen|wem|wessen|wann|wo|woher|wohin|warum|wieso|weshalb|wie|welche[rsnm]?)\b/iu;

/**
 * An explicit request for information, anywhere in the message. Not a question by grammar,
 * but a request by intent, and refusing "explain the handover" would be absurd.
 *
 * CALIBRATED AGAINST THE REAL TRAFFIC rather than imagined. Every message that produced a
 * source line on the operator's deployment was read back out of the archive and run through
 * this predicate: every genuine document question was question-shaped, and exactly ONE was
 * missed - "Name the five mistakes a new developer is most likely to make" - which is why
 * "name the" and "list the" are here. The messages themselves are not reproduced in this
 * repository, which is public; only the shapes they taught.
 */
const INFORMATION_REQUEST =
  /\b(tell me|explain|describe|summari[sz]e|name the|list the|give me|erklär|erklaere|erkläre|beschreib|zusammenfass|nenne|liste)/iu;

/**
 * Auxiliaries that mark a question only by INVERSION, so they count only at the start of the
 * message or of a sentence inside it.
 *
 * This is the clause that "Aktivity Stream is live." caught during the check's first run: a
 * bare `\b(is|are|was|can|does)\b` match admits most declarative sentences ever written, and
 * a predicate that admits statements is the `always` trigger again with extra steps.
 */
const LEADING_AUXILIARY =
  /(^|[.!?]\s+)(is|are|was|were|do|does|did|can|could|will|would|should|has|have|ist|sind|war|waren|kann|kannst|könnte|hat|haben|wird|würde|soll|darf)\b/iu;

export function looksLikeAQuestion(text: string): boolean {
  const t = text.trim();
  if (t === '') return false;
  if (t.includes('?')) return true;
  if (INTERROGATIVE.test(t)) return true;
  if (INFORMATION_REQUEST.test(t)) return true;
  return LEADING_AUXILIARY.test(t);
}

/** Possessives and pronouns that make a question about HER rather than about his documents. */
const SELF_REFERENCE = new Set([
  'you',
  'your',
  'yours',
  'yourself',
  'du',
  'dein',
  'deine',
  'deinem',
  'deinen',
  'deiner',
  'deines',
  'dich',
  'dir',
]);

export function asksAboutSelf(text: string): boolean {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .some((token) => SELF_REFERENCE.has(token));
}

/**
 * The whole upstream decision, in one predicate, so there is one place to read and one
 * place to mutate.
 *
 * `explicitlyAsked` is the operator's own "check your documents" phrasing, which overrides
 * everything: if a member says so in words, she looks, whatever shape the sentence has.
 */
export function shouldRetrieve(text: string, explicitlyAsked: boolean): boolean {
  if (explicitlyAsked) return true;
  if (!hasRetrievableContent(text)) return false;
  if (!looksLikeAQuestion(text)) return false;
  if (asksAboutSelf(text)) return false;
  return true;
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
 * The documents that were PUT IN FRONT OF HER, in the order the passages were handed over.
 *
 * This is a fact the application knows, and since CCB-S5-055 it is no longer the attribution:
 * it is the candidate list the declaration selects from, and the operator's record of what a
 * turn was holding. `attributionForUsed` is what a member sees.
 *
 * The ORDER is load-bearing now in a way it was not before: index `n` here is index `n` in the
 * `referenceDocuments` array the model is shown, so the two must be built from the same
 * `outcome.selected` in the same order. They are.
 */
export function documentsHanded(outcome: RetrievalOutcome): string[] {
  const seen = new Map<number, string>();
  for (const c of outcome.selected) {
    if (!seen.has(c.documentId)) seen.set(c.documentId, c.documentTitle);
  }
  return [...seen.values()];
}

/**
 * The documents the answer actually USED, from the model's own declaration (D-243).
 *
 * ── WHY THIS REPLACES NAMING WHAT WAS HANDED OVER ────────────────────────────
 *
 * D-137 chose to name what she was handed, reasoning that it is a fact the code knows while
 * "which documents she used" is a claim she would sometimes get wrong. The reasoning is sound
 * and the conclusion was not: a correct refusal to use a document still printed as
 * provenance. Measured on the deployment, 16 of 38 lines named a document unrelated to the
 * answer, and the last one certified invented claims about a third party.
 *
 * ── IT IS THE WEB MECHANISM, AND IT TRANSFERS ────────────────────────────────
 *
 * `attribution.ts` has done exactly this for search since CCB-S4-042: the model returns the
 * indices of the results it used, and everything about that list is treated as untrusted -
 * out-of-range, duplicate, non-integer and negative entries are dropped rather than clamped,
 * because a clamped index cites something the answer did not use.
 *
 * The operator asked whether it transfers, given web results arrive as a small numbered set.
 * Passages do too: `maxChunks` and the character budget bound `outcome.selected` to a handful,
 * and both ride in the SAME user-message JSON as positional arrays. So the property that makes
 * the web mechanism work is present here.
 *
 * It is better here in one respect. The model is shown the passage text and NEVER the document
 * name (CCB-S5-027, D-180), so its declaration is over anonymous slots and the application does
 * the naming. It cannot invent a title; it can only point at a slot it was given.
 *
 * It is worse in one respect, stated rather than glossed: a passage is a CHUNK, so several
 * indices can name one document. They are de-duplicated by `documentId`, which is why this
 * takes the outcome rather than the already-flattened list.
 *
 * ── AND THE DECLARATION IS A VETO, NOT A SOURCE OF TRUTH ─────────────────────
 *
 * This is the part that matters, and it is why a self-report is acceptable here when D-183
 * says a bar in a prompt is not a bar. Retrieval decides what CAN be cited; the declaration
 * can only narrow that set. Neither alone can produce a citation, and nothing the model says
 * can add a document that was not retrieved - an index outside the handed set is dropped, not
 * clamped. The failure that remains is a model declaring a passage it did not really use,
 * which prints a line no worse than the one this replaces; the failure it removes is the one
 * that actually happened, six times.
 */
export function attributionForUsed(
  handedTitles: readonly string[],
  used: readonly number[],
): string[] {
  const seen: string[] = [];
  for (const index of used) {
    // Untrusted input, dropped rather than clamped, exactly as the web path does. An index
    // outside the handed set is the case that matters: it is how a model would name a
    // document that was never retrieved, and dropping it is what makes the declaration
    // incapable of ADDING a source.
    if (!Number.isInteger(index) || index < 0 || index >= handedTitles.length) continue;
    const title = handedTitles[index];
    if (title === undefined) continue;
    // De-duplicated by TITLE, which is equivalent to de-duplicating by document: several
    // chunks of one document carry the same one, and a document contributing three passages
    // must be named once.
    if (!seen.includes(title)) seen.push(title);
  }
  return seen;
}
