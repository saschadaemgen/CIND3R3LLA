/**
 * Whether an answer may cite a passage: the declaration is a veto, this is the evidence.
 * (CCB-S5-060 follow-up, D-256)
 *
 * ── THE DEFECT, AS OBSERVED LIVE ─────────────────────────────────────────────
 *
 * Asked how many people use SimpleX, she said she did not know - correctly - and under it the
 * application printed `📄 From what you gave me: <two document titles>`. The source line
 * names what the model DECLARED it used, through the `usedDocuments` indices in the reply
 * schema, and the model declared two passages for an answer that used nothing. D-243 made
 * the declaration a veto that can only narrow what retrieval admitted, and that reasoning
 * is still right; what it left out is that a veto which does not fire is indistinguishable
 * from a use that happened. The declaration does not hold on a refusal.
 *
 * ── THE RULE: EVIDENCE OF USE, OR NO LINE ────────────────────────────────────
 *
 * A passage may be cited only when the ANSWER demonstrably carries something from it: a
 * content term that appears in the answer and in the passage and NOT in the member's own
 * question. The question is subtracted because a refusal is built from the question's
 * words ("I don't know how many people use SimpleX") and a passage about SimpleX shares all
 * of those for free. Stopwords are subtracted because "the", "and", "servers" prove nothing.
 * What is left is the vocabulary the answer could only have taken from the document.
 *
 * This is the allow-list direction (D-201): it states what may be attributed and refuses
 * the rest. Its failure is a MISSING line on a heavily paraphrased answer, which is the
 * direction D-243 already chose for the declaration itself ("never a source line on a
 * refusal"). A refusal-shaped answer is refused outright by {@link looksLikeRefusal}, which
 * is a floor under the evidence rule rather than the rule: a term list fails open on
 * wording it has not met, and the evidence rule is what holds when it does.
 *
 * ── THE NUMBERS ARE MEASURED (D-184), ON HIS CORPUS AND HIS MODEL ───────────
 *
 * `scripts/measure-provenance.ts`, eighteen questions over the operator's real documents
 * through the production request shape: seven true answers carried 4 to 12 passage terms
 * beyond the question; six refusal-shaped replies that DECLARED a document carried 0 (five
 * of them) or 3 (one, naming the notes it had checked, which the floor caught). The model's
 * declaration was false on 6 of 15. So {@link EVIDENCE_MIN_TERMS} is 2: every true answer
 * clears it with margin and every refusal that the floor did not catch sits at 0.
 *
 * And the case the term rule alone gets wrong: "what is the latest SimpleGo version" ->
 * `v0.2.0-beta`, a TRUE answer from the release notes, tokenises to ONE term and would lose
 * its citation. Its 5-gram shingle share against the passage is 1.00, where the highest
 * refusal measured 0.26 and the highest meta-reference 0.14. So a short near-verbatim answer
 * has a second door, {@link EVIDENCE_VERBATIM_SHARE} at 0.5, with that margin under it.
 */

import { shingles } from './repetition.js';

/** Distinct passage terms an answer must carry before that passage may be cited. */
export const EVIDENCE_MIN_TERMS = 2;
/** Or: the share of the answer's own 5-gram shingles found in the passage, for a short verbatim answer. */
export const EVIDENCE_VERBATIM_SHARE = 0.5;

/**
 * Function words and the near-empty vocabulary of an answer about anything, EN and DE. A
 * shared stopword is not evidence of reading; a shared rare word is. Deliberately short:
 * the list's job is to stop "the servers" from counting, not to model the language.
 */
const STOPWORDS = new Set<string>([
  // EN
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'had', 'her', 'was',
  'one', 'our', 'out', 'has', 'his', 'how', 'its', 'may', 'who', 'did', 'get', 'let', 'say',
  'she', 'too', 'use', 'that', 'with', 'have', 'this', 'will', 'your', 'from', 'they', 'know',
  'want', 'been', 'good', 'much', 'some', 'time', 'very', 'when', 'come', 'here', 'just',
  'like', 'long', 'make', 'many', 'more', 'most', 'over', 'such', 'take', 'than', 'them',
  'well', 'were', 'what', 'into', 'also', 'does', 'about', 'which', 'their', 'there', 'would',
  'could', 'should', 'these', 'those', 'other', 'after', 'before', 'where', 'while', 'being',
  'because', 'through', 'between', 'without', 'within', 'around', 'still', 'only', 'then',
  'than', 'each', 'every', 'both', 'same', 'something', 'anything', 'nothing', 'everything',
  'really', 'quite', 'rather', 'maybe', 'perhaps', 'sure', 'thing', 'things', 'people', 'way',
  'ask', 'asked', 'tell', 'told', 'think', 'thought', 'see', 'look', 'looked', 'give', 'given',
  'find', 'found', 'need', 'needs', 'work', 'works', 'running', 'run', 'runs', 'using', 'used',
  'uses', 'server', 'servers', 'system', 'systems', 'number', 'numbers', 'part', 'parts', 'data',
  'cannot', 'wont', 'dont', 'doesnt', 'didnt', 'isnt', 'arent', 'wasnt', 'couldnt', 'wouldnt',
  'shouldnt', 'havent', 'hasnt', 'ive', 'youre', 'theyre', 'thats', 'whats', 'lets', 'its',
  'darling', 'sorry', 'honestly', 'afraid', 'question', 'questions', 'answer', 'answers', 'idea',
  'folks', 'guys', 'someone', 'somebody', 'anyone', 'anybody', 'nobody',
  // DE
  'der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'einer', 'eines', 'einem', 'einen',
  'ich', 'du', 'sie', 'wir', 'ihr', 'es', 'mit', 'von', 'auf', 'für', 'fuer', 'zu', 'im', 'in',
  'an', 'den', 'dem', 'des', 'auch', 'aber', 'oder', 'wie', 'was', 'wer', 'wo', 'wann', 'warum',
  'dass', 'daß', 'noch', 'nur', 'schon', 'sehr', 'mehr', 'viel', 'viele', 'wenn', 'dann', 'als',
  'bei', 'nach', 'über', 'ueber', 'unter', 'durch', 'ohne', 'gegen', 'kann', 'kannst', 'können',
  'koennen', 'weiß', 'weiss', 'weisst', 'weißt', 'wissen', 'habe', 'hast', 'hat', 'haben',
  'sind', 'war', 'waren', 'wird', 'werden', 'wurde', 'sein', 'seine', 'seiner', 'ihre', 'ihren',
  'mein', 'meine', 'dein', 'deine', 'kein', 'keine', 'keinen', 'ahnung', 'leider', 'frage',
  'fragen', 'antwort', 'sache', 'sachen', 'leute', 'jemand', 'niemand', 'etwas', 'nichts',
  'alles', 'hier', 'dort', 'jetzt', 'heute', 'gibt', 'geht', 'macht', 'sagen', 'sage', 'sagt',
  'denke', 'glaube', 'vielleicht', 'eigentlich', 'wirklich', 'ziemlich', 'genau', 'also',
  'server', 'system', 'nummer', 'zahl', 'teil', 'daten', 'läuft', 'laeuft', 'laufen',
]);

/** Lowercased word tokens of three or more letters or digits, with stopwords removed. */
export function contentTerms(text: string): Set<string> {
  const out = new Set<string>();
  const normalized = text.toLowerCase().replace(/['’]/g, '');
  for (const m of normalized.matchAll(/[\p{L}\p{N}]{3,}/gu)) {
    const term = m[0];
    if (!STOPWORDS.has(term)) out.add(term);
  }
  return out;
}

export interface EvidenceOfUse {
  /** Terms the answer shares with the passage and did not take from the question. */
  terms: string[];
  /**
   * The share of the answer's 5-gram shingles, minus the question's, that the passage also
   * contains. Reported by the measurement beside the term count; the gate uses the terms.
   */
  shingleShare: number;
}

/**
 * What the answer carries from the passage that it could not have taken from the question.
 */
export function evidenceOfUse(
  answer: string,
  question: string,
  passage: string,
): EvidenceOfUse {
  const asked = contentTerms(question);
  const passageTerms = contentTerms(passage);
  const terms: string[] = [];
  for (const term of contentTerms(answer)) {
    if (asked.has(term)) continue;
    if (passageTerms.has(term)) terms.push(term);
  }
  const askedShingles = shingles(question.toLowerCase());
  const passageShingles = shingles(passage.toLowerCase());
  let considered = 0;
  let shared = 0;
  for (const s of shingles(answer.toLowerCase())) {
    if (askedShingles.has(s)) continue;
    considered += 1;
    if (passageShingles.has(s)) shared += 1;
  }
  return { terms, shingleShare: considered === 0 ? 0 : shared / considered };
}

/**
 * The floor under the evidence rule: an answer shaped like a refusal cites nothing, whatever
 * was declared and whatever it happens to share. EN and DE, her plain forms and the
 * persona-voiced ones the abstention measurement met ("a question for the folks running the
 * servers", "never heard of it"). A term list, so it fails OPEN on wording it has not seen -
 * which is why it is the floor and {@link evidenceOfUse} is the rule.
 */
export const REFUSAL_FLOOR =
  /\b(i (do not|don't|dont|cannot|can't|cant) (know|say|tell|help|answer|confirm|do that|do this)|no idea|no (info|information|data|details?|word|record|mention)\b|not (specified|covered|mentioned|detailed|listed|documented|stated|provided|given)\b|(isn'?t|aren'?t|wasn'?t|weren'?t|not|nothing) [^.!?\n]{0,40}\b(in|covered|mentioned|detailed|specified|listed|written) (in |by )?(the |my |those |these |your |his |her )?(provided |given )?(docs?|documents?|notes|material|files|papers|sources|unterlagen|dokumenten?|notizen)\b|not (a clue|sure|something i know|in (the|my|those|these) (documents?|notes|papers|files|material))|never heard|can't (find|see) (that|it|anything)|nothing (in (the|my|those|these|what)|i was (given|handed))|doesn'?t (say|mention|cover|tell)|(question|one) for (the|whoever|whoever's|somebody|someone)|out of my (depth|reach|hands)|beyond me|i'?d (only )?be guessing|couldn'?t tell you|ich (weiß|weiss) (es )?nicht|keine ahnung|kann ich (dir |euch )?nicht (sagen|beantworten)|nicht (in (den|meinen|diesen) (unterlagen|dokumenten|notizen)|sicher)|nie (davon )?gehört|steht (da |dort |hier )?nicht|da müsstest du|müsste ich raten|wüsste ich nicht)\b/iu;

export function looksLikeRefusal(answer: string): boolean {
  return REFUSAL_FLOOR.test(answer.normalize('NFC'));
}

/**
 * Which of the declared passages the answer may actually cite.
 *
 * `declared` is the model's index list, already bounded by the caller to the handed set.
 * Each index survives only if the answer carries {@link EVIDENCE_MIN_TERMS} terms from that
 * passage beyond the question, or reproduces it near-verbatim ({@link EVIDENCE_VERBATIM_SHARE}
 * of its own shingles), and none survives a refusal-shaped answer. The result can only be a
 * subset of `declared`: nothing here can add a citation.
 */
export function attributable(
  declared: readonly number[],
  passages: readonly string[],
  answer: string,
  question: string,
  minTerms = EVIDENCE_MIN_TERMS,
  verbatimShare = EVIDENCE_VERBATIM_SHARE,
): number[] {
  if (looksLikeRefusal(answer)) return [];
  const kept: number[] = [];
  for (const index of declared) {
    const passage = passages[index];
    if (passage === undefined) continue;
    const e = evidenceOfUse(answer, question, passage);
    if (e.terms.length >= minTerms || e.shingleShare >= verbatimShare) kept.push(index);
  }
  return kept;
}
