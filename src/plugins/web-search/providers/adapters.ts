/**
 * The shipped search adapters (CCB-S4-037, D-141).
 *
 * ── TWO PROVIDERS, AND NEITHER IS A DEFAULT ──────────────────────────────────
 *
 * BRAVE is an independent index rather than a reseller of somebody else's, and its terms
 * do not require the query or the result to be attached to a user identity. That is what
 * decided it originally: a product whose entire premise is a private, consent-first
 * archive on hardware the operator owns should not route its members' questions through
 * an ad-profiling index. Its catch is now billing. CCB-S4-037 shipped saying Brave had a
 * free tier an operator could start on; that stopped being true in February 2026 and the
 * sentence is corrected here rather than left to age. Prepaid metered credit, a card
 * required, no spending cap.
 *
 * SERPER (CCB-S4-040) has a free monthly allowance and needs no card, which makes it the
 * one an operator can actually try. Its catch is that it serves scraped search-engine
 * results rather than its own index, which is a legal fragility Brave does not have.
 *
 * Neither is chosen for the operator. The plugin ships off, the selector lists both, and
 * each option states its catch in one line so the choice is made with the trade in view.
 *
 * Both return exactly the three fields this feature needs, title, snippet and url, and no
 * page body. A provider offering page bodies would be offering a much larger injection
 * surface for a capability nobody asked for.
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

/**
 * Shared fetch with a timeout. Deliberately not the price plugin's: different headers.
 *
 * Carries a method and a body because the two shipped providers disagree about both
 * (CCB-S4-040). Brave is a GET with the query in the URL; Serper is a POST with a JSON
 * body. That difference stops here: `SearchProvider` is unchanged, so nothing outside
 * this file knows or cares which verb its provider speaks.
 */
async function httpJson(
  url: string,
  opts: {
    headers: Record<string, string>;
    timeoutMs: number;
    fetchImpl?: typeof fetch;
    method?: 'GET' | 'POST';
    body?: unknown;
  },
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, {
      method: opts.method ?? 'GET',
      headers: {
        accept: 'application/json',
        'user-agent': 'CIND3R3LLA/1.0',
        ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...opts.headers,
      },
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
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
        'Its own independent index, and queries are not tied to a member identity. No free tier since February 2026: prepaid metered credit, a card is required, and there is no spending cap.',
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
 * Serper (CCB-S4-040).
 *
 * ── WHY A SECOND PROVIDER, AND WHY THIS ONE ──────────────────────────────────
 *
 * Brave removed its free tier in February 2026: the former 2000 free monthly queries
 * became 5 dollars of prepaid metered credit, a card is required, there is no spending
 * cap, and the free credit now carries an attribution requirement. For an operator who
 * wants to try the feature without handing over a card and without an uncapped bill,
 * that is a poor first provider. Serper has a free monthly allowance and is the most
 * generous free option available.
 *
 * ── THE CAVEAT IS REAL AND IT BELONGS IN THE CONSOLE ─────────────────────────
 *
 * Serper serves SCRAPED search-engine results rather than its own index. That is a
 * legal fragility Brave does not have, and it is not this file's job to have an opinion
 * about it: it is the operator's choice, so the console states it in one line beside the
 * selector rather than leaving them to research it. Neither provider is a default that
 * happens by accident; the plugin ships off and the operator picks.
 *
 * ── THE API SHAPE, READ FROM THE DOCUMENTATION ───────────────────────────────
 *
 * POST https://google.serper.dev/search
 *   headers: X-API-KEY: <key>, Content-Type: application/json
 *   body:    { "q": "<query>", "num": <count> }
 *   reply:   { "organic": [ { title, link, snippet, position, ... } ], ... }
 *
 * Three differences from Brave, all of them absorbed here: POST rather than GET, the
 * results at a TOP-LEVEL `organic` array rather than under `web.results`, and the URL
 * field called `link` rather than `url` with the summary called `snippet` rather than
 * `description`. The normalised shape handed back is identical, which is the point of
 * the seam.
 *
 * Read defensively for the same reason Brave is: a provider that changes its shape must
 * produce an honest failure or an empty result, never an `undefined` that reaches a
 * prompt as the word "undefined".
 */
export function serperProvider(opts: BraveOptions): SearchProvider {
  return {
    name: 'serper',
    label: 'Serper',
    capabilities: {
      requiresKey: true,
      keyUrl: 'https://serper.dev/',
      note:
        'Free monthly allowance and no card required, which makes it the easier one to try. It serves scraped search-engine results rather than its own index.',
    },
    isConfigured: () => opts.apiKey().trim() !== '',
    async search(query, limit, timeoutMs) {
      const key = opts.apiKey().trim();
      if (!key) throw new SearchProviderError('serper', 'no API key is configured');

      let payload: unknown;
      try {
        payload = await httpJson('https://google.serper.dev/search', {
          // The key rides in a header, never in the URL, and is never logged.
          headers: { 'x-api-key': key },
          method: 'POST',
          body: { q: query, num: Math.max(1, Math.min(limit, 20)) },
          timeoutMs,
          ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
        });
      } catch (error) {
        throw new SearchProviderError(
          'serper',
          error instanceof Error ? error.message : String(error),
        );
      }

      const results = asRecord(payload)['organic'];
      if (!Array.isArray(results)) {
        throw new SearchProviderError('serper', 'the response carried no organic result list');
      }

      return results.slice(0, limit).map((raw): SearchResult => {
        const row = asRecord(raw);
        return {
          title: asText(row['title']),
          snippet: asText(row['snippet']),
          // `link`, not `url`. The one field name a careless port would get wrong, and
          // getting it wrong would produce results whose only checkable field is empty.
          url: asText(row['link']),
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
  if (name === 'serper') return serperProvider(opts);
  log.warn(`Web search: no adapter is registered for provider "${name}".`);
  return undefined;
}
