/**
 * The Book as a conversation (CCB-S4-048, D-150).
 *
 * ── WHY AN ORIENTATION RATHER THAN AN EXCERPT ────────────────────────────────
 *
 * Production settled this. Both of the earlier answers are wrong for a live group: the brief
 * answer quotes three or four rules in full, back to back, which is a block nobody reads, and
 * the recital sends several messages into a room where other people are talking.
 *
 * So a general question gets an ORIENTATION. How many laws there are, how many are
 * constitutional, what they broadly cover, that some are withheld and why, and an invitation.
 * Nobody reads eighty-two rules; everybody asks about the one that interests them. The
 * quoting happens on the follow-up, where it answers something.
 *
 * ── THE COUNTS ARE FACTS AND THE MODEL DOES NOT PRODUCE THEM ─────────────────
 *
 * D-137: a model asked to preserve a number inside prose it is writing corrupts it. A bot
 * that misstates how many laws it has is worse than one that does not say. So the counts are
 * computed here, rendered into the prompt through placeholders, AND passed as required
 * literals, which the reply path rejects a reply for losing.
 *
 * The WITHHELD count is deliberately not among them. The existing disclosure rules say there
 * are more without giving a number, which is all CCB-S4-046 requires, and a number in the
 * prompt that is not protected is a number she can get wrong. Two protected facts beat three
 * facts where one is a guess.
 */

import { oneOfEachVariant, type RecitalChapter } from './recital.js';
import { SELF_REFERENTIAL } from './disclosure.js';
import type { PromptRule, PromptRuleSet } from './prompt-rules.js';

/**
 * How many rules one answer may quote (CCB-S4-048).
 *
 * TWO. One is often not enough (a limit and the reason for it are frequently two rules), and
 * three is where an answer stops reading as an answer and starts reading as the list this
 * briefing exists to stop producing. Past the cap she says there are more in that area and
 * invites another question, which is the shape the whole feature is built around.
 */
export const FOLLOW_UP_MAX_RULES = 2;

export interface RuleOverview {
  /** Enabled rules. What she is actually operating under, not what the table holds. */
  total: number;
  /** Of those, the ones no dial relaxes. */
  constitutional: number;
  /** What they broadly cover, in the operator's chapter titles, localised. */
  areas: string[];
}

/**
 * The orientation facts.
 *
 * Areas come from the recital's chapters (CCB-S4-047), which is exactly the level the
 * briefing asks for and means there is ONE authored description of what her rules cover
 * rather than a second list that drifts from the first. A chapter that claims nothing is left
 * out, because naming an empty area is describing rules she does not have.
 */
export function ruleOverview(
  rules: PromptRuleSet,
  chapters: readonly RecitalChapter[],
  lang: string,
): RuleOverview {
  const enabled = rules.filter((rule) => rule.enabled);
  const german = lang.toLowerCase().startsWith('de');
  const claims = (chapter: RecitalChapter): boolean =>
    enabled.some(
      (rule) =>
        rule.nameable && chapter.rulePrefixes.some((prefix) => rule.id.startsWith(prefix)),
    );

  return {
    total: enabled.length,
    constitutional: enabled.filter((rule) => rule.tier === 'constitutional').length,
    areas: chapters
      .filter((chapter) => chapter.enabled && claims(chapter))
      .sort((a, b) => a.ord - b.ord)
      .map((chapter) => (german ? chapter.titleDe : chapter.titleEn)),
  };
}

/** The areas as one line for the prompt. Plain commas: this is prose she reads, not a list. */
export function renderAreas(overview: RuleOverview, lang: string): string {
  const german = lang.toLowerCase().startsWith('de');
  const areas = overview.areas.map((area) => area.toLowerCase());
  if (areas.length <= 1) return areas[0] ?? '';
  const last = areas[areas.length - 1] ?? '';
  return `${areas.slice(0, -1).join(', ')} ${german ? 'und' : 'and'} ${last}`;
}

/**
 * The counts a reply must not lose.
 *
 * Required literals rather than trust, because this is precisely the D-137 failure: the
 * numbers are the one part of the overview the model has no way to check and every incentive
 * to smooth. A reply that drops or changes one is rejected and the deterministic answer goes
 * out instead, which is the right direction to fail in.
 */
export function overviewLiterals(
  overview: { total: number; constitutional: number } | undefined,
): string[] {
  // Absent is the ordinary case: every reply that is not an overview protects nothing here.
  if (!overview) return [];
  return [String(overview.total), String(overview.constitutional)];
}

/**
 * The rules a SPECIFIC question is answered with, and how many more were left.
 *
 * The selection itself is `rulesForQuestion`, which CCB-S4-045 already tuned to return the
 * strongest matches rather than everything that matched a filler word. This caps what comes
 * out of it and reports the remainder, so the prompt can tell her to offer the rest instead
 * of quietly reading two of nine.
 */
export function capFollowUp(matched: readonly PromptRule[]): {
  quoted: PromptRule[];
  more: number;
} {
  return {
    quoted: matched.slice(0, FOLLOW_UP_MAX_RULES),
    more: Math.max(0, matched.length - FOLLOW_UP_MAX_RULES),
  };
}

/**
 * The rules that answer a SPECIFIC question, chosen by area first.
 *
 * ── WHY THE KEYWORD SCORE ALONE WAS NOT ENOUGH ───────────────────────────────
 *
 * Measured live: *"what do you never do?"* selected `identity.affirm` and
 * `nickname.never-raise`, because both contain "never" and the scorer is looking at words.
 * The rules that answer that question are the four in the ceiling, and not one of them was
 * chosen. The briefing warned about exactly this class: selection by relevance, not by
 * whatever happens to share a token.
 *
 * The fix uses something the product already has and had not connected. CCB-S4-047's chapters
 * are an AUTHORED map of what her rules are about, written by the operator, in the operator's
 * words: "what I will never do", "what I keep back", "how I speak of you". A question that
 * matches a chapter title is a question about that area, and the rules in that area are the
 * candidates. There is no second vocabulary to maintain, and an operator who retitles a
 * chapter has retuned the selector.
 *
 * When no chapter matches, this is exactly `rulesForQuestion` and nothing changes.
 *
 * ── AND WHY ONE LAW CAN BE EXCLUDED (CCB-S5-005) ─────────────────────────────
 *
 * The scene ends by inviting a question about another page, so "tell me another" is the
 * commonest follow-up there is, and the selector had no idea a performance had just happened.
 * `justRead` is that one fact. It is a REMOVAL and never a preference: if excluding it would
 * leave nothing, it stays, because a law she has already read beats no law at all.
 */
export function rulesForFollowUp(
  rules: PromptRuleSet,
  chapters: readonly RecitalChapter[],
  question: string,
  lang: string,
  matched: readonly PromptRule[],
  justRead: string | null = null,
): PromptRule[] {
  const without = (candidates: readonly PromptRule[]): PromptRule[] => {
    if (!justRead) return [...candidates];
    const kept = candidates.filter((rule) => rule.id !== justRead);
    return kept.length > 0 ? kept : [...candidates];
  };

  const german = lang.toLowerCase().startsWith('de');
  const words = new Set(
    question
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3),
  );

  let best: RecitalChapter | null = null;
  let bestScore = 0;
  for (const chapter of chapters) {
    if (!chapter.enabled) continue;
    const title = (german ? chapter.titleDe : chapter.titleEn).toLowerCase();
    const score = title
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3 && words.has(word)).length;
    if (score > bestScore) {
      best = chapter;
      bestScore = score;
    }
  }
  // One word in common is a coincidence ("what" is in half of them). Two is a subject.
  if (!best || bestScore < 2) return without(matched);

  const inArea = oneOfEachVariant(
    rules.filter(
      (rule) =>
        rule.nameable &&
        rule.enabled &&
        // The rule that CARRIES the quoted block cannot be quoted into it, and both halves of
        // a condition-exclusive pair cannot be read as two laws. Both guards already exist for
        // the recital, and selecting by AREA reaches the same rules the recital does, so they
        // are shared rather than restated.
        !SELF_REFERENTIAL.test(rule.text) &&
        best.rulePrefixes.some((prefix) => rule.id.startsWith(prefix)),
    ),
  )
    .sort(
      (a, b) =>
        Number(b.tier === 'constitutional') - Number(a.tier === 'constitutional') ||
        a.ord - b.ord,
    );
  return inArea.length > 0 ? without(inArea) : without(matched);
}

/* ── Recognising her own chapter names (CCB-S4-049) ───────────────────────── */

/**
 * A member answering the overview's question, in the overview's own words.
 *
 * ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────────
 *
 * CCB-S4-048's overview ends by naming the six chapters and asking *"what part of it
 * interests you?"*, and then she could not hear the answer. Every natural reply missed:
 * "what do you never do?", "what do you owe me?" and "how do you treat what people tell you?"
 * all fell through to free conversation with no rule quoted, because a follow-up was only
 * recognised when the message contained the word "rules". Only *"which of your RULES cover
 * what you never do?"* worked, which nobody says.
 *
 * She proposed the words. A member repeating them back is unambiguously asking about that
 * chapter, and the mapping already exists: these are the operator's chapter titles from
 * CCB-S4-047, so nothing here is a second vocabulary to keep in step.
 *
 * ── SPECIFIC PHRASINGS, NOT TOPICS ───────────────────────────────────────────
 *
 * "What do you keep back?" is the chapter. "What do you keep of mine?" is the archive, and it
 * must go on reaching the archive. Matching loosely on "keep" would collapse the two, which
 * is the collision this briefing opened with, running in the other direction. Every pattern
 * here names a verb and its object; none of them is a bare topic word.
 *
 * ── AND WHY "WHO I AM" IS NOT IN HERE ────────────────────────────────────────
 *
 * "Who are you?" is the classic identity question, it resolves to HELP at 0.96 today, and
 * D-143 settled that it is answered as conversation from her origin and identity. That answer
 * is good, and replacing it with two quoted statutes would be the over-detection this briefing
 * warns is the worse failure. It stays conversation unless an overview has just invited it,
 * which is what the window is for.
 */
const CHAPTER_PHRASINGS: readonly RegExp[] = [
  // What I will never do. `never DO`, not `never <anything>`: "what do you never eat" is a
  // question about dinner.
  /\bwhat\b[^?]{0,20}\b(do|will|would|can)\s+you\s+never\s+do\b/i,
  /\bwhat\s+you\s+never\s+do\b/i,
  /\bwhat\b[^?]{0,16}\b(won'?t|will\s+not|refuse\s+to)\s+you\s+do\b/i,
  /\bwas\b[^?]{0,20}\b(tust|machst)\s+du\s+nie\b/i,
  /\bwas\s+du\s+nie\s+tust\b/i,
  // What I do with what I am told.
  /\bwhat\b[^?]{0,24}\bdo\s+with\s+what\b/i,
  /\bhow\s+do\s+you\s+treat\b[^?]{0,30}\b(told|tell|say|said|give|given)\b/i,
  /\bwas\s+machst\s+du\s+mit\b[^?]{0,24}\b(gesagt|sagt|erz[aä]hl)/i,
  // What I owe you. `owe ME`, or owe with nobody else named: "what do you owe the landlord"
  // is not this chapter.
  /\bwhat\b[^?]{0,16}\byou\s+owe\s+(me|us|them|people|anyone|everyone)\b/i,
  /\bwhat\b[^?]{0,16}\byou\s+owe\s*[?.!]/i,
  /\bwas\s+schuldest\s+du\b/i,
  // How I speak of you.
  /\bhow\s+do\s+you\s+(speak|talk)\s+(of|about)\s+(me|us|people|members|them)\b/i,
  /\bwie\s+(sprichst|redest)\s+du\s+[uü]ber\b/i,
  // What I keep back. Also the phrasing that collided with the archive STATUS intent.
  /\bwhat\b[^?]{0,16}\byou\s+(keep|hold)\s+back\b/i,
  /\bwhat\b[^?]{0,16}\byou\s+keep\s+to\s+yourself\b/i,
  /\bwas\b[^?]{0,16}\b(beh[aä]ltst|h[aä]ltst)\s+du\s+(zur[uü]ck|f[uü]r\s+dich)\b/i,
];

/** Does this repeat one of her chapter names back at her? */
export function asksChapterQuestion(text: string): boolean {
  return CHAPTER_PHRASINGS.some((pattern) => pattern.test(text));
}

/* ── Answering the SCENE's invitation (CCB-S5-005) ─────────────────────────── */

/**
 * A member taking up the scene's offer of another page.
 *
 * ── WHY THE SCENE'S WINDOW IS NARROWER THAN THE OVERVIEW'S ───────────────────
 *
 * CCB-S4-049's window promotes ANY otherwise-unclaimed message that arrives within three
 * minutes of an overview, and that is right for an overview: it ends by naming six chapters
 * and asking which one interests you, so the answer could be almost any sentence and there is
 * no way to recognise it in advance.
 *
 * A scene ends differently. It says: ask me about one and I will open the page. That is a much
 * narrower offer, and the briefing asks explicitly that an ordinary question shortly after a
 * scene still gets ordinary conversation. Opening the broad window here would have meant
 * "how are you?" ninety seconds after a performance coming back with two quoted statutes,
 * every time, in the one place a member is most likely to keep talking.
 *
 * So a post-scene message is promoted only when it asks for MORE. The other three ways into
 * the Book are unaffected and already cover most of what somebody would say: naming a rule
 * word, asking for a page number, or repeating one of her chapter names all reach it with no
 * window at all. What this adds is the bare answer to a bare invitation.
 *
 * The cost is a phrasing outside these, which falls to free conversation and costs one
 * clarifying question. That is the trade the window has always made, and here it is made once
 * rather than constantly.
 */
const ANOTHER_LAW: readonly RegExp[] = [
  // The WHOLE message and nothing else: "another", "and another?", "more". Anchored, because
  // a bare "more" inside a sentence is a quantity and this is a page turn.
  /^\s*(and\s+|ok,?\s+|okay,?\s+)?(another|more|next)\s*[?.!]*\s*$/i,
  /^\s*(und\s+)?(noch\s+eins|noch\s+eines|mehr|weiter)\s*[?.!]*\s*$/i,
  /\b(another|other)\s+(one|law|rule|page)\b/i,
  // "Cinderella, and another" reaches this with the address still on the front, so the
  // anchored forms above cannot see it. This is the same request with a name in front of it.
  /\b(and|then)\s+(another|one\s+more|the\s+next\s+one)\b/i,
  /\b(tell|read|give|show)\s+(me\s+)?(another|more|one\s+more)\b/i,
  /\b(what|anything|something)\s+else\b/i,
  /\b(one|any|some)\s+more\b/i,
  /\bnext\s+(one|law|rule|page)\b/i,
  /\bgo\s+on\b/i,
  /\bmore\s+of\s+(them|those|it)\b/i,
  /\bkeep\s+(going|reading)\b/i,
  // German
  /\bnoch\s+(ein|eins|eine|einen|mehr|was)\b/i,
  /\bwas\s+(steht|gibt\s+es|ist)\b[^?]{0,16}\bnoch\b/i,
  /\bwas\s+noch\b/i,
  /\bn[aä]chste[snr]?\s+(gesetz|regel|seite)\b/i,
  /\b(mach|lies)\s+weiter\b/i,
];

export function asksForAnotherLaw(text: string): boolean {
  return ANOTHER_LAW.some((pattern) => pattern.test(text));
}

/* ── Enacting a law: which chapter would claim it (CCB-S4-051) ─────────────── */

/**
 * The chapter a proposed id would land in, or null when nothing claims it.
 *
 * ── WHY THIS GUIDES RATHER THAN ONLY REPORTS ─────────────────────────────────
 *
 * The Recital page already lists laws no chapter claims, which is discovery AFTER the fact:
 * the operator finds out that a law he enacted last week has never been read out. For a law
 * being created right now the console can do better, and refuse.
 *
 * The stake is specific. Chapters claim rules by id prefix, longest match wins, so a law with
 * an id outside every family is in no chapter, and the conversational answer selects BY AREA
 * (CCB-S4-049). Such a law would be in her prompt, governing her, and unreachable by anybody
 * asking about that part of the Book. Silently unreadable is the worst of the three states a
 * law can be in.
 */
export function chapterForNewRule(
  chapters: readonly RecitalChapter[],
  ruleId: string,
): RecitalChapter | null {
  let best: RecitalChapter | null = null;
  let bestLength = -1;
  for (const chapter of chapters) {
    if (!chapter.enabled) continue;
    for (const prefix of chapter.rulePrefixes) {
      if (ruleId.startsWith(prefix) && prefix.length > bestLength) {
        best = chapter;
        bestLength = prefix.length;
      }
    }
  }
  return best;
}

/** Every prefix a chapter claims, for the console to offer as the families in use. */
export function ruleFamilies(chapters: readonly RecitalChapter[]): string[] {
  return [
    ...new Set(chapters.filter((c) => c.enabled).flatMap((c) => c.rulePrefixes)),
  ].sort();
}

/**
 * Why an id is not usable, or null when it is.
 *
 * Shape first, then family. The shape rules are the registry's own conventions rather than
 * taste: lowercase dotted segments are what every seeded id uses, and the console's own search
 * and the chapter prefixes both key on them.
 */
export function rejectRuleId(
  chapters: readonly RecitalChapter[],
  ruleId: string,
): string | null {
  const id = ruleId.trim();
  if (!id) return 'A law needs an id. It is what history and every check refer to.';
  if (!/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(id)) {
    return (
      'An id is lowercase, dotted, and has at least two parts, like "voice.swearing". ' +
      'The part before the first dot is the family, and it decides which chapter reads it out.'
    );
  }
  if (chapterForNewRule(chapters, id) === null) {
    return (
      `No chapter claims "${id}", so it would be in her prompt and unreadable by anybody ` +
      `asking about that part of the Book. Use one of the families in use, or give a chapter ` +
      `this prefix first on the Recital page.`
    );
  }
  return null;
}
