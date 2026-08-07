/**
 * The rule registry (CCB-S4-039, D-144): the laws she is given, as data.
 *
 * ── WHY THIS FILE IS PURE, AND WHY THE TEXT IS NOT IN IT ─────────────────────
 *
 * Every sentence the model is told used to be a string literal in `personality.ts` or
 * `ollama-reply.ts`. They now live in one table, seeded by `migrations/035_prompt_rules.sql`,
 * which is the ONLY authored copy. This file holds the model and the assembler and no rule
 * text at all: not a constant, not a default, not a fallback. A fallback would be a second
 * source, and a second source drifts, which is the failure the whole briefing exists to end.
 *
 * So it takes the records as an argument, exactly as `personality.ts` takes the dials. No
 * database, no transport, no configuration; the assembled prompt is a pure function of a
 * record set, a context and a bag of values, which is what lets `verify:prompt-identity`
 * assert on it against a baseline captured before the move.
 *
 * ── WHAT HAPPENS WHEN THE REGISTRY IS NOT THERE ──────────────────────────────
 *
 * {@link assemblePrompt} throws. It does not quietly emit a shorter prompt, because a
 * shorter prompt is one with the safety ceiling missing and no sign that anything is wrong.
 * The throw lands in the reply path's existing catch, is logged, is counted as an AI
 * fallback in the admin telemetry, and the member gets the deterministic reply somebody
 * wrote. A missing rulebook must degrade into "she does not word this one" rather than into
 * "she words it with no rules".
 */

import type { AiReplyMode } from './ollama-reply.js';

export const PROMPT_RULE_TIERS = ['constitutional', 'standard', 'bot'] as const;
export type PromptRuleTier = (typeof PROMPT_RULE_TIERS)[number];

/**
 * Where a rule applies.
 *
 * `dialled` and `command` are lane GROUPS rather than modes, and they are what the code
 * actually branches on: `conversation`, `retort` and `searching` carry her voice, `free` and
 * `locked` rephrase a decision the application already made. Naming the group is more
 * honest than repeating a rule in three single-mode lanes and hoping the three stay equal.
 *
 * `dial-axis` is not in the stream at all. Its rows are a template rendered once per axis to
 * produce the {@link DIAL_AXES_PLACEHOLDER} block; see {@link renderPromptRule}.
 */
export const PROMPT_RULE_LANES = [
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
export type PromptRuleLane = (typeof PROMPT_RULE_LANES)[number];

/**
 * The situations a rule can be conditional on.
 *
 * A FIXED VOCABULARY, and that is a product decision rather than a shortcut. Two rules
 * already exist in two variants today (the do-not-invent fence differs on whether she has an
 * origin, D-138; the person-name guard differs on whether she has a name, D-134), so
 * conditions were needed on day one. A free expression language would be a new source of
 * error the operator could type into a form, in the one place where a mistake silently
 * changes what the model is told. These are exactly the branches the code already has, and
 * adding one is a change here and a migration, together.
 */
export const PROMPT_RULE_CONDITIONS = [
  'always',
  'has-personality',
  'has-no-personality',
  'has-character',
  'has-personality-no-character',
  'has-origin',
  'has-no-origin',
  'has-name',
  'has-no-name',
  'has-label',
  'has-archive-url',
  'has-project-url',
  'has-model',
  'has-given-facts-with-origin',
  'has-given-facts-without-origin',
  'has-nicknames',
  'has-clock',
  'has-web-results',
  'has-history',
  'has-no-history',
  'has-nameable-rules',
  'has-withheld-rules',
] as const;
export type PromptRuleCondition = (typeof PROMPT_RULE_CONDITIONS)[number];

export interface PromptRule {
  /** Stable, and it outlives reordering and rewording. History and checks refer to this. */
  id: string;
  tier: PromptRuleTier;
  lane: PromptRuleLane;
  appliesWhen: PromptRuleCondition;
  /** Global position in the assembled prompt. See the migration for why global. */
  ord: number;
  text: string;
  enabled: boolean;
  /** Absence should be loud. Asserted by `verify:prompt-identity`. */
  critical: boolean;
  /**
   * Whether she may quote this rule to a member who asks (CCB-S4-045, D-148).
   *
   * A rule that EXPLAINS her behaviour to somebody affected by it, against one whose exact
   * wording is a LEVER. Never paraphrased either way: what she says is the rule verbatim or
   * nothing at all.
   */
  nameable: boolean;
  /** Reserved for later targeting (a group, a role). Nothing reads it today. */
  scope: string | null;
  /** Where this text came from in the code, so the move stays auditable. */
  source: string;
}

export type PromptRuleSet = readonly PromptRule[];

/**
 * The four sentences that sit above every dial (D-133).
 *
 * Named by ID rather than by text, which is the point of stable ids: this selects rules, it
 * does not restate them. The console's limit card and the checks that assert the ceiling
 * reaches the model both read the text through here, so neither can describe a boundary the
 * registry does not send.
 */
export const CEILING_RULE_IDS = [
  'ceiling.hard-limit',
  'ceiling.never-explicit',
  'ceiling.never-minors',
  'ceiling.dial-scales-below',
] as const;

/**
 * What is in scope when the rules are selected.
 *
 * Deliberately a set of FACTS rather than the objects they came from, so a condition is a
 * lookup rather than a re-derivation. Two of the derivations are load-bearing and are done
 * by the caller that owns them:
 *
 *   - In the command lanes nothing personal is in scope. The personality, the identity and
 *     the clock are rendered only in the dialled modes (D-133), so a command prompt is built
 *     with every one of these false, and the person-name guard therefore takes its generic
 *     variant exactly as it did before.
 *   - Without a name, no identity fact is in scope. `identityLines` returned nothing at all
 *     without one, so no name meant no label and no addresses either. That is expressed here
 *     rather than as five compound conditions.
 */
export interface PromptRuleContext {
  hasPersonality: boolean;
  hasCharacter: boolean;
  hasOrigin: boolean;
  hasName: boolean;
  hasLabel: boolean;
  hasArchiveUrl: boolean;
  hasProjectUrl: boolean;
  hasModel: boolean;
  hasNicknames: boolean;
  hasClock: boolean;
  hasWebResults: boolean;
  /** Whether any remembered conversation was supplied (CCB-S4-044). */
  hasHistory: boolean;
  /** Rules were supplied for her to quote (CCB-S4-045). */
  hasNameableRules: boolean;
  /** Some enabled rule is not nameable, so she must say so. */
  hasWithheldRules: boolean;
}

/** Nothing configured and nothing supplied. The command lanes' context, plus web results. */
export const NOTHING_IN_SCOPE: Readonly<PromptRuleContext> = Object.freeze({
  hasPersonality: false,
  hasCharacter: false,
  hasOrigin: false,
  hasName: false,
  hasLabel: false,
  hasArchiveUrl: false,
  hasProjectUrl: false,
  hasModel: false,
  hasNicknames: false,
  hasClock: false,
  hasWebResults: false,
  hasHistory: false,
  hasNameableRules: false,
  hasWithheldRules: false,
});

export function conditionHolds(
  condition: PromptRuleCondition,
  context: PromptRuleContext,
): boolean {
  const givenFacts = context.hasLabel || context.hasArchiveUrl || context.hasProjectUrl;

  switch (condition) {
    case 'always':
      return true;
    case 'has-personality':
      return context.hasPersonality;
    case 'has-no-personality':
      return !context.hasPersonality;
    case 'has-character':
      return context.hasPersonality && context.hasCharacter;
    case 'has-personality-no-character':
      return context.hasPersonality && !context.hasCharacter;
    case 'has-origin':
      return context.hasOrigin;
    case 'has-no-origin':
      return !context.hasOrigin;
    case 'has-name':
      return context.hasName;
    case 'has-no-name':
      return !context.hasName;
    case 'has-label':
      return context.hasLabel;
    case 'has-archive-url':
      return context.hasArchiveUrl;
    case 'has-project-url':
      return context.hasProjectUrl;
    case 'has-model':
      return context.hasModel;
    case 'has-given-facts-with-origin':
      return givenFacts && context.hasOrigin;
    case 'has-given-facts-without-origin':
      return givenFacts && !context.hasOrigin;
    case 'has-nicknames':
      return context.hasNicknames;
    case 'has-clock':
      return context.hasClock;
    case 'has-web-results':
      return context.hasWebResults;
    case 'has-history':
      return context.hasHistory;
    case 'has-no-history':
      return !context.hasHistory;
    case 'has-nameable-rules':
      return context.hasNameableRules;
    case 'has-withheld-rules':
      return context.hasNameableRules && context.hasWithheldRules;
  }
}

/**
 * The lanes a mode draws from, outermost first.
 *
 * The order here is documentation, not precedence: selection sorts by `ord` across all of
 * them, because the dialled voice is emitted BETWEEN two everywhere-rules and the lanes have
 * to interleave.
 */
export function lanesForMode(mode: AiReplyMode): PromptRuleLane[] {
  switch (mode) {
    case 'conversation':
      return ['all', 'dialled', 'conversation'];
    case 'retort':
      return ['all', 'dialled', 'retort'];
    case 'searching':
      return ['all', 'dialled', 'searching'];
    case 'free':
      return ['all', 'command', 'free'];
    case 'locked':
      return ['all', 'command', 'locked'];
  }
}

/**
 * The enabled rules of these lanes whose condition holds, in prompt order.
 *
 * Ties on `ord` break on `id` so the output is a function of the record set alone. Two rules
 * that can be selected together never share an `ord` in the seed, but a console that lets an
 * operator type a number will eventually produce a collision, and a prompt whose line order
 * depends on the order the database happened to return rows is not something a byte-identity
 * check could ever hold down.
 */
export function selectPromptRules(
  rules: PromptRuleSet,
  lanes: readonly PromptRuleLane[],
  context: PromptRuleContext,
): PromptRule[] {
  const wanted = new Set(lanes);
  return rules
    .filter(
      (rule) =>
        rule.enabled && wanted.has(rule.lane) && conditionHolds(rule.appliesWhen, context),
    )
    .sort((a, b) => a.ord - b.ord || a.id.localeCompare(b.id));
}

/**
 * The placeholder grammar.
 *
 * DOUBLE braces on purpose. The single-brace `{name}` grammar already means something else
 * in this product (the persona templates in the interaction settings), and the reply path
 * REJECTS model output containing one, treating it as a template layer that failed to fill.
 * Two grammars that look alike is how a token gets filled by the wrong layer.
 */
const PLACEHOLDER = /\{\{(\w+)\}\}/g;

/** The block the per-axis template renders into. Held here so both sides agree on it. */
export const DIAL_AXES_PLACEHOLDER = 'dialAxes';

export type PromptRuleValues = Readonly<Record<string, string>>;

/**
 * One rule, with its placeholders filled.
 *
 * An unfilled placeholder THROWS rather than rendering as an empty string or as a literal
 * `{{name}}`. Both of those reach the model: one silently deletes a fact she was supposed to
 * be given, the other hands her a token she may well echo into the chat. Neither is a
 * failure anybody would notice from the outside, which is exactly why it is loud here.
 */
export function renderPromptRule(rule: PromptRule, values: PromptRuleValues): string {
  return rule.text.replace(PLACEHOLDER, (_match, key: string) => {
    const value = values[key];
    if (value === undefined) {
      throw new Error(
        `Prompt rule ${rule.id} needs a value for {{${key}}} and none was supplied.`,
      );
    }
    return value;
  });
}

/**
 * The assembled prompt lines, one entry per selected rule.
 *
 * A rule whose value spans several lines (her origin, the dial block) is ONE entry
 * containing newlines. Every caller joins with a newline before doing anything else, so the
 * text is identical either way; keeping one entry per rule means an entry can still be
 * traced back to the record that produced it.
 */
export function assemblePrompt(
  rules: PromptRuleSet,
  lanes: readonly PromptRuleLane[],
  context: PromptRuleContext,
  values: PromptRuleValues,
): string[] {
  if (rules.length === 0) {
    throw new Error(
      'The prompt rule registry is empty. Nothing is sent to the model without its rules.',
    );
  }
  return selectPromptRules(rules, lanes, context).map((rule) => renderPromptRule(rule, values));
}

/** The ceiling sentences, in order. Throws if the registry has lost one. */
export function ceilingRuleTexts(rules: PromptRuleSet): string[] {
  return CEILING_RULE_IDS.map((id) => {
    const rule = rules.find((candidate) => candidate.id === id);
    if (!rule) {
      throw new Error(`The prompt rule registry is missing the safety ceiling rule ${id}.`);
    }
    return rule.text;
  });
}
