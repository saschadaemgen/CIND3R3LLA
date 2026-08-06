/**
 * `cinderella_prompt_rules` — the rule registry (CCB-S4-039, D-144).
 *
 * Read-only today, deliberately. The console that edits these is the next briefing, and the
 * move had to be proven inert before anything was allowed to change it.
 */

import type { Queryable } from './pool.js';
import {
  PROMPT_RULE_CONDITIONS,
  PROMPT_RULE_LANES,
  PROMPT_RULE_TIERS,
  type PromptRule,
  type PromptRuleCondition,
  type PromptRuleLane,
  type PromptRuleTier,
} from '../interaction/prompt-rules.js';

interface Row {
  id: string;
  tier: string;
  lane: string;
  applies_when: string;
  ord: number;
  rule_text: string;
  enabled: boolean;
  critical: boolean;
  scope: string | null;
  source: string;
}

/**
 * A column value the code does not understand is a fault, not a value to skip.
 *
 * The table has CHECK constraints on all three of these, so reaching this is either a
 * migration that added a value the code has not learned yet or a write that went round the
 * constraint. Both mean the assembled prompt would silently lose a rule, so it fails here
 * where the operation and the offending value can be named (CCB-S3-023).
 */
function oneOf<T extends string>(
  allowed: readonly T[],
  value: string,
  column: string,
  id: string,
): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(
    `Prompt rule ${id} has an unknown ${column} "${value}". Known values: ${allowed.join(', ')}.`,
  );
}

/**
 * Every rule, ordered.
 *
 * The whole table in one read. It is a few dozen rows that change when an operator edits
 * them, which is to say almost never, and the assembler needs all lanes anyway: a single
 * prompt draws from three of them plus the per-axis template.
 */
export async function listPromptRules(db: Queryable): Promise<PromptRule[]> {
  const { rows } = await db.query<Row>(
    `SELECT id, tier, lane, applies_when, ord, rule_text, enabled, critical, scope, source
       FROM cinderella_prompt_rules
      ORDER BY ord, id`,
  );

  return rows.map((row) => ({
    id: row.id,
    tier: oneOf<PromptRuleTier>(PROMPT_RULE_TIERS, row.tier, 'tier', row.id),
    lane: oneOf<PromptRuleLane>(PROMPT_RULE_LANES, row.lane, 'lane', row.id),
    appliesWhen: oneOf<PromptRuleCondition>(
      PROMPT_RULE_CONDITIONS,
      row.applies_when,
      'condition',
      row.id,
    ),
    ord: Number(row.ord),
    text: row.rule_text,
    enabled: row.enabled,
    critical: row.critical,
    scope: row.scope,
    source: row.source,
  }));
}
