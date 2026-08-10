/**
 * `cinderella_plugin_overrides` - per-bot deviations from the shared plugin state
 * (CCB-S5-021, D-175, migration 051).
 *
 * The reading model is `src/plugins/scope.ts`; this is only the SQL. The refusal to store a
 * deployment-wide key lives in the database as a CHECK and is repeated here as a gate, for
 * the reason `db/interaction-overrides.ts` gives: an application that relies on a constraint
 * for its error message hands the operator a Postgres exception where a sentence was needed.
 */

import type { Queryable } from './pool.js';
import {
  isPerBotPluginSetting,
  sharedPluginReason,
  type PluginOverride,
} from '../plugins/scope.js';

interface Row {
  bot_profile_id: string;
  plugin_id: string;
  setting_key: string;
  value: unknown;
}

const toOverride = (r: Row): PluginOverride => ({
  botProfileId: Number(r.bot_profile_id),
  pluginId: r.plugin_id,
  key: r.setting_key,
  // PGlite and node-postgres both hand back JSONB already parsed. A boolean here is a JSON
  // boolean, which is what `enabled` stores, and must not be re-parsed.
  value: r.value,
});

/** Every deviation, for the console's scope view. */
export async function listAllPluginOverrides(db: Queryable): Promise<PluginOverride[]> {
  const { rows } = await db.query<Row>(
    `SELECT bot_profile_id, plugin_id, setting_key, value
       FROM cinderella_plugin_overrides
      ORDER BY plugin_id, setting_key, bot_profile_id`,
  );
  return rows.map(toOverride);
}

/** One bot's deviations, for assembling its effective plugin states. */
export async function listPluginOverridesForBot(
  db: Queryable,
  botProfileId: number,
): Promise<PluginOverride[]> {
  const { rows } = await db.query<Row>(
    `SELECT bot_profile_id, plugin_id, setting_key, value
       FROM cinderella_plugin_overrides
      WHERE bot_profile_id = $1
      ORDER BY plugin_id, setting_key`,
    [botProfileId],
  );
  return rows.map(toOverride);
}

export class DeploymentWidePluginSettingError extends Error {
  constructor(pluginId: string, key: string) {
    super(sharedPluginReason(pluginId, key));
    this.name = 'DeploymentWidePluginSettingError';
  }
}

/**
 * Set one bot's value for one plugin setting.
 *
 * Gated before the write so the operator gets the inventory's own reason rather than a
 * constraint violation. The CHECK still stands behind it: this is the sentence, that is the
 * guarantee.
 */
export async function setPluginOverride(
  db: Queryable,
  botProfileId: number,
  pluginId: string,
  key: string,
  value: unknown,
): Promise<void> {
  if (!isPerBotPluginSetting(pluginId, key)) {
    throw new DeploymentWidePluginSettingError(pluginId, key);
  }
  await db.query(
    `INSERT INTO cinderella_plugin_overrides (bot_profile_id, plugin_id, setting_key, value)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (bot_profile_id, plugin_id, setting_key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [botProfileId, pluginId, key, JSON.stringify(value)],
  );
}

/** Put one bot back on the shared value. */
export async function clearPluginOverride(
  db: Queryable,
  botProfileId: number,
  pluginId: string,
  key: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `DELETE FROM cinderella_plugin_overrides
      WHERE bot_profile_id = $1 AND plugin_id = $2 AND setting_key = $3`,
    [botProfileId, pluginId, key],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * The per-bot keys the DATABASE will accept, read out of the CHECK constraint.
 *
 * Used by `verify:plugin-scope` to prove the SQL list and `PLUGIN_SETTING_SCOPES` agree. The
 * duplication between them is deliberate (the console needs one, the database needs the
 * other); what is not acceptable is the two drifting, and the only way to catch that is to
 * ask the database what it actually enforces rather than trusting the migration text.
 */
export async function perBotPluginKeysAcceptedByDatabase(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ def: string }>(
    `SELECT pg_get_constraintdef(oid) AS def
       FROM pg_constraint
      WHERE conname = 'cinderella_plugin_overrides_key_check'`,
  );
  const def = rows[0]?.def ?? '';
  return [...def.matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '').filter((s) => s.length > 0);
}
