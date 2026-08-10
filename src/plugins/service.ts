/**
 * Plugin state + per-plugin settings (CCB-S3-004 §0), PER BOT since CCB-S5-021.
 *
 * Enablement lives under the `plugins` settings key; each plugin's own settings
 * live under `plugin:<id>`. Keeping them separate is what lets a plugin own its
 * schema without the core settings model knowing anything about it.
 *
 * Enablement decides the INTENT CATALOG. That is the mechanism behind "a disabled plugin
 * registers no intents": it is not a check inside a handler, it is the absence of the
 * intent from the catalog the resolver validates against.
 *
 * ── ONE CATALOG WAS A PROCESS FACT, AND IT SHOULD NOT HAVE BEEN ──────────────
 *
 * The catalog used to be module state in `interaction/intent.ts`, written here by
 * `setActiveIntents` whenever enablement changed. With one hosted bot that was right; with
 * several it meant a plugin switched off for one bot was still in every bot's vocabulary,
 * which is the defect CCB-S5-021 exists to fix. The catalog is now built per bot by
 * {@link PluginService.capabilitiesFor} and carried in `IntentContext`.
 *
 * The per-bot cache is keyed by bot beside the shared states, and it RE-DERIVES rather than
 * clears: each entry keeps the rows it was built from, so a shared change recomputes every
 * bot in memory with no query, and a per-bot change re-reads exactly one bot. Clearing would
 * be simpler and would open the fail-closed window `statesFor` describes on every console
 * toggle, which is the one moment an operator is watching.
 */

import { log } from '../log.js';
import { getSetting, setSetting } from '../db/settings.js';
import { secretLayers } from './secrets.js';
import type { Queryable } from '../db/pool.js';
import { writeAudit } from '../db/audit.js';
import { status } from '../web/status.js';
import { capabilityCatalog, type Intent } from '../interaction/intent.js';
import {
  clearPluginOverride,
  listPluginOverridesForBot,
  setPluginOverride,
} from '../db/plugin-overrides.js';
import { applyPluginOverrides, ENABLED_KEY, type PluginOverride } from './scope.js';
import {
  activePluginIntents,
  isPluginEnabled,
  listPlugins,
  normalizePluginStates,
  type PluginStates,
} from './registry.js';
import {
  DEFAULT_CRYPTO_PRICES,
  normalizeCryptoPrices,
  type CryptoPricesSettings,
} from './crypto-prices/settings.js';
// Importing the plugin module is what registers it. Every plugin is imported
// here, which is the single place a new one is added.
import { CRYPTO_PRICES_ID } from './crypto-prices/plugin.js';
import {
  applyWebSearchForm,
  normalizeWebSearchSettings,
  WEB_SEARCH_DEFAULTS,
  type WebSearchSettings,
} from './web-search/settings.js';
import { WEB_SEARCH_ID } from './web-search/plugin.js';

const STATES_KEY = 'plugins';
const settingsKey = (id: string): string => `plugin:${id}`;

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export class PluginService {
  /**
   * One bot's effective states, and WHICH plugins it deviates on.
   *
   * The deviation set is kept rather than derived by comparing the effective value to the
   * shared one, because those two answers differ in exactly the case that matters: a bot
   * explicitly switched ON while the deployment also has it on is NOT inheriting, and
   * treating it as inheriting would let a later shared change silently switch it off
   * against the operator's stated choice.
   */
  private readonly perBot = new Map<
    number,
    { states: PluginStates; overrides: PluginOverride[]; deviations: Set<string> }
  >();
  private readonly inFlight = new Map<number, Promise<void>>();

  private constructor(
    private readonly db: Queryable,
    private states: PluginStates,
    private cryptoPrices: CryptoPricesSettings,
    private webSearch: WebSearchSettings,
  ) {}

  static async load(db: Queryable): Promise<PluginService> {
    const states = normalizePluginStates((await getSetting(db, STATES_KEY)) ?? {});
    const stored = (await getSetting(db, settingsKey(CRYPTO_PRICES_ID))) ?? {};
    const crypto = normalizeCryptoPrices(stored, DEFAULT_CRYPTO_PRICES);

    // Web search (CCB-S4-037). Normalised on read like everything else, so a stored
    // document written by another version cannot hand the prompt builder a budget nobody
    // typed. No repair pass: this plugin has never had the doubled-encryption bug the
    // crypto keys needed one for.
    const webSearch = normalizeWebSearchSettings(
      (await getSetting(db, settingsKey(WEB_SEARCH_ID))) ?? WEB_SEARCH_DEFAULTS,
    );

    // Self-repair for instances written by the doubled-encryption path
    // (CCB-S3-008 §2). The normalizer has already unwrapped the extra layers in
    // memory; persisting them here means it happens once rather than on every
    // boot. The count is logged and the value never is.
    // Detected by LAYER COUNT, not by comparing ciphertext: every encryption uses
    // a fresh IV, so a string comparison differs even when nothing was wrong, and
    // this would rewrite the settings on every single boot.
    const before = rec(rec(stored)['providers']);
    const repaired = Object.keys(crypto.providers).filter(
      (name) => secretLayers(str(rec(before[name])['apiKey'])) > 1,
    );
    if (repaired.length > 0) {
      // NON-FATAL. `load()` used to be read-only and is awaited unguarded during
      // boot; a settings table that will not take a write must not stop the bot
      // from starting. The in-memory value is already correct either way, so the
      // worst case is that the repair is redone on the next boot.
      try {
        await setSetting(db, settingsKey(CRYPTO_PRICES_ID), crypto);
        // Audited like every other settings write. Provider names only — never a
        // key, and never a layer's contents.
        await writeAudit(db, 'system', 'plugin.secret.repair', `plugin:${CRYPTO_PRICES_ID}`, {
          providers: repaired,
        });
        log.warn(
          `Repaired ${repaired.length} provider key(s) that had been encrypted more than once ` +
            `(${repaired.join(', ')}). Those providers were being sent an unusable credential ` +
            `until now.`,
        );
      } catch (err) {
        log.error(
          `Could not persist the repaired provider key(s) (${
            err instanceof Error ? err.message : String(err)
          }). They are correct in memory; the repair will be retried on the next start.`,
        );
      }
    }
    return new PluginService(db, states, crypto, webSearch);
  }

  /** All-defaults instance, for harnesses and the server's fallback path. */
  static withDefaults(db: Queryable): PluginService {
    return new PluginService(
      db,
      normalizePluginStates({}),
      normalizeCryptoPrices({}),
      normalizeWebSearchSettings({}),
    );
  }

  /**
   * The SHARED states, which is what the deployment-wide console view and every
   * deployment-wide reader want. The reply path always names a bot.
   */
  getStates(): PluginStates {
    return { ...this.states };
  }

  /**
   * One bot's states, or the shared ones when no bot is named.
   *
   * ── THE CACHE MISS FAILS CLOSED, AND THAT IS THE OPPOSITE OF `InteractionService` ──
   *
   * `InteractionService` answers a miss with the SHARED record, deliberately: a bot briefly
   * reading the wake word it inherits is a smaller wrong than a bot answering to nothing.
   * The trade runs the other way here and the direction matters more than the consistency.
   * A capability answered from the shared states is a bot doing something the operator
   * forbade it, which is the whole defect CCB-S5-021 exists to fix; a capability withheld
   * for one message is a question she does not understand. So a miss answers with NO plugin
   * capabilities at all, and the refresh it kicks fills the cache behind it.
   *
   * In practice this window does not open: the boot path warms every hosted bot before its
   * engine can be asked anything, and both writers below re-derive rather than clear. What
   * is left is the fault case, where the read failed and `refreshFor` has already said so on
   * the dashboard. Losing a capability while that is true is the correct answer.
   */
  statesFor(botProfileId?: number): PluginStates {
    if (botProfileId === undefined) return this.states;
    const cached = this.perBot.get(botProfileId);
    if (cached !== undefined) return cached.states;
    void this.kickRefreshFor(botProfileId);
    return PluginService.noCapabilities();
  }

  /** Every registered plugin, off. What an unread bot has until its rows are read. */
  private static noCapabilities(): PluginStates {
    const out: PluginStates = {};
    for (const def of listPlugins()) out[def.id] = { enabled: false };
    return out;
  }

  /** Which plugins this bot has an explicit answer for. Empty while its row set is unread. */
  deviationsOf(botProfileId?: number): Set<string> {
    if (botProfileId === undefined) return new Set();
    return this.perBot.get(botProfileId)?.deviations ?? new Set();
  }

  /** One bot's rows, turned into what that bot can do. Pure; no query. */
  private derive(overrides: PluginOverride[]): {
    states: PluginStates;
    overrides: PluginOverride[];
    deviations: Set<string>;
  } {
    return {
      states: applyPluginOverrides(this.states, overrides),
      overrides,
      deviations: new Set(overrides.filter((o) => o.key === ENABLED_KEY).map((o) => o.pluginId)),
    };
  }

  /** Load one bot's effective plugin states. */
  async refreshFor(botProfileId: number): Promise<void> {
    try {
      this.perBot.set(
        botProfileId,
        this.derive(await listPluginOverridesForBot(this.db, botProfileId)),
      );
    } catch (error) {
      // Surfaced, never swallowed (CCB-S3-023). Nothing is cached, so `statesFor` keeps
      // answering with NO capabilities: this bot loses its plugins rather than silently
      // running the deployment's, which is the direction that cannot break a promise. It is
      // loud because that state is a fault and an operator has to be able to find it, and
      // the wording says what actually happens rather than what the fallback used to be.
      log.warn(
        `Plugins: reading bot ${botProfileId}'s capabilities failed; it is running with ` +
          `NONE until the read succeeds (${
            error instanceof Error ? error.message : String(error)
          }).`,
      );
      status.error(
        `The per-bot plugin settings of bot ${botProfileId} could not be read, so every ` +
          `plugin is switched off for it until they can be. It will say it does not ` +
          `understand price and lookup questions rather than answering them from the ` +
          `deployment-wide settings.`,
      );
    }
  }

  private kickRefreshFor(botProfileId: number): Promise<void> {
    let p = this.inFlight.get(botProfileId);
    if (p === undefined) {
      p = this.refreshFor(botProfileId).finally(() => this.inFlight.delete(botProfileId));
      this.inFlight.set(botProfileId, p);
    }
    return p;
  }

  /**
   * Re-derive every cached bot from the shared states it just changed.
   *
   * RE-DERIVES rather than clears, and it needs no query: each entry keeps the rows it was
   * built from, and only the shared half moved. Clearing would open the fail-closed window
   * `statesFor` describes on every console toggle, which would mean a bot losing a
   * capability it has for one message every time the operator touched an unrelated switch.
   */
  private rederiveAll(): void {
    for (const [botProfileId, entry] of this.perBot) {
      this.perBot.set(botProfileId, this.derive(entry.overrides));
    }
  }

  /** Drop every per-bot value. For a caller that wants the rows re-read from scratch. */
  invalidate(): void {
    this.perBot.clear();
  }

  /**
   * THE CAPABILITIES OF ONE BOT: the core intents plus the intents of the plugins enabled
   * for it (CCB-S5-021).
   *
   * This is the whole absent-capability property. A bot without web search is not handed
   * LOOKUP, so the rule engine never matches a lookup pattern for it, the model is never
   * shown the intent, and the resolver seam downgrades anything claiming it to UNKNOWN.
   * It does not refuse; it does not have it.
   */
  capabilitiesFor(botProfileId?: number): Intent[] {
    return capabilityCatalog(activePluginIntents(this.statesFor(botProfileId)));
  }

  /** Whether a plugin is on, deployment-wide. */
  isEnabled(id: string): boolean {
    return isPluginEnabled(this.states, id);
  }

  /** Whether a plugin is on FOR ONE BOT. The reply path asks this one. */
  isEnabledFor(botProfileId: number | undefined, id: string): boolean {
    return isPluginEnabled(this.statesFor(botProfileId), id);
  }

  /**
   * Set or clear one bot's deviation for one plugin.
   *
   * `null` removes the deviation and puts the bot back on the shared value, which is a
   * different act from switching it off and reads differently in the console: inheriting is
   * "whatever the deployment says", off is "not for this one".
   */
  async setEnabledForBot(
    botProfileId: number,
    id: string,
    enabled: boolean | null,
    actor: string,
  ): Promise<void> {
    if (enabled === null) {
      await clearPluginOverride(this.db, botProfileId, id, ENABLED_KEY);
    } else {
      await setPluginOverride(this.db, botProfileId, id, ENABLED_KEY, enabled);
    }
    await writeAudit(this.db, actor, 'plugin.toggle.bot', `plugin:${id}`, {
      botProfileId,
      enabled,
    });
    // ONLY this bot's rows moved, so only this bot is re-read, and it is re-read rather
    // than dropped: a cleared entry would leave that bot with no capabilities until the
    // next refresh landed, which is the fail-closed window `statesFor` describes.
    await this.refreshFor(botProfileId);
  }

  /**
   * The installed plugins and whether each is on.
   *
   * With a bot named, `enabled` is THAT BOT'S answer and `inherited` says whether it comes
   * from the deployment or from a deviation of its own. The console needs both: "off" and
   * "off because the deployment has it off" are different states and an operator who cannot
   * tell them apart cannot tell what switching the shared value would do.
   */
  list(botProfileId?: number): {
    id: string;
    name: string;
    description: string;
    version: string;
    adminPath: string;
    enabled: boolean;
    /** What the deployment says, whatever this bot says. */
    sharedEnabled: boolean;
    /** True when this bot has no deviation and is following the shared value. */
    inherited: boolean;
  }[] {
    const states = this.statesFor(botProfileId);
    const deviations = this.deviationsOf(botProfileId);
    return listPlugins().map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      version: p.version,
      adminPath: p.adminPath,
      enabled: isPluginEnabled(states, p.id),
      sharedEnabled: isPluginEnabled(this.states, p.id),
      // From the presence of a ROW, never from comparing the two values: see `perBot`.
      inherited: !deviations.has(p.id),
    }));
  }

  async setEnabled(id: string, enabled: boolean, actor: string): Promise<void> {
    this.states = normalizePluginStates({ ...this.states, [id]: { enabled } });
    await setSetting(this.db, STATES_KEY, this.states);
    await writeAudit(this.db, actor, 'plugin.toggle', `plugin:${id}`, { enabled });
    // Every bot's effective states are derived from this one, so a shared save re-derives
    // all of them, in memory and with no query. The catalog changes immediately: a plugin
    // switched off leaves the vocabulary of every bot that inherits, without a restart.
    this.rederiveAll();
  }

  /* ── Crypto Prices settings ─────────────────────────────────────────── */

  getCryptoPrices(): CryptoPricesSettings {
    return this.cryptoPrices;
  }

  /**
   * Saves the plugin's settings. The PREVIOUS value is passed to normalisation
   * so an untouched write-only API key field carries the stored key forward
   * instead of blanking it.
   */
  /* ── Web Search settings (CCB-S4-037) ───────────────────────────────── */

  getWebSearch(): WebSearchSettings {
    return this.webSearch;
  }

  /**
   * Saves the plugin's settings.
   *
   * The audit detail records `keySet` and NEVER the key, exactly as the price plugin's
   * does. It also records the budgets, because those are the size of the untrusted-text
   * surface rather than a cosmetic preference, and an operator who widened them should be
   * able to see when.
   */
  async saveWebSearch(next: unknown, actor: string): Promise<WebSearchSettings> {
    const normalized = applyWebSearchForm(this.webSearch, (next ?? {}) as Record<string, unknown>);
    await setSetting(this.db, settingsKey(WEB_SEARCH_ID), normalized);
    await writeAudit(this.db, actor, 'plugin.settings', `plugin:${WEB_SEARCH_ID}`, {
      provider: normalized.provider,
      keySet: normalized.apiKey !== '',
      maxResults: normalized.maxResults,
      perResultChars: normalized.perResultChars,
      totalChars: normalized.totalChars,
      timeoutMs: normalized.timeoutMs,
      rateLimitPerMember: normalized.rateLimitPerMember,
      rateLimitPerChat: normalized.rateLimitPerChat,
    });
    this.webSearch = normalized;
    return normalized;
  }

  async saveCryptoPrices(next: unknown, actor: string): Promise<CryptoPricesSettings> {
    const normalized = normalizeCryptoPrices(next, this.cryptoPrices);
    await setSetting(this.db, settingsKey(CRYPTO_PRICES_ID), normalized);
    // The audit detail deliberately omits every API key.
    await writeAudit(this.db, actor, 'plugin.settings', `plugin:${CRYPTO_PRICES_ID}`, {
      chain: normalized.chain,
      baseCurrency: normalized.baseCurrency,
      cacheTtlSeconds: normalized.cacheTtlSeconds,
      rateLimitPerMember: normalized.rateLimitPerMember,
      rateLimitPerChat: normalized.rateLimitPerChat,
      disclaimerSet: normalized.disclaimer !== '',
      providers: Object.fromEntries(
        Object.entries(normalized.providers).map(([k, v]) => [
          k,
          { enabled: v.enabled, keySet: v.apiKey !== '', timeoutMs: v.timeoutMs },
        ]),
      ),
    });
    this.cryptoPrices = normalized;
    return normalized;
  }
}
