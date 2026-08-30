/**
 * `cinderella_prompt_rule_overrides` — per-bot deviations from a standard law
 * (CCB-S5-001, D-155, migration 045).
 *
 * The reading model is `src/interaction/rule-scope.ts`; this is only the SQL. The
 * constitutional refusal lives in the database as a trigger and is repeated here as a
 * gate, because an application that relies on a constraint for its error message gives
 * the operator a Postgres exception where a sentence was needed.
 */

import type { Queryable } from './pool.js';
import type { RuleOverride } from '../interaction/rule-scope.js';
import type { OverrideRuleChange } from './prompt-rules.js';

interface Row {
  bot_profile_id: string;
  rule_id: string;
  enabled: boolean | null;
  rule_text: string | null;
}

const toOverride = (r: Row): RuleOverride => ({
  botProfileId: Number(r.bot_profile_id),
  ruleId: r.rule_id,
  enabled: r.enabled,
  text: r.rule_text,
});

/** Every deviation, for the console's scope view. */
export async function listAllOverrides(db: Queryable): Promise<RuleOverride[]> {
  const { rows } = await db.query<Row>(
    `SELECT bot_profile_id, rule_id, enabled, rule_text
       FROM cinderella_prompt_rule_overrides
      ORDER BY rule_id, bot_profile_id`,
  );
  return rows.map(toOverride);
}

/** One bot's deviations, for assembling its rulebook. */
export async function listOverridesForBot(
  db: Queryable,
  botProfileId: number,
): Promise<RuleOverride[]> {
  const { rows } = await db.query<Row>(
    `SELECT bot_profile_id, rule_id, enabled, rule_text
       FROM cinderella_prompt_rule_overrides
      WHERE bot_profile_id = $1
      ORDER BY rule_id`,
    [botProfileId],
  );
  return rows.map(toOverride);
}

/** The deviations on one law, across every bot. */
export async function listOverridesForRule(
  db: Queryable,
  ruleId: string,
): Promise<RuleOverride[]> {
  const { rows } = await db.query<Row>(
    `SELECT bot_profile_id, rule_id, enabled, rule_text
       FROM cinderella_prompt_rule_overrides
      WHERE rule_id = $1
      ORDER BY bot_profile_id`,
    [ruleId],
  );
  return rows.map(toOverride);
}

export class ConstitutionalOverrideError extends Error {
  constructor(ruleId: string, reason: string) {
    super(`${ruleId} cannot be set per bot. ${reason}`);
    this.name = 'ConstitutionalOverrideError';
  }
}

/**
 * Set or replace one bot's deviation from one law.
 *
 * Both fields NULL is refused by a CHECK rather than treated as "remove": removing is
 * {@link clearOverride}, and letting an empty write mean deletion would make a form that
 * failed to submit its fields look like a deliberate revert.
 */
export async function setOverride(
  db: Queryable,
  input: { botProfileId: number; ruleId: string; enabled: boolean | null; text: string | null },
): Promise<void> {
  await db.query(
    `INSERT INTO cinderella_prompt_rule_overrides (bot_profile_id, rule_id, enabled, rule_text)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (bot_profile_id, rule_id)
     DO UPDATE SET enabled = EXCLUDED.enabled,
                   rule_text = EXCLUDED.rule_text,
                   updated_at = now()`,
    [input.botProfileId, input.ruleId, input.enabled, input.text],
  );
}

/** Put one bot back on the shared law. */
export async function clearOverride(
  db: Queryable,
  botProfileId: number,
  ruleId: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `DELETE FROM cinderella_prompt_rule_overrides
      WHERE bot_profile_id = $1 AND rule_id = $2`,
    [botProfileId, ruleId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Set a per-bot deviation AND record it, as one unit.
 *
 * The same discipline `updatePromptRule` states for the shared law: a law that moved
 * without its history row is the failure the history table exists to prevent, and a per-bot
 * law is no less a law. `bot_profile_id` on the history row is what tells a reader whether
 * a change was to the shared sentence or to one bot's version of it, which matters most at
 * the moment somebody rolls one back.
 *
 * The `enabled` and `ord` columns on the history carry the EFFECTIVE values, so a reader
 * sees what that bot went from and to rather than a pair of nulls.
 */
export async function setOverrideRecorded(
  db: Queryable,
  input: {
    botProfileId: number;
    ruleId: string;
    enabled: boolean | null;
    text: string | null;
    /** The shared law, so the history can record what this bot was reading before. */
    sharedText: string;
    sharedEnabled: boolean;
    sharedOrd: number;
    sharedNameable: boolean;
  },
  actor: string,
): Promise<void> {
  const existing = (await listOverridesForBot(db, input.botProfileId)).find(
    (o) => o.ruleId === input.ruleId,
  );
  const beforeText = existing?.text ?? input.sharedText;
  const beforeEnabled = existing?.enabled ?? input.sharedEnabled;
  const afterText = input.text ?? input.sharedText;
  const afterEnabled = input.enabled ?? input.sharedEnabled;

  if (beforeText === afterText && beforeEnabled === afterEnabled) return;

  await db.query('BEGIN');
  try {
    await setOverride(db, input);
    await db.query(
      `INSERT INTO cinderella_prompt_rule_history
         (rule_id, bot_profile_id, actor, action, old_text, new_text, old_enabled, new_enabled,
          old_ord, new_ord, old_nameable, new_nameable)
       VALUES ($1, $2, $3, 'override', $4, $5, $6, $7, $8, $8, $9, $9)`,
      [
        input.ruleId,
        input.botProfileId,
        actor,
        beforeText,
        afterText,
        beforeEnabled,
        afterEnabled,
        input.sharedOrd,
        input.sharedNameable,
      ],
    );
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
}

/** Put one bot back on the shared law, and record that too. */
export async function clearOverrideRecorded(
  db: Queryable,
  input: {
    botProfileId: number;
    ruleId: string;
    sharedText: string;
    sharedEnabled: boolean;
    sharedOrd: number;
    sharedNameable: boolean;
  },
  actor: string,
): Promise<boolean> {
  const existing = (await listOverridesForBot(db, input.botProfileId)).find(
    (o) => o.ruleId === input.ruleId,
  );
  if (!existing) return false;

  await db.query('BEGIN');
  try {
    await clearOverride(db, input.botProfileId, input.ruleId);
    await db.query(
      `INSERT INTO cinderella_prompt_rule_history
         (rule_id, bot_profile_id, actor, action, old_text, new_text, old_enabled, new_enabled,
          old_ord, new_ord, old_nameable, new_nameable)
       VALUES ($1, $2, $3, 'revert', $4, $5, $6, $7, $8, $8, $9, $9)`,
      [
        input.ruleId,
        input.botProfileId,
        actor,
        existing.text ?? input.sharedText,
        input.sharedText,
        existing.enabled ?? input.sharedEnabled,
        input.sharedEnabled,
        input.sharedOrd,
        input.sharedNameable,
      ],
    );
    await db.query('COMMIT');
    return true;
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
}

/**
 * Roll ONE bot's recorded change back, touching nothing shared (CCB-S5-062, D-260).
 *
 * This is the writer the type system reserves for per-bot history rows. Its contract is
 * the one the history page shows the operator: after the rollback, this bot reads the
 * row's "Was" side again. The shared law is read here and never written.
 *
 * ── EFFECTIVE VALUES IN, CANONICAL FORM OUT ──────────────────────────────────
 *
 * The history records what the bot was READING (setOverrideRecorded fills inherited
 * fields with the shared values of their day), so what is restored is the effective
 * state. It is then re-canonicalised against TODAY's shared law, per field: a restored
 * value identical to the shared one is stored as NULL, meaning inherit, because 045's
 * design is that a bot reading the shared sentence keeps tracking it, and pinning a copy
 * of it here would freeze that bot out of every later shared edit in silence. Both
 * fields inherited is no row at all, which the schema itself insists on.
 *
 * Recorded as a `rollback` WITH the bot id, so undoing a per-bot change is exactly as
 * visible, and exactly as attributable, as making it was. The 076 scope constraint holds
 * the action to the column.
 */
export async function rollbackOverrideChange(
  db: Queryable,
  target: OverrideRuleChange,
  actor: string,
): Promise<OverrideRuleChange | null> {
  const { rows: ruleRows } = await db.query<{
    rule_text: string;
    enabled: boolean;
    ord: number;
    nameable: boolean;
  }>('SELECT rule_text, enabled, ord, nameable FROM cinderella_prompt_rules WHERE id = $1', [
    target.ruleId,
  ]);
  const shared = ruleRows[0];
  if (!shared) throw new Error(`No prompt rule with id "${target.ruleId}".`);

  const existing = (await listOverridesForBot(db, target.botProfileId)).find(
    (o) => o.ruleId === target.ruleId,
  );
  const beforeText = existing?.text ?? shared.rule_text;
  const beforeEnabled = existing?.enabled ?? shared.enabled;
  const afterText = target.oldText;
  const afterEnabled = target.oldEnabled;

  if (beforeText === afterText && beforeEnabled === afterEnabled) return null;

  const storedText = afterText === shared.rule_text ? null : afterText;
  const storedEnabled = afterEnabled === shared.enabled ? null : afterEnabled;

  await db.query('BEGIN');
  try {
    if (storedText === null && storedEnabled === null) {
      await clearOverride(db, target.botProfileId, target.ruleId);
    } else {
      await setOverride(db, {
        botProfileId: target.botProfileId,
        ruleId: target.ruleId,
        enabled: storedEnabled,
        text: storedText,
      });
    }
    const { rows: written } = await db.query<{ id: string | number; changed_at: string }>(
      `INSERT INTO cinderella_prompt_rule_history
         (rule_id, bot_profile_id, actor, action, old_text, new_text, old_enabled, new_enabled,
          old_ord, new_ord, old_nameable, new_nameable)
       VALUES ($1, $2, $3, 'rollback', $4, $5, $6, $7, $8, $8, $9, $9)
       RETURNING id, changed_at`,
      [
        target.ruleId,
        target.botProfileId,
        actor,
        beforeText,
        afterText,
        beforeEnabled,
        afterEnabled,
        Number(shared.ord),
        shared.nameable,
      ],
    );
    const row = written[0];
    if (!row) {
      throw new Error(
        `Bot ${String(target.botProfileId)}'s ${target.ruleId} was rolled back but its ` +
          `history row was not written.`,
      );
    }
    await db.query('COMMIT');
    return {
      scope: 'override',
      botProfileId: target.botProfileId,
      id: Number(row.id),
      ruleId: target.ruleId,
      changedAt: new Date(row.changed_at).toISOString(),
      actor,
      action: 'rollback',
      oldText: beforeText,
      newText: afterText,
      oldEnabled: beforeEnabled,
      newEnabled: afterEnabled,
      oldOrd: Number(shared.ord),
      newOrd: Number(shared.ord),
      oldNameable: shared.nameable,
      newNameable: shared.nameable,
    };
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
}

/** How many bots deviate from each law, for the Book's list page. */
export async function countOverridesByRule(db: Queryable): Promise<Map<string, number>> {
  const { rows } = await db.query<{ rule_id: string; n: string }>(
    `SELECT rule_id, count(*)::text AS n
       FROM cinderella_prompt_rule_overrides
      GROUP BY rule_id`,
  );
  return new Map(rows.map((r) => [r.rule_id, Number(r.n)]));
}
