/**
 * Resolving one bot's welcome settings (CCB-S5-041, D-206).
 *
 * Read per arrival rather than cached. Joins are rare and a database read is cheap, while a
 * cache would mean the operator edits the greeting, watches the next member get the old words,
 * and has no way to tell whether he saved it - the console lying about state, which is the
 * failure this season has paid for four times (D-205).
 *
 * ── ABSENCE MEANS THE DEFAULT, AND THE DEFAULT IS SILENCE ───────────────────
 *
 * Every key here is per bot with no shared value worth inheriting: an unwritten greeting is
 * not a greeting, so `text` defaults to empty and `planGreeting` suppresses with `no-text`.
 * That is deliberate - a plugin that shipped with a stock greeting would put words nobody
 * wrote into somebody's group the moment the switch was flipped.
 */

import type { Queryable } from '../../db/pool.js';
import { listPluginOverridesForBot } from '../../db/plugin-overrides.js';
import { isPluginEnabled, type PluginStates } from '../registry.js';
import { applyPluginOverrides } from '../scope.js';
import { WELCOME_ID } from './plugin.js';
import type { Destination, Fallback, WelcomeSettings } from './greeting.js';

const DESTINATIONS: readonly Destination[] = ['group', 'support', 'direct'];
const FALLBACKS: readonly Fallback[] = ['group', 'none'];

export async function resolveWelcomeSettings(
  db: Queryable,
  shared: PluginStates,
  botProfileId: number,
): Promise<WelcomeSettings> {
  const overrides = await listPluginOverridesForBot(db, botProfileId);
  const value = (key: string): unknown =>
    overrides.find((o) => o.pluginId === WELCOME_ID && o.key === key)?.value;
  const text = (key: string): string => {
    const v = value(key);
    return typeof v === 'string' ? v : '';
  };
  // Validated against the vocabulary on the way OUT as well as on the way in. The console
  // already refuses an unknown value, but a row written by hand or by a future migration
  // would otherwise reach the runner as a destination it cannot act on.
  const destination = value('destination');
  const fallback = value('fallback');
  return {
    enabled: isPluginEnabled(applyPluginOverrides(shared, overrides), WELCOME_ID),
    text: text('text'),
    returningText: text('returningText'),
    separateReturning: value('separateReturning') === true,
    destination: DESTINATIONS.includes(destination as Destination)
      ? (destination as Destination)
      : 'group',
    fallback: FALLBACKS.includes(fallback as Fallback) ? (fallback as Fallback) : 'group',
  };
}
