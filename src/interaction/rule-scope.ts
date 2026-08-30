/**
 * Which laws are shared and which are one bot's (CCB-S5-001, D-155).
 *
 * ── THE MODEL, IN ONE SENTENCE ───────────────────────────────────────────────
 *
 * There is ONE registry of laws, and a bot may deviate from a standard one. Not a
 * rulebook per bot: one rulebook, with per-bot deviations recorded against it.
 *
 * ── WHY THAT SHAPE AND NOT A RULEBOOK PER BOT ────────────────────────────────
 *
 * A rulebook per bot answers "what is bot B told" beautifully and answers "what does
 * this law say" not at all, because there would be N answers and no way to tell which of
 * them was the law and which was a variation. Every question the console has to answer -
 * is this shared, who differs, what will this edit touch, how many bots does it reach -
 * is a question about ONE law and its deviations. So that is the shape.
 *
 * It also means adding a bot changes nothing: a new bot inherits every law by having no
 * rows here, rather than by being handed a copy that then has to be kept in step. And it
 * is what keeps the shipped registry the shipped registry, so `verify:prompt-identity`
 * still pins one set of bytes rather than N.
 *
 * ── THIS FILE IS PURE ────────────────────────────────────────────────────────
 *
 * The SQL is in `src/db/prompt-rule-overrides.ts` and the caching in
 * `prompt-rule-service.ts`. What is here is the part with the judgement in it: what a
 * bot's rulebook IS given the shared laws and its deviations, and what the console has
 * to say about a law's scope. Both are things a check should drive with two arrays and
 * no database.
 */

import type { PromptRule, PromptRuleSet } from './prompt-rules.js';

/**
 * One bot's deviation from one law.
 *
 * NULL means INHERIT in both fields, which is what makes "off for this bot" and
 * "reworded for this bot" the same mechanism rather than two. A row that switches a law
 * off leaves `text` null and therefore keeps tracking later edits to the shared wording,
 * instead of freezing a copy of it at the moment somebody switched it off.
 */
export interface RuleOverride {
  botProfileId: number;
  ruleId: string;
  enabled: boolean | null;
  text: string | null;
}

/** What a law's scope is, as the console has to state it. */
export type RuleScopeKind =
  /** Every bot reads the same sentence. */
  | 'shared'
  /** At least one bot deviates. */
  | 'per-bot'
  /** Constitutional: shared, and it cannot become per-bot. */
  | 'constitutional';

export interface BotDeviation {
  botProfileId: number;
  /** Switched off for this bot. */
  off: boolean;
  /** Reworded for this bot. */
  reworded: boolean;
}

export interface RuleScope {
  ruleId: string;
  kind: RuleScopeKind;
  /** Bots that deviate, empty for a shared law. */
  deviations: BotDeviation[];
  /**
   * How many bots read the SHARED text of this law.
   *
   * What an "editing this changes every bot" warning has to count, and it is deliberately
   * not "all of them": a law three of five bots have reworded is shared for two, and
   * telling the operator it reaches five would be a false number on a warning whose whole
   * job is to be trusted.
   */
  sharedBotCount: number;
}

/**
 * Apply one bot's deviations to the shared laws.
 *
 * The result is that bot's rulebook: the same rules in the same order, with `enabled` and
 * `text` replaced where it deviates. Nothing else is overridable, and that is a contract
 * rather than an omission - the tier, the lane, the condition and the order are things
 * the assembler implements in code, so a per-bot value for any of them would be a per-bot
 * change to how the prompt is BUILT rather than to what it says.
 *
 * A CONSTITUTIONAL rule is returned untouched whatever the overrides say. The database
 * trigger refuses to store one, so reaching this with a constitutional override means
 * something got past the trigger; ignoring it here is the difference between a defence in
 * depth and a comment claiming one.
 *
 * A CRITICAL rule cannot be switched off here either (CCB-S5-062, D-260): `critical`
 * means the law must reach every prompt, the two alarms that watch for a missing one
 * (the Book's shout and `verify:prompt-identity`) both read the shared registry, so a
 * per-bot off-switch was a silent hole beside the loud shared one. The trigger refuses
 * to store an off-switch on a critical law; this ignores one that predates the trigger
 * or got past it. Its TEXT override still applies, because a reworded law still reaches
 * the prompt.
 */
export function applyOverrides(
  rules: PromptRuleSet,
  overrides: readonly RuleOverride[],
): PromptRule[] {
  const byRule = new Map(overrides.map((o) => [o.ruleId, o]));
  return rules.map((rule) => {
    const o = byRule.get(rule.id);
    if (o === undefined || rule.tier === 'constitutional') return rule;
    const wanted = o.enabled ?? rule.enabled;
    return {
      ...rule,
      enabled: rule.critical && wanted === false ? rule.enabled : wanted,
      text: o.text ?? rule.text,
    };
  });
}

/**
 * What the console says about every law's scope.
 *
 * `botCount` is how many bots exist, not how many deviate: the shared count is the
 * remainder, and an operator editing a shared law needs to know how many bots that
 * reaches.
 */
export function describeScopes(
  rules: PromptRuleSet,
  overrides: readonly RuleOverride[],
  botCount: number,
): Map<string, RuleScope> {
  const byRule = new Map<string, RuleOverride[]>();
  for (const o of overrides) {
    const list = byRule.get(o.ruleId);
    if (list) list.push(o);
    else byRule.set(o.ruleId, [o]);
  }

  const out = new Map<string, RuleScope>();
  for (const rule of rules) {
    // Constitutional first, and unconditionally: a constitutional law with an override
    // row must still READ as constitutional, or the console would offer to edit per bot
    // exactly the thing that cannot be per bot.
    if (rule.tier === 'constitutional') {
      out.set(rule.id, {
        ruleId: rule.id,
        kind: 'constitutional',
        deviations: [],
        sharedBotCount: botCount,
      });
      continue;
    }
    const list = byRule.get(rule.id) ?? [];
    // `off` states what applyOverrides will DO, not what the row asks for: an off-switch
    // on a critical law is ignored there (CCB-S5-062), and a page that reported it as
    // "switched off" would describe a state that does not exist. A row left doing nothing
    // at all is not a deviation and is not listed as one.
    const deviations = list
      .map((o) => ({
        botProfileId: o.botProfileId,
        off: o.enabled === false && !rule.critical,
        reworded: o.text !== null,
      }))
      .filter((d) => d.off || d.reworded);
    out.set(rule.id, {
      ruleId: rule.id,
      kind: deviations.length > 0 ? 'per-bot' : 'shared',
      deviations,
      sharedBotCount: Math.max(0, botCount - deviations.length),
    });
  }
  return out;
}

/** Whether a law may be given a per-bot value at all. */
export function canOverride(rule: PromptRule): boolean {
  return rule.tier !== 'constitutional';
}

/**
 * Whether a law may be switched OFF for one bot (CCB-S5-062, D-260).
 *
 * Keyed on `critical`, because `critical` is the flag that MEANS "must reach every
 * prompt": `verify:prompt-identity` asserts it and the Book shouts when a critical law is
 * off. Both of those read the shared registry, so a per-bot off-switch was invisible to
 * both, and a safety rule could leave one bot's prompt with nothing anywhere saying so.
 * Rewording per bot stays available on a critical standard law; a reworded law still
 * reaches the prompt.
 */
export function canDisablePerBot(rule: PromptRule): boolean {
  return canOverride(rule) && !rule.critical;
}

/**
 * Why not, in a sentence a console can print.
 *
 * The briefing is explicit that a constitutional law must SAY it cannot be set per bot,
 * and why, rather than offering a control that then refuses. So the reason is data here
 * rather than a string built at the point of refusal, and the same sentence is used by
 * the page that greys the control and by the gate that would have refused it.
 */
export const CONSTITUTIONAL_SCOPE_REASON =
  'Constitutional laws are shared by every bot and cannot be set for one. The ceiling and ' +
  'the child-safety line have to mean the same thing everywhere, because five bots with ' +
  'five different outermost limits means nobody can say what any of them will refuse, and ' +
  'tightening a limit later would reach only the bots nobody had touched.';

/**
 * The same sentence-as-data for the off-switch a critical law does not offer per bot
 * (CCB-S5-062). Used by the form that leaves the switch out and by the page copy, so the
 * control's absence explains itself instead of reading as an omission.
 */
export const CRITICAL_OFF_SCOPE_REASON =
  'This law is critical: it must reach every prompt. It can be reworded for one bot, but ' +
  'switching it off is a shared act, taken on the shared law where this page is loud ' +
  'about it. Off for one bot would be off where nothing shouts.';
