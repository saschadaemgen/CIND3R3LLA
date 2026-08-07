/**
 * Which rule a deterministic gate decided under (CCB-S4-050, D-152).
 *
 * ── WHY A MAP AND NOT A GUESS ────────────────────────────────────────────────
 *
 * The gates are CODE, not registry rules: `lookup-gate.ts` screens a query by category and
 * `disclosure.ts` answers a probe before the model sees it. Neither reads a rule to make its
 * decision, so neither can report one without being told which law it is enforcing.
 *
 * This file is that telling, and it is deliberately a fixed table rather than a search. The
 * alternative is looking for a rule whose text resembles the category, which is the
 * attribution-by-guesswork this whole record refuses to do. Every entry here is a statement
 * somebody wrote down: the pre-search gate exists as a floor under the ceiling, and the
 * elimination gate exists because `disclosure.never-narrow` could not hold on its own.
 *
 * An unmapped category records NOTHING rather than falling back to a plausible rule. That is
 * the same choice the model-side silence makes, for the same reason: a record that fills gaps
 * is a record an operator cannot trust the rest of.
 */

/**
 * The screening categories `lookup-gate.ts` can refuse under, and the constitutional rule each
 * one is a floor beneath.
 *
 * These are the rules a member would be quoted if they asked why, so they are the honest
 * answer to "which law stopped this". `illegal-goods` and `darknet` map to the hard limit
 * rather than to a rule of their own, because there is no rule of their own: the gate is
 * enforcing the general ceiling in a place the model cannot be trusted to hold alone.
 */
export const PRE_SEARCH_RULE_FOR_CATEGORY: Readonly<Record<string, string>> = Object.freeze({
  'child-safety': 'ceiling.never-minors',
  'sexual-explicit': 'ceiling.never-explicit',
  'illegal-goods': 'ceiling.hard-limit',
  darknet: 'ceiling.hard-limit',
});

/**
 * The rule the elimination and machinery gates enforce.
 *
 * `disclosure.never-narrow` says not to confirm or deny whether a withheld rule covers a
 * particular thing. CCB-S4-046 measured that sentence failing on its own, twice, which is why
 * the gate exists in code at all; when the gate fires, that rule is what it is holding.
 */
export const DISCLOSURE_GATE_RULE = 'disclosure.never-narrow';

/** The rule a pre-search refusal decided under, or null when nothing maps. */
export function preSearchRuleFor(category: string | null | undefined): string | null {
  if (!category) return null;
  return PRE_SEARCH_RULE_FOR_CATEGORY[category] ?? null;
}
