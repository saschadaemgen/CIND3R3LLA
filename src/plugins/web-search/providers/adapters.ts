/**
 * The shipped search adapters (CCB-S4-037, D-141).
 *
 * ── WHY BRAVE IS THE ONE THAT SHIPS ──────────────────────────────────────────
 *
 * It is an independent index rather than a reseller of somebody else's, it has a free
 * tier an operator can actually start on, and its terms do not require the query or the
 * result to be attached to a user identity. That last part is the one that decided it: a
 * product whose entire premise is a private, consent-first archive on hardware the
 * operator owns should not route its members' questions through an ad-profiling index.
 *
 * It also returns exactly the three fields this briefing needs, title, description and
 * url, and no page body. A provider that offered page bodies would be offering a much
 * larger injection surface for a capability nobody asked for.
 *
 * ── THE SECOND ADAPTER IS NOT DECORATION ─────────────────────────────────────
 *
 * `staticProvider` exists so the seam is PROVEN swappable rather than asserted to be. Every
 * check in `verify:search` drives the whole pipeline through it: the fencing, the budget,
 * the no-action property and the injection defence are all exercised against a provider
 * that returns whatever the check tells it to, with no network and no key. A seam that only
 * ever has one implementation is a seam nobody has tried to use.
 */

import { log } from '../../../log.js';
import {
  SearchProviderError,
  type SearchProvider,
  type SearchResult,
} from './types.js';

/** Shared fetch with a timeout. Deliberately not the price plugin's: different headers. */
async function httpJson(
  url: string,
  opts: { headers: Record<string, string>; timeoutMs: number; fetchImpl?: typeof fetch },
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, {
      headers: { accept: 'application/json', 'user-agent': 'CIND3R3LLA/1.0', ...opts.headers },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export interface BraveOptions {
  apiKey: () => string;
  fetchImpl?: typeof fetch;
}

/**
 * Brave Search.
 *
 * The envelope is `{ web: { results: [{ title, description, url }] } }`. Everything is
 * read defensively and coerced to a string: a provider changing its shape must produce an
 * empty result, never an `undefined` that reaches a prompt as the word "undefined".
 */
export function braveProvider(opts: BraveOptions): SearchProvider {
  return {
    name: 'brave',
    label: 'Brave Search',
    capabilities: {
      requiresKey: true,
      keyUrl: 'https://brave.com/search/api/',
      note:
        'Independent index with a free tier. Queries are not tied to a member identity, ' +
        'which is why this is the one that ships.',
    },
    isConfigured: () => opts.apiKey().trim() !== '',
    async search(query, limit, timeoutMs) {
      const key = opts.apiKey().trim();
      if (!key) throw new SearchProviderError('brave', 'no API key is configured');

      const url =
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}` +
        `&count=${String(Math.max(1, Math.min(limit, 20)))}`;

      let payload: unknown;
      try {
        payload = await httpJson(url, {
          // The key rides in a header and is never logged, never put in the URL, and never
          // rendered back into the console form. See `plugins/secrets.ts`.
          headers: { 'x-subscription-token': key },
          timeoutMs,
          ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
        });
      } catch (error) {
        throw new SearchProviderError(
          'brave',
          error instanceof Error ? error.message : String(error),
        );
      }

      const results = asRecord(asRecord(payload)['web'])['results'];
      if (!Array.isArray(results)) {
        throw new SearchProviderError('brave', 'the response carried no result list');
      }

      return results.slice(0, limit).map((raw): SearchResult => {
        const row = asRecord(raw);
        return {
          title: asText(row['title']),
          snippet: asText(row['description']),
          url: asText(row['url']),
        };
      });
    },
  };
}

/**
 * A provider that returns what it was handed. No network, no key.
 *
 * The harness's provider, and the reason the seam is real. It is exported from the
 * shipped tree rather than defined inside the check on purpose: a double defined in a test
 * file proves the test's idea of the interface, and this one proves the interface.
 */
export function staticProvider(
  results: SearchResult[] | (() => SearchResult[] | never),
  options: { configured?: boolean; label?: string } = {},
): SearchProvider {
  return {
    name: 'static',
    label: options.label ?? 'Static (harness)',
    capabilities: { requiresKey: false, keyUrl: '', note: 'Returns fixed results. Not for production.' },
    isConfigured: () => options.configured !== false,
    search: (_query, limit) =>
      Promise.resolve((typeof results === 'function' ? results() : results).slice(0, limit)),
  };
}

/** Every adapter this build knows how to construct. */
export function buildProvider(
  name: string,
  opts: BraveOptions,
): SearchProvider | undefined {
  if (name === 'brave') return braveProvider(opts);
  log.warn(`Web search: no adapter is registered for provider "${name}".`);
  return undefined;
}
