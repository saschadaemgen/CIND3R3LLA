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
 */
export function rulesForFollowUp(
  rules: PromptRuleSet,
  chapters: readonly RecitalChapter[],
  question: string,
  lang: string,
  matched: readonly PromptRule[],
): PromptRule[] {
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
  if (!best || bestScore < 2) return [...matched];

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
  return inArea.length > 0 ? inArea : [...matched];
}
