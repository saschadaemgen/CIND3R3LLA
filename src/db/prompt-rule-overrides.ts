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

/** How many bots deviate from each law, for the Book's list page. */
export async function countOverridesByRule(db: Queryable): Promise<Map<string, number>> {
  const { rows } = await db.query<{ rule_id: string; n: string }>(
    `SELECT rule_id, count(*)::text AS n
       FROM cinderella_prompt_rule_overrides
      GROUP BY rule_id`,
  );
  return new Map(rows.map((r) => [r.rule_id, Number(r.n)]));
}
