/**
 * `cinderella_interaction_overrides` - per-bot deviations from the shared interaction
 * settings (CCB-S5-006, D-158, migration 047).
 *
 * The reading model is `src/interaction/setting-scope.ts`; this is only the SQL. The
 * refusal to store a shared key lives in the database as a CHECK and is repeated here as a
 * gate, because an application that relies on a constraint for its error message hands the
 * operator a Postgres exception where a sentence was needed.
 */

import type { Queryable } from './pool.js';
import { isPerBot, sharedReason, type SettingOverride } from '../interaction/setting-scope.js';

interface Row {
  bot_profile_id: string;
  setting_key: string;
  value: unknown;
}

const toOverride = (r: Row): SettingOverride => ({
  botProfileId: Number(r.bot_profile_id),
  key: r.setting_key,
  // PGlite and node-postgres both hand back JSONB already parsed. A string here would be a
  // JSON string value, which is correct for `wakeWord` and must not be re-parsed.
  value: r.value,
});

/** Every deviation, for the console's scope view. */
export async function listAllSettingOverrides(db: Queryable): Promise<SettingOverride[]> {
  const { rows } = await db.query<Row>(
    `SELECT bot_profile_id, setting_key, value
       FROM cinderella_interaction_overrides
      ORDER BY setting_key, bot_profile_id`,
  );
  return rows.map(toOverride);
}

/** One bot's deviations, for assembling its effective settings. */
export async function listSettingOverridesForBot(
  db: Queryable,
  botProfileId: number,
): Promise<SettingOverride[]> {
  const { rows } = await db.query<Row>(
    `SELECT bot_profile_id, setting_key, value
       FROM cinderella_interaction_overrides
      WHERE bot_profile_id = $1
      ORDER BY setting_key`,
    [botProfileId],
  );
  return rows.map(toOverride);
}

export class SharedSettingError extends Error {
  constructor(key: string) {
    super(sharedReason(key));
    this.name = 'SharedSettingError';
  }
}

/**
 * Set one bot's value for one setting.
 *
 * Gated before the write so the operator gets the inventory's own reason rather than a
 * constraint violation. The CHECK still stands behind it: this is the sentence, that is the
 * guarantee.
 */
export async function setSettingOverride(
  db: Queryable,
  botProfileId: number,
  key: string,
  value: unknown,
): Promise<void> {
  if (!isPerBot(key)) throw new SharedSettingError(key);
  await db.query(
    `INSERT INTO cinderella_interaction_overrides (bot_profile_id, setting_key, value)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (bot_profile_id, setting_key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [botProfileId, key, JSON.stringify(value)],
  );
}

/** Put one bot back on the shared value. */
export async function clearSettingOverride(
  db: Queryable,
  botProfileId: number,
  key: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `DELETE FROM cinderella_interaction_overrides
      WHERE bot_profile_id = $1 AND setting_key = $2`,
    [botProfileId, key],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * The per-bot keys the DATABASE will accept, read out of the CHECK constraint.
 *
 * Used by `verify:interaction-scope` to prove the SQL list and `SETTING_SCOPES` agree. The
 * duplication between them is deliberate (the console needs one, the database needs the
 * other); what is not acceptable is the two drifting, and the only way to catch that is to
 * ask the database what it actually enforces rather than trusting the migration text.
 */
export async function perBotKeysAcceptedByDatabase(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ def: string }>(
    `SELECT pg_get_constraintdef(oid) AS def
       FROM pg_constraint
      WHERE conname = 'cinderella_interaction_overrides_key_check'`,
  );
  const def = rows[0]?.def ?? '';
  return [...def.matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '').filter((s) => s.length > 0);
}
