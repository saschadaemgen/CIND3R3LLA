/**
 * Web Search plugin settings (CCB-S4-037, D-141), stored under `plugin:web-search`.
 *
 * Same storage rules as the price plugin: settings live under the plugin, and the API key
 * goes through `plugins/secrets.ts` so it is encrypted at rest, never rendered back into
 * the form, and never logged.
 *
 * ── THE BUDGETS ARE A SAFETY CONTROL, NOT A PREFERENCE ───────────────────────
 *
 * `maxResults`, `perResultChars` and `totalChars` decide how much untrusted text reaches a
 * prompt. That is not a tuning knob about answer quality, it is the size of the injection
 * surface and the amount of context that can be spent crowding out her instructions. The
 * conversation prompt is roughly 2000 tokens against a served context of 32768
 * (CCB-S4-034), so the shipped total of 2400 characters is around 600 tokens: enough for
 * five real snippets, and nowhere near enough to push anything out.
 *
 * The ceilings are enforced in the normaliser rather than trusted from the form, because a
 * stored document written by a different version must not be able to hand the prompt
 * builder a 200 KB budget.
 */

import {
  applySecretUpdate,
  describeSecret,
  encryptSecret,
  isEncrypted,
  repairSecret,
} from '../secrets.js';

/** Providers this build can construct. The console offers exactly these. */
export const SEARCH_PROVIDERS = ['brave'] as const;
export type SearchProviderName = (typeof SEARCH_PROVIDERS)[number];

export interface WebSearchSettings {
  provider: SearchProviderName;
  /** Encrypted, write-only. Never rendered back into the form. */
  apiKey: string;
  /** How many results to ask the provider for. */
  maxResults: number;
  /** Hard cap per result on title + snippet, in characters. */
  perResultChars: number;
  /** Hard cap on ALL fenced material in one prompt, in characters. */
  totalChars: number;
  timeoutMs: number;
  /** Searches one member may cause per rolling window. */
  rateLimitPerMember: number;
  /** Searches one chat may cause per rolling window. */
  rateLimitPerChat: number;
  /** The rolling window both limits are counted over. */
  rateLimitWindowSeconds: number;
}

export const WEB_SEARCH_DEFAULTS: Readonly<WebSearchSettings> = Object.freeze({
  provider: 'brave',
  apiKey: '',
  maxResults: 5,
  perResultChars: 400,
  totalChars: 2400,
  timeoutMs: 6000,
  // Deliberately tight. Every search is an outbound request that may cost money, and a
  // busy group asking her things is the normal case rather than an attack.
  rateLimitPerMember: 5,
  rateLimitPerChat: 20,
  rateLimitWindowSeconds: 600,
});

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function normalizeWebSearchSettings(raw: unknown): WebSearchSettings {
  const o =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const d = WEB_SEARCH_DEFAULTS;

  const provider = asText(o['provider']).trim();

  return {
    provider: (SEARCH_PROVIDERS as readonly string[]).includes(provider)
      ? (provider as SearchProviderName)
      : d.provider,
    // Repaired if a previous build double-wrapped it, kept as-is otherwise. Same
    // treatment the price plugin gives its keys.
    apiKey: (() => {
      const stored = asText(o['apiKey']);
      return stored ? (repairSecret(stored) ?? stored) : '';
    })(),
    maxResults: clampInt(o['maxResults'], 1, 10, d.maxResults),
    // The ceilings below are the injection surface. 1200 per result and 6000 total are
    // already generous; anything larger is a stored value nobody typed.
    perResultChars: clampInt(o['perResultChars'], 80, 1200, d.perResultChars),
    totalChars: clampInt(o['totalChars'], 200, 6000, d.totalChars),
    timeoutMs: clampInt(o['timeoutMs'], 1000, 20_000, d.timeoutMs),
    rateLimitPerMember: clampInt(o['rateLimitPerMember'], 0, 1000, d.rateLimitPerMember),
    rateLimitPerChat: clampInt(o['rateLimitPerChat'], 0, 5000, d.rateLimitPerChat),
    rateLimitWindowSeconds: clampInt(
      o['rateLimitWindowSeconds'],
      30,
      86_400,
      d.rateLimitWindowSeconds,
    ),
  };
}

/**
 * Apply a console save.
 *
 * The key follows the price plugin's rule exactly: an empty field LEAVES THE STORED KEY
 * ALONE, because the form never renders it back and an operator saving an unrelated
 * setting must not thereby delete their key. Clearing is a separate, explicit act.
 */
export function applyWebSearchForm(
  current: WebSearchSettings,
  form: Record<string, unknown>,
): WebSearchSettings {
  const next = normalizeWebSearchSettings({ ...current, ...form, apiKey: current.apiKey });
  return {
    ...next,
    apiKey: applySecretUpdate(current.apiKey, asText(form['apiKey']), form['clearApiKey'] === 'on'),
  };
}

/** What the console may show about the key: whether there is one, never what it is. */
export function describeWebSearchKey(
  settings: WebSearchSettings,
): ReturnType<typeof describeSecret> {
  return describeSecret(settings.apiKey);
}

/** True when the stored value is a real encrypted secret rather than a blank. */
export function hasWebSearchKey(settings: WebSearchSettings): boolean {
  return isEncrypted(settings.apiKey);
}

/** Only ever called at the moment a request is built. */
export { encryptSecret };
