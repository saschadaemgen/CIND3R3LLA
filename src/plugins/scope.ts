/**
 * Which plugin settings belong to one bot, and which to the deployment
 * (CCB-S5-021, D-175).
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────────
 *
 * Plugin state lived under a single `plugins` settings key, so switching Web Search on
 * switched it on for every hosted bot. CCB-S5-006 placed every interaction setting and could
 * not have caught this: plugin enablement is not in `InteractionSettings` at all, it is in a
 * different settings key with a different owner, and a sweep of one type cannot see the
 * other.
 *
 * ── THE INVENTORY IS DATA, NOT PROSE ─────────────────────────────────────────
 *
 * {@link PLUGIN_SETTING_SCOPES} is the briefing's deliverable in executable form, for the
 * reason `setting-scope.ts` gives: written as a table in a document it would drift from the
 * code, and the drift would be invisible, because an unplaced setting is silently shared -
 * which is exactly how `wakeWord` came to be shared, and how this did.
 *
 * As data it can be checked. `verify:plugin-scope` asserts that EVERY registered plugin has
 * placements and that EVERY key of each plugin's settings document appears here, so a
 * capability added later without an inventory entry fails a check rather than defaulting to
 * whichever answer the type happened to produce.
 *
 * ── THE PATTERN A FUTURE PER-BOT CAPABILITY FOLLOWS ──────────────────────────
 *
 * Three questions, in this order, and the answers fell out the same way for both plugins:
 *
 *   1. Does it decide WHETHER this bot has the capability, or WHAT the capability reaches?
 *      Then it is PER BOT. That is what makes a second bot worth having.
 *   2. Is it a CREDENTIAL, an upstream QUOTA, or a CACHE? Then it is SHARED. One account,
 *      one bill, one cache, and asking an operator to paste a key per bot is an invitation
 *      to leak it.
 *   3. Is it a SAFETY BOUND on what reaches the model? Then it is SHARED, and for the reason
 *      constitutional laws are: an outermost limit with N values is a limit nobody can
 *      state, and tightening it later would reach only the bots nobody had touched.
 *
 * The knowledge base the operator wants next lands cleanly on that: its enablement and the
 * DOCUMENTS it is given are per bot (1), its embedding credentials and index are shared (2),
 * and the amount of retrieved text that reaches a prompt is shared (3).
 */

import { DEFAULT_CRYPTO_PRICES } from './crypto-prices/settings.js';
import { CRYPTO_PRICES_ID } from './crypto-prices/plugin.js';
import { WEB_SEARCH_DEFAULTS } from './web-search/settings.js';
import { WEB_SEARCH_ID } from './web-search/plugin.js';
import { KNOWLEDGE_DEFAULTS } from './knowledge-base/settings.js';
import { KNOWLEDGE_BASE_ID } from './knowledge-base/plugin.js';
import { listPlugins, type PluginStates } from './registry.js';

/** Where a plugin setting lives. */
export type PluginSettingScope =
  /** One value for the deployment. Editing it reaches every bot. */
  | 'shared'
  /** Each bot may deviate; unset means inherit the shared value. */
  | 'per-bot';

/**
 * The one key that is not a field of a plugin's settings document.
 *
 * Enablement lives under the `plugins` settings key rather than under `plugin:<id>`, which
 * is why it is named here rather than derived: the inventory covers what an operator can
 * set about a plugin, and that is the most important thing they can set.
 */
export const ENABLED_KEY = 'enabled';

export interface PluginSettingPlacement {
  /** The plugin's slug, as `definePlugin` registered it. */
  pluginId: string;
  /** `enabled`, or a top-level key of that plugin's settings document. */
  key: string;
  scope: PluginSettingScope;
  /** What the console calls it, so a badge can name the control rather than the field. */
  label: string;
  /** One line, shown in the console beside the setting. */
  reason: string;
}

/**
 * THE INVENTORY.
 *
 * Every key of both plugins' settings documents, plus each plugin's enablement. Nested keys
 * are listed as a WHOLE where every part shares one scope for one reason - `providers` is
 * credentials and upstream quotas throughout - and would be listed individually if the parts
 * ever differed, which is the rule `setting-scope.ts` set.
 */
export const PLUGIN_SETTING_SCOPES: readonly PluginSettingPlacement[] = Object.freeze([
  /* ── Web Search ─────────────────────────────────────────────────────────── */
  {
    pluginId: WEB_SEARCH_ID,
    key: ENABLED_KEY,
    scope: 'per-bot',
    label: 'Web search enabled',
    reason:
      'Whether this bot can look things up at all. This is the capability, and one bot that searches beside one that does not is the reason for a second bot.',
  },
  {
    pluginId: WEB_SEARCH_ID,
    key: 'provider',
    scope: 'shared',
    label: 'Search provider',
    reason:
      'One account and one key. A bot pointed at a provider whose credential the deployment does not hold would fail in a way the console could not explain.',
  },
  {
    pluginId: WEB_SEARCH_ID,
    key: 'apiKey',
    scope: 'shared',
    label: 'Search API key',
    reason:
      'One account, one key. Asking an operator to paste a live credential once per bot is an invitation to leak it, and it would be the same secret each time.',
  },
  {
    pluginId: WEB_SEARCH_ID,
    key: 'maxResults',
    scope: 'shared',
    label: 'Results per search',
    reason:
      'Part of the untrusted-text budget rather than a quality knob. The size of the injection surface must be one number or nobody can state it for any bot.',
  },
  {
    pluginId: WEB_SEARCH_ID,
    key: 'perResultChars',
    scope: 'shared',
    label: 'Characters per result',
    reason: 'The same safety bound, per result. It travels with the total it is a share of.',
  },
  {
    pluginId: WEB_SEARCH_ID,
    key: 'totalChars',
    scope: 'shared',
    label: 'Characters in total',
    reason:
      'How much text written by strangers can reach a prompt. A per-bot value would mean tightening it later reached only the bots nobody had touched.',
  },
  {
    pluginId: WEB_SEARCH_ID,
    key: 'timeoutMs',
    scope: 'shared',
    label: 'Search timeout',
    reason: 'A property of the one provider being called, not of the bot that asked.',
  },
  {
    pluginId: WEB_SEARCH_ID,
    key: 'rateLimitPerMember',
    scope: 'shared',
    label: 'Searches per member',
    reason:
      'The NUMBER is the bill, which is one account. The BUDGET is spent per bot, so a busy bot cannot starve a quiet one.',
  },
  {
    pluginId: WEB_SEARCH_ID,
    key: 'rateLimitPerChat',
    scope: 'shared',
    label: 'Searches per chat',
    reason: 'The per-chat form of the same bill, spent per bot for the same reason.',
  },
  {
    pluginId: WEB_SEARCH_ID,
    key: 'rateLimitWindowSeconds',
    scope: 'shared',
    label: 'Rate-limit window',
    reason: 'The window both limits are counted over. It cannot differ from the limits it qualifies.',
  },

  /* ── Crypto Prices ──────────────────────────────────────────────────────── */
  {
    pluginId: CRYPTO_PRICES_ID,
    key: ENABLED_KEY,
    scope: 'per-bot',
    label: 'Crypto prices enabled',
    reason:
      'Whether this bot answers price questions at all. The capability, on the same terms as search.',
  },
  {
    pluginId: CRYPTO_PRICES_ID,
    key: 'chain',
    scope: 'shared',
    label: 'Provider order',
    reason:
      'Which upstream answers first. Two bots on different chains would quote different prices for one asset at one moment, and the archive would record both.',
  },
  {
    pluginId: CRYPTO_PRICES_ID,
    key: 'providers',
    scope: 'shared',
    label: 'Providers, their keys, timeouts and per-minute limits',
    reason:
      'Credentials and upstream quotas throughout. Every part is about the account the deployment holds with a third party, so no part of it splits per bot.',
  },
  {
    pluginId: CRYPTO_PRICES_ID,
    key: 'baseCurrency',
    scope: 'shared',
    label: 'Default quote currency',
    reason:
      'An audience preference, and a weaker one than language, which is already shared. Per-bot currency beside shared language would be incoherent.',
  },
  {
    pluginId: CRYPTO_PRICES_ID,
    key: 'cacheTtlSeconds',
    scope: 'shared',
    label: 'Price cache lifetime',
    reason:
      'There is one cache, and it exists to protect the provider quota. Per bot it would become either N caches or the shortest lifetime for everyone.',
  },
  {
    pluginId: CRYPTO_PRICES_ID,
    key: 'rateLimitPerMember',
    scope: 'shared',
    label: 'Price questions per member',
    reason:
      'The NUMBER is shared; the budget is already spent per bot, because each engine holds its own conversation state (CCB-S5-001).',
  },
  {
    pluginId: CRYPTO_PRICES_ID,
    key: 'rateLimitPerChat',
    scope: 'shared',
    label: 'Price questions per chat',
    reason: 'The per-chat form of the same flood bound, spent per bot for the same reason.',
  },
  {
    pluginId: CRYPTO_PRICES_ID,
    key: 'disclaimer',
    scope: 'shared',
    label: 'Price disclaimer',
    reason:
      'Legal copy about market data. Two bots in one community stating different terms is the same defect as two bots offering different consent terms.',
  },
  {
    pluginId: CRYPTO_PRICES_ID,
    key: 'maxCandidates',
    scope: 'shared',
    label: 'Candidates when a symbol is ambiguous',
    reason: 'A disambiguation bound. Mechanics of resolving a ticker, not a trait of a bot.',
  },
  {
    pluginId: CRYPTO_PRICES_ID,
    key: 'dominanceFactor',
    scope: 'shared',
    label: 'Auto-resolve dominance factor',
    reason: 'The other half of the same disambiguation mechanic, and it travels with it.',
  },

  /* ── Knowledge Base (CCB-S5-022) ────────────────────────────────────────── */
  //
  // The whole point of D-175's pattern, tested: what a bot is GIVEN is per bot, the store
  // and the model behind it are shared. Note that the DOCUMENTS are per bot without
  // appearing here, because a grant is a row in `cinderella_kb_document_bots` rather than a
  // setting: absence there means NOT GIVEN, where absence in this table means inherit.
  {
    pluginId: KNOWLEDGE_BASE_ID,
    key: ENABLED_KEY,
    scope: 'per-bot',
    label: 'Knowledge base enabled',
    reason:
      'Whether this bot reads what it was given at all. One bot with the protocol work beside one with nothing is the capability.',
  },
  {
    pluginId: KNOWLEDGE_BASE_ID,
    key: 'trigger',
    scope: 'shared',
    label: 'When she consults it',
    reason:
      'Whether retrieval is attempted at all is a deployment behaviour, and the relevance floor rather than the trigger is what decides per question.',
  },
  {
    pluginId: KNOWLEDGE_BASE_ID,
    key: 'targetChars',
    scope: 'shared',
    label: 'Chunk size',
    reason:
      'It decides what is IN the one shared store. Two bots reading chunks cut to different sizes would need two stores.',
  },
  {
    pluginId: KNOWLEDGE_BASE_ID,
    key: 'overlapChars',
    scope: 'shared',
    label: 'Chunk overlap',
    reason: 'The other half of the same cut, and it cannot differ from the size it qualifies.',
  },
  {
    pluginId: KNOWLEDGE_BASE_ID,
    key: 'maxChars',
    scope: 'shared',
    label: 'Chunk ceiling',
    reason: 'The hard bound on a single stored chunk. A property of the store, not of a reader.',
  },
  {
    pluginId: KNOWLEDGE_BASE_ID,
    key: 'contextualPrefix',
    scope: 'shared',
    label: 'Contextual prefixing',
    reason:
      'It changes what is indexed, so it is an ingest setting: turning it off for one bot would mean re-embedding the shared store.',
  },
  {
    pluginId: KNOWLEDGE_BASE_ID,
    key: 'candidatesPerSearch',
    scope: 'shared',
    label: 'Candidates per search',
    reason: 'How hard the one index is worked. A cost, not a character.',
  },
  {
    pluginId: KNOWLEDGE_BASE_ID,
    key: 'maxChunks',
    scope: 'shared',
    label: 'Chunks in the prompt',
    reason: 'Travels with the budget it shares a purpose with.',
  },
  {
    pluginId: KNOWLEDGE_BASE_ID,
    key: 'keywordWeight',
    scope: 'shared',
    label: 'Keyword weight',
    reason:
      'How the one index is searched. A property of the corpus, which is one corpus, rather than of the bot asking.',
  },
  {
    pluginId: KNOWLEDGE_BASE_ID,
    key: 'vectorWeight',
    scope: 'shared',
    label: 'Vector weight',
    reason: 'The other side of the same fusion, and meaningless apart from it.',
  },
  {
    pluginId: KNOWLEDGE_BASE_ID,
    key: 'minScore',
    scope: 'shared',
    label: 'Minimum relevance',
    reason:
      'The floor below which she says she has nothing. It is the promise the feature makes, and a promise with N values is one nobody can state.',
  },
  {
    pluginId: KNOWLEDGE_BASE_ID,
    key: 'budgetChars',
    scope: 'shared',
    label: 'Retrieved text budget',
    reason:
      'A SAFETY BOUND on what reaches the model, on exactly the terms the web search budgets are shared: one number, or nobody can state it for any bot.',
  },
]);

/** One bot's deviation from one plugin setting. Absence means inherit; NULL is not stored. */
export interface PluginOverride {
  botProfileId: number;
  pluginId: string;
  key: string;
  /** Parsed JSON. The shape is whatever the setting's type is; `enabled` is a boolean. */
  value: unknown;
}

const placementKey = (pluginId: string, key: string): string => `${pluginId}:${key}`;
const byKey = new Map(
  PLUGIN_SETTING_SCOPES.map((p) => [placementKey(p.pluginId, p.key), p] as const),
);

/** Where a plugin setting lives, or undefined when it has not been placed. */
export function placementOf(pluginId: string, key: string): PluginSettingPlacement | undefined {
  return byKey.get(placementKey(pluginId, key));
}

/** Whether a plugin setting may be set for one bot. */
export function isPerBotPluginSetting(pluginId: string, key: string): boolean {
  return byKey.get(placementKey(pluginId, key))?.scope === 'per-bot';
}

/**
 * Why a deployment-wide plugin setting cannot be set per bot, in a sentence a console can
 * print.
 *
 * Matches `sharedReason` in `setting-scope.ts` in shape and purpose: a setting that cannot be
 * per bot SAYS so with the reason, rather than offering a control that then refuses.
 */
export function sharedPluginReason(pluginId: string, key: string): string {
  const p = byKey.get(placementKey(pluginId, key));
  return p === undefined
    ? `${pluginId}.${key} has not been placed, so it cannot be set for one bot until somebody decides where it belongs.`
    : `Deployment-wide. ${p.reason}`;
}

/**
 * One bot's effective plugin states: the shared states with that bot's deviations applied.
 *
 * A deviation on a SHARED key is ignored rather than applied, and so is one naming a plugin
 * this build does not carry. The database refuses the first (the CHECK) and permits the
 * second (no foreign key, deliberately); ignoring both here is the difference between a
 * defence in depth and a comment claiming one.
 */
export function applyPluginOverrides(
  shared: PluginStates,
  overrides: readonly PluginOverride[],
): PluginStates {
  const out: PluginStates = { ...shared };
  for (const o of overrides) {
    if (o.key !== ENABLED_KEY) continue;
    if (!isPerBotPluginSetting(o.pluginId, o.key)) continue;
    // A plugin the build no longer registers has no entry to deviate from. Skipped rather
    // than added, so a stale row cannot invent a plugin state for something that cannot run.
    if (!(o.pluginId in shared)) continue;
    out[o.pluginId] = { enabled: Boolean(o.value) };
  }
  return out;
}

export interface PluginScopeView {
  pluginId: string;
  key: string;
  scope: PluginSettingScope;
  label: string;
  reason: string;
  /** Bots that deviate from the shared value. Empty for a deployment-wide setting. */
  deviatingBotIds: number[];
  /** How many bots read the SHARED value. Excludes the deviating ones. */
  sharedBotCount: number;
}

/**
 * What the console has to say about every plugin setting's scope.
 *
 * `sharedBotCount` excludes the deviating bots, for the reason the Book's and the
 * interaction inventory's versions do: a setting three of five bots have overridden reaches
 * two, and an edit warning that said five would be a false number on the one control whose
 * job is to be trusted.
 */
export function describePluginScopes(
  overrides: readonly PluginOverride[],
  botCount: number,
): Map<string, PluginScopeView> {
  const deviations = new Map<string, number[]>();
  for (const o of overrides) {
    if (!isPerBotPluginSetting(o.pluginId, o.key)) continue;
    const k = placementKey(o.pluginId, o.key);
    const list = deviations.get(k);
    if (list) list.push(o.botProfileId);
    else deviations.set(k, [o.botProfileId]);
  }

  const out = new Map<string, PluginScopeView>();
  for (const p of PLUGIN_SETTING_SCOPES) {
    const k = placementKey(p.pluginId, p.key);
    const ids = p.scope === 'per-bot' ? (deviations.get(k) ?? []) : [];
    out.set(k, {
      pluginId: p.pluginId,
      key: p.key,
      scope: p.scope,
      label: p.label,
      reason: p.reason,
      deviatingBotIds: ids,
      sharedBotCount: Math.max(0, botCount - ids.length),
    });
  }
  return out;
}

/**
 * Every setting this build expects to see placed, per plugin.
 *
 * Derived from the DEFAULTS rather than from a hand-written list, so a field added to a
 * plugin's settings type appears here the moment it exists and `verify:plugin-scope` reports
 * it unplaced. That is the D-105 shape applied to a settings document instead of a source
 * tree: nothing announces a new field, so the check has to go and look.
 */
export function expectedPluginSettingKeys(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const def of listPlugins()) out.set(def.id, [ENABLED_KEY]);
  const add = (pluginId: string, keys: string[]): void => {
    const existing = out.get(pluginId);
    if (existing) existing.push(...keys);
  };
  add(CRYPTO_PRICES_ID, Object.keys(DEFAULT_CRYPTO_PRICES));
  add(WEB_SEARCH_ID, Object.keys(WEB_SEARCH_DEFAULTS));
  add(KNOWLEDGE_BASE_ID, Object.keys(KNOWLEDGE_DEFAULTS));
  return out;
}
