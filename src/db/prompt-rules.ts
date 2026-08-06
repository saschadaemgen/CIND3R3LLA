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

/* ── The Book of Elii's write path (CCB-S4-043, D-146) ────────────────────── */

/** What an operator may change. Tier, lane and condition are deliberately absent. */
export interface PromptRuleEdit {
  text: string;
  enabled: boolean;
  ord: number;
}

export type PromptRuleAction = 'edit' | 'enable' | 'disable' | 'reorder' | 'rollback';

export interface PromptRuleChange {
  id: number;
  ruleId: string;
  changedAt: string;
  actor: string;
  action: PromptRuleAction;
  oldText: string;
  newText: string;
  oldEnabled: boolean;
  newEnabled: boolean;
  oldOrd: number;
  newOrd: number;
}

interface ChangeRow {
  id: string | number;
  rule_id: string;
  changed_at: string;
  actor: string;
  action: string;
  old_text: string;
  new_text: string;
  old_enabled: boolean;
  new_enabled: boolean;
  old_ord: number;
  new_ord: number;
}

function toChange(row: ChangeRow): PromptRuleChange {
  return {
    id: Number(row.id),
    ruleId: row.rule_id,
    changedAt: new Date(row.changed_at).toISOString(),
    actor: row.actor,
    action: row.action as PromptRuleAction,
    oldText: row.old_text,
    newText: row.new_text,
    oldEnabled: row.old_enabled,
    newEnabled: row.new_enabled,
    oldOrd: Number(row.old_ord),
    newOrd: Number(row.new_ord),
  };
}

/**
 * Which kind of change this was, from what actually moved.
 *
 * Derived rather than passed in, so the history cannot disagree with the row it describes.
 * A save that changes text AND toggles enabled is an `edit`: the text is the consequential
 * half and labelling it by the checkbox would bury it.
 */
function classify(before: PromptRuleEdit, after: PromptRuleEdit): PromptRuleAction {
  if (before.text !== after.text) return 'edit';
  if (before.enabled !== after.enabled) return after.enabled ? 'enable' : 'disable';
  return 'reorder';
}

/**
 * Apply one edit and record it, or do nothing at all.
 *
 * ── WHY IT IS ONE TRANSACTION AND WHY THAT MATTERS ───────────────────────────
 *
 * The rule and its history row are written together or not at all. A rule that changed with
 * no history row is a change nobody can find later, which is the failure this whole table
 * exists to prevent; a history row for a change that did not happen is worse, because it
 * sends somebody looking for a regression that is not there.
 *
 * Returns null when nothing moved. A no-op save writes no row: the history is what an
 * operator reads to find which edit degraded her, and padding it with saves that changed
 * nothing is how it stops being readable.
 */
export async function updatePromptRule(
  db: Queryable,
  ruleId: string,
  next: PromptRuleEdit,
  actor: string,
  action?: PromptRuleAction,
): Promise<PromptRuleChange | null> {
  const { rows } = await db.query<{ rule_text: string; enabled: boolean; ord: number }>(
    'SELECT rule_text, enabled, ord FROM cinderella_prompt_rules WHERE id = $1',
    [ruleId],
  );
  const current = rows[0];
  if (!current) throw new Error(`No prompt rule with id "${ruleId}".`);

  const before: PromptRuleEdit = {
    text: current.rule_text,
    enabled: current.enabled,
    ord: Number(current.ord),
  };
  const after: PromptRuleEdit = {
    text: next.text,
    enabled: next.enabled,
    ord: Math.trunc(next.ord),
  };

  if (
    before.text === after.text &&
    before.enabled === after.enabled &&
    before.ord === after.ord
  ) {
    return null;
  }

  // BEGIN/COMMIT on the handle we were given rather than `withTransaction`, which reaches
  // for the global pool: this function is driven by PGlite in the harness and by the real
  // pool in production, and both speak plain SQL. A rule that moved without its history row
  // is the failure this table exists to prevent, so the two writes are one unit.
  await db.query('BEGIN');
  try {
    await db.query(
      `UPDATE cinderella_prompt_rules
          SET rule_text = $2, enabled = $3, ord = $4, updated_at = now()
        WHERE id = $1`,
      [ruleId, after.text, after.enabled, after.ord],
    );

    const { rows: written } = await db.query<ChangeRow>(
      `INSERT INTO cinderella_prompt_rule_history
         (rule_id, actor, action, old_text, new_text, old_enabled, new_enabled, old_ord, new_ord)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, rule_id, changed_at, actor, action,
                 old_text, new_text, old_enabled, new_enabled, old_ord, new_ord`,
      [
        ruleId,
        actor,
        action ?? classify(before, after),
        before.text,
        after.text,
        before.enabled,
        after.enabled,
        before.ord,
        after.ord,
      ],
    );

    const row = written[0];
    if (!row) {
      throw new Error(`Prompt rule ${ruleId} changed but its history row was not written.`);
    }
    await db.query('COMMIT');
    return toChange(row);
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

/** One rule's changes, newest first. */
export async function listPromptRuleHistory(
  db: Queryable,
  ruleId: string,
  limit = 50,
): Promise<PromptRuleChange[]> {
  const { rows } = await db.query<ChangeRow>(
    `SELECT id, rule_id, changed_at, actor, action,
            old_text, new_text, old_enabled, new_enabled, old_ord, new_ord
       FROM cinderella_prompt_rule_history
      WHERE rule_id = $1
      ORDER BY changed_at DESC, id DESC
      LIMIT $2`,
    [ruleId, limit],
  );
  return rows.map(toChange);
}

/** The whole book's changes, newest first. */
export async function listRecentPromptRuleChanges(
  db: Queryable,
  limit = 100,
): Promise<PromptRuleChange[]> {
  const { rows } = await db.query<ChangeRow>(
    `SELECT id, rule_id, changed_at, actor, action,
            old_text, new_text, old_enabled, new_enabled, old_ord, new_ord
       FROM cinderella_prompt_rule_history
      ORDER BY changed_at DESC, id DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map(toChange);
}

/**
 * What each edited rule looked like before anybody touched it.
 *
 * The OLDEST history row per rule carries it, which is why no `shipped_text` column exists:
 * D-144 settled that the migration is the only authored copy of a rule, and a second column
 * holding the same sentence would have made that quietly untrue.
 *
 * A rule absent from this map has never been edited. That is the whole drift check.
 */
export async function shippedPromptRuleText(db: Queryable): Promise<Map<string, string>> {
  const { rows } = await db.query<{ rule_id: string; old_text: string }>(
    `SELECT DISTINCT ON (rule_id) rule_id, old_text
       FROM cinderella_prompt_rule_history
      ORDER BY rule_id, changed_at ASC, id ASC`,
  );
  return new Map(rows.map((row) => [row.rule_id, row.old_text]));
}

/**
 * Put a rule back to the state a history row recorded as its BEFORE.
 *
 * Recorded as a `rollback` rather than as an ordinary edit, so undoing something is exactly
 * as visible in the history as doing it was. It is not a delete: the change being undone
 * stays in the record, because a history an operator can prune is not an audit trail.
 */
export async function rollbackPromptRule(
  db: Queryable,
  changeId: number,
  actor: string,
): Promise<PromptRuleChange | null> {
  const { rows } = await db.query<ChangeRow>(
    `SELECT id, rule_id, changed_at, actor, action,
            old_text, new_text, old_enabled, new_enabled, old_ord, new_ord
       FROM cinderella_prompt_rule_history
      WHERE id = $1`,
    [changeId],
  );
  const target = rows[0];
  if (!target) throw new Error(`No prompt rule change with id ${String(changeId)}.`);

  return updatePromptRule(
    db,
    target.rule_id,
    {
      text: target.old_text,
      enabled: target.old_enabled,
      ord: Number(target.old_ord),
    },
    actor,
    'rollback',
  );
}
