/**
 * The Book of Elii's reading model (CCB-S4-043, D-146).
 *
 * Pure, like the assembler it describes. It answers the three questions the console asks of
 * eighty-two rules and gets no help with from the registry itself:
 *
 *   - WHICH RULES DOES THIS MODE ACTUALLY GET, IN WHAT ORDER. A rule's lane and condition
 *     decide whether it appears at all, and `ord` decides where. Reading the table sorted by
 *     id answers none of that.
 *   - WHAT WOULD THE PROMPT BE IF I SAVED THIS. A rule edit whose effect you cannot see
 *     before committing is a change made blind.
 *   - WHAT IS MISSING THAT SHOULD NOT BE. A disabled critical rule is allowed and must never
 *     be quiet.
 *
 * It holds no rule text and no database handle, so a check can drive all of it with a rule
 * set and nothing else.
 */

import {
  conditionHolds,
  lanesForMode,
  type PromptRule,
  type PromptRuleCondition,
  type PromptRuleContext,
  type PromptRuleSet,
} from './prompt-rules.js';
import type { AiReplyMode } from './ollama-reply.js';

/** The modes an operator can ask to see, in the order the console lists them. */
export const BOOK_MODES: readonly AiReplyMode[] = [
  'conversation',
  'retort',
  'searching',
  'free',
  'locked',
];

/**
 * A rule as the book shows it: the record, plus what the console worked out about it.
 */
export interface BookEntry {
  rule: PromptRule;
  /** Its position in the mode being viewed, 1-based. Absent when viewing every lane. */
  position?: number;
  /** True when the mode being viewed would NOT emit it, because its condition is false. */
  conditional: boolean;
  /** What it said before anybody edited it, when it has been edited. */
  shippedText?: string;
}

/** One heading in the book. */
export interface BookSection {
  key: string;
  title: string;
  /** Why these rules are grouped together, in one sentence, for the page. */
  note: string;
  entries: BookEntry[];
}

/**
 * A context in which EVERY condition holds.
 *
 * Deliberately not a realistic bot. The book is a reference: an operator looking for the rule
 * that governs her origin must find it whether or not this deployment has an origin
 * configured, and a rule invisible because the current bot has no nickname list is a rule
 * nobody can edit. Conditions are shown as labels instead, so what makes a rule apply stays
 * on the page without deciding what the page contains.
 *
 * The PREVIEW is the opposite and uses the real context, because there the question is what
 * she is actually told.
 */
const EVERYTHING_IN_SCOPE: PromptRuleContext = {
  hasPersonality: true,
  hasCharacter: true,
  hasOrigin: true,
  hasName: true,
  hasLabel: true,
  hasArchiveUrl: true,
  hasProjectUrl: true,
  hasModel: true,
  hasNicknames: true,
  hasClock: true,
  hasWebResults: true,
  hasHistory: true,
};

/**
 * Conditions that are mutually exclusive with the ones above, so a "show everything" view
 * still lists both halves of a two-variant rule.
 *
 * D-134 and D-138 each produced a pair: the person-name guard reads differently with and
 * without a name, and the do-not-invent fence reads differently with and without an origin.
 * Exactly one of each pair is ever emitted, and the book has to show both or an operator
 * editing the one they can see would leave its twin saying the old thing.
 */
const NEGATIVE_CONDITIONS: ReadonlySet<PromptRuleCondition> = new Set([
  'has-no-personality',
  'has-personality-no-character',
  'has-no-origin',
  'has-no-name',
  'has-given-facts-without-origin',
]);

function selectable(rule: PromptRule): boolean {
  return (
    conditionHolds(rule.appliesWhen, EVERYTHING_IN_SCOPE) ||
    NEGATIVE_CONDITIONS.has(rule.appliesWhen)
  );
}

const LANE_NOTES: Record<string, string> = {
  all: 'Every prompt, in every mode.',
  dialled: 'The modes that carry her voice: conversation, retort and the search holding line.',
  command: 'The modes that rephrase a decision the application already made: free and locked.',
  conversation: 'Free conversation only, where she writes original words.',
  retort: 'A nickname retort only.',
  searching: 'The holding line before a search only.',
  free: 'A command rewrite only.',
  locked: 'A command lead only, with protected text appended after it.',
  'dial-axis':
    'Not part of the stream. Three template rows rendered once per axis to build the dial block.',
};

/** The order the lanes are worth reading in, which is roughly the order they are emitted. */
const LANE_ORDER = [
  'all',
  'dialled',
  'command',
  'conversation',
  'retort',
  'searching',
  'free',
  'locked',
  'dial-axis',
] as const;

/** Case-insensitive match across everything an operator might search by. */
export function matchesQuery(rule: PromptRule, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    rule.id.toLowerCase().includes(q) ||
    rule.text.toLowerCase().includes(q) ||
    rule.lane.toLowerCase().includes(q) ||
    rule.tier.toLowerCase().includes(q) ||
    rule.appliesWhen.toLowerCase().includes(q) ||
    rule.source.toLowerCase().includes(q)
  );
}

/**
 * The book, grouped by lane, for browsing and editing.
 *
 * Every rule appears exactly once, which is what makes it editable: a view that repeated an
 * `all` rule under all five modes would offer five edit boxes for one sentence.
 */
export function bookByLane(
  rules: PromptRuleSet,
  shipped: ReadonlyMap<string, string>,
  query = '',
): BookSection[] {
  const sections: BookSection[] = [];

  for (const lane of LANE_ORDER) {
    const entries = rules
      .filter((rule) => rule.lane === lane && matchesQuery(rule, query))
      .sort((a, b) => a.ord - b.ord || a.id.localeCompare(b.id))
      .map((rule) => ({
        rule,
        conditional: rule.appliesWhen !== 'always',
        ...(shipped.has(rule.id) ? { shippedText: shipped.get(rule.id)! } : {}),
      }));

    if (entries.length === 0) continue;
    sections.push({
      key: lane,
      title: lane,
      note: LANE_NOTES[lane] ?? '',
      entries,
    });
  }

  return sections;
}

/**
 * What one mode draws, in the order it is emitted.
 *
 * This is the view that answers "what is she told, and when". It uses the everything-holds
 * context rather than a live bot's, so a rule is listed with the note that its condition
 * gates it rather than being silently absent.
 */
export function bookByMode(
  rules: PromptRuleSet,
  mode: AiReplyMode,
  shipped: ReadonlyMap<string, string>,
  query = '',
): BookSection {
  const lanes = new Set(lanesForMode(mode));
  const selected = rules
    .filter((rule) => lanes.has(rule.lane) && selectable(rule))
    .sort((a, b) => a.ord - b.ord || a.id.localeCompare(b.id));

  const entries = selected
    .map((rule, index) => ({
      rule,
      position: index + 1,
      conditional: rule.appliesWhen !== 'always',
      ...(shipped.has(rule.id) ? { shippedText: shipped.get(rule.id)! } : {}),
    }))
    .filter((entry) => matchesQuery(entry.rule, query));

  return {
    key: mode,
    title: mode,
    note:
      `Everything a ${mode} prompt can draw, in emission order. The dial block and her ` +
      `origin are values rendered into these sentences, not rules; see the Assembled Word.`,
    entries,
  };
}

/**
 * The rule set as it WOULD be with one edit applied.
 *
 * The whole point of previewing before saving. It returns a new array and never touches the
 * input, so the caller can render the current prompt and the proposed one side by side from
 * the same source.
 */
export function withEdit(
  rules: PromptRuleSet,
  ruleId: string,
  edit: { text: string; enabled: boolean; ord: number },
): PromptRule[] {
  return rules.map((rule) =>
    rule.id === ruleId
      ? { ...rule, text: edit.text, enabled: edit.enabled, ord: Math.trunc(edit.ord) }
      : rule,
  );
}

/**
 * Critical rules that are switched off.
 *
 * The operator is ALLOWED to do this: it is his system and the ceiling is a rule like any
 * other. What he may not do is do it without knowing, so the page renders this loudly and
 * `verify:prompt-identity` goes red on the same condition. Nothing here prevents anything.
 */
export function disabledCriticalRules(rules: PromptRuleSet): PromptRule[] {
  return rules
    .filter((rule) => rule.critical && !rule.enabled)
    .sort((a, b) => a.ord - b.ord || a.id.localeCompare(b.id));
}

/** Rules whose text no longer matches what the migration seeded. */
export function driftedRules(
  rules: PromptRuleSet,
  shipped: ReadonlyMap<string, string>,
): PromptRule[] {
  return rules.filter((rule) => {
    const was = shipped.get(rule.id);
    return was !== undefined && was !== rule.text;
  });
}
