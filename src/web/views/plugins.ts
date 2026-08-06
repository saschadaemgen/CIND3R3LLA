/**
 * Plugin console (CCB-S3-004 §0).
 *
 * Two surfaces: a list of installed plugins with their on/off switch, and one
 * page per plugin owning its own settings. The list is generated from the
 * registry, so a second plugin appears here with no change to this file beyond
 * its own page.
 *
 * API KEYS ARE WRITE-ONLY. The form shows whether a key is set, never the key.
 * Submitting with the field blank keeps the stored key; clearing is an explicit
 * checkbox. Nothing here ever renders or logs a key value.
 */

import type { FastifyInstance } from 'fastify';
import { html, page, raw, type SafeHtml } from '../html.js';
import type { ViewContext } from '../server.js';
import { WEB_SEARCH_ID } from '../../plugins/web-search/plugin.js';
import { webSearchDiagnostics } from '../../plugins/web-search/service.js';
import {
  SEARCH_PROVIDERS,
  SEARCH_PROVIDER_NOTES,
  describeWebSearchKey,
} from '../../plugins/web-search/settings.js';
import { badge, card, pageHeader } from './ui.js';
import { CRYPTO_PRICES_ID } from '../../plugins/crypto-prices/plugin.js';
import { providerKeyStatus } from '../../plugins/crypto-prices/settings.js';
import { CryptoPriceService, type PinCheck } from '../../plugins/crypto-prices/service.js';
import {
  providerHealth,
  recentFailures,
  type AttemptOutcome,
} from '../../plugins/crypto-prices/attempts.js';
import {
  deleteMapping,
  listMappings,
  updateMapping,
  upsertMapping,
} from '../../db/asset-mappings.js';

const INPUT = 'w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm';

/**
 * The plugin's own state, so a fault does not need SSH to find (CCB-S4-042, D-145).
 *
 * The operator hit this on the day the briefing was written: a plugin that fails says
 * nothing in the console and the journal was the only way to learn why.
 *
 * Content-free, matching the reply-wording log's rule (D-130): THAT a search failed and how,
 * never what anybody asked or what came back. `null` means no service is running rather than
 * "nothing has happened", and the copy says which, because zeroes that are really "unknown"
 * are worse than an honest blank.
 */
function diagnosticsBody(limits: {
  rateLimitWindowSeconds: number;
  rateLimitPerMember: number;
  rateLimitPerChat: number;
}): SafeHtml {
  const d = webSearchDiagnostics();
  if (!d) {
    return html`<p class="text-sm text-slate-600">
      No search service is running in this process, so there is nothing to report. This is what
      the page shows before the bot has started, not a fault.
    </p>`;
  }

  return html`
    <dl class="grid gap-3 text-sm sm:grid-cols-2">
      <div>
        <dt class="font-medium text-slate-700">Searches since restart</dt>
        <dd class="text-slate-600">${String(d.searches)} reached a provider</dd>
      </div>
      <div>
        <dt class="font-medium text-slate-700">Inside the rate-limit window</dt>
        <dd class="text-slate-600">
          ${String(d.inWindow)} in the last ${String(limits.rateLimitWindowSeconds)} seconds. The
          budget is ${String(limits.rateLimitPerMember)} per member and
          ${String(limits.rateLimitPerChat)} per chat over that window.
        </dd>
      </div>
      <div>
        <dt class="font-medium text-slate-700">Refused before searching</dt>
        <dd class="text-slate-600">
          ${String(d.refusedBeforeSearch)} never reached a provider${d.lastRefusal
            ? html`, last one ${d.lastRefusal.category} at ${d.lastRefusal.at}`
            : ''}
        </dd>
      </div>
      <div>
        <dt class="font-medium text-slate-700">Last failure</dt>
        <dd class="text-slate-600">
          ${d.lastFailure
            ? html`<span class="font-medium">${d.lastFailure.failure}</span> from
                ${d.lastFailure.provider} at ${d.lastFailure.at}
                <span class="block text-slate-500">${d.lastFailure.detail}</span>`
            : 'none since the last restart'}
        </dd>
      </div>
    </dl>
    <p class="mt-3 text-xs text-slate-500">
      Content-free by construction: no query text, no result text, no member. "Not configured" is
      deliberately not counted as a failure, because choosing not to enter a key is a choice
      rather than a fault.
    </p>
  `;
}

function text(name: string, value: string, placeholder = ''): SafeHtml {
  return html`<input
    name="${name}"
    value="${value}"
    placeholder="${placeholder}"
    class="${INPUT}"
  />`;
}
function number(name: string, value: number, min: number, max: number): SafeHtml {
  return html`<input
    name="${name}"
    type="number"
    min="${String(min)}"
    max="${String(max)}"
    value="${String(value)}"
    class="${INPUT} sm:w-40"
  />`;
}
function check(name: string, label: string, checked: boolean): SafeHtml {
  return html`<label class="flex items-center gap-2 text-sm">
    <input type="checkbox" name="${name}" ${checked ? raw('checked') : ''} class="rounded" />
    ${label}
  </label>`;
}
function field(label: string, control: SafeHtml, help?: string): SafeHtml {
  return html`<label class="flex flex-col gap-1 text-sm">
    <span class="font-medium text-slate-700">${label}</span>
    ${control} ${help ? html`<span class="text-xs text-slate-500">${help}</span>` : null}
  </label>`;
}
function save(label = 'Save'): SafeHtml {
  return html`<button
    type="submit"
    class="self-start rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
  >
    ${label}
  </button>`;
}

export function registerPlugins(app: FastifyInstance, ctx: ViewContext): void {
  const { plugins, db } = ctx;

  /* ── The plugin list ─────────────────────────────────────────────────── */

  app.get<{ Querystring: { saved?: string; error?: string } }>('/plugins', async (req, reply) => {
    const csrf = req.session?.csrfToken ?? '';
    const list = plugins.list();

    const body = html`
      ${pageHeader('Plugins', 'Capabilities beyond the archive itself')}
      ${
        req.query.saved
          ? html`<div
              class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
            >
              Saved.
            </div>`
          : null
      }
      <div
        class="mb-6 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-700"
      >
        <p class="font-semibold">A disabled plugin is not merely idle.</p>
        <p class="mt-1">
          Switching a plugin off removes the intents it contributes from the catalog entirely.
          CIND3R3LLA stops understanding those questions rather than understanding them and
          declining, so nothing half-wired can run behind a switch that is off.
        </p>
      </div>
      <div class="flex flex-col gap-4">
        ${list.map(
          (p) => html`
            <section class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 class="text-sm font-semibold">
                    <a class="hover:underline" href="${p.adminPath}">${p.name}</a>
                    <span class="ml-2 text-xs font-normal text-slate-400">v${p.version}</span>
                  </h2>
                  <p class="mt-1 max-w-2xl text-sm text-slate-500">${p.description}</p>
                </div>
                <form method="post" action="/plugins/${p.id}/toggle" class="shrink-0">
                  <input type="hidden" name="_csrf" value="${csrf}" />
                  <input type="hidden" name="enabled" value="${p.enabled ? 'off' : 'on'}" />
                  <button
                    type="submit"
                    class="rounded-lg px-3 py-1.5 text-sm font-medium ${
                      p.enabled
                        ? 'border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        : 'border border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100'
                    }"
                  >
                    ${p.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
                  </button>
                </form>
              </div>
              <p class="mt-3 text-xs text-slate-400">
                Settings: <a class="underline" href="${p.adminPath}">${p.adminPath}</a>
              </p>
            </section>
          `,
        )}
      </div>
    `;
    reply.type('text/html');
    return page({ title: 'Plugins', active: 'plugins', csrfToken: csrf, body });
  });

  app.post<{ Params: { id: string } }>('/plugins/:id/toggle', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const enabled = body['enabled'] === 'on';
    try {
      await plugins.setEnabled(req.params.id, enabled, req.session?.username ?? 'unknown');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not change the plugin.';
      return reply.redirect(`/plugins?error=${encodeURIComponent(message)}`);
    }
    return reply.redirect('/plugins?saved=1');
  });

  /* ── Crypto Prices ───────────────────────────────────────────────────── */

  app.get<{ Querystring: { saved?: string; error?: string; pins?: string } }>(
    '/plugins/crypto-prices',
    async (req, reply) => {
      const csrf = req.session?.csrfToken ?? '';
      const s = plugins.getCryptoPrices();
      const enabled = plugins.isEnabled(CRYPTO_PRICES_ID);
      const mappings = await listMappings(db, 100);
      const service = new CryptoPriceService({ db, settings: () => s });
      const status = service.providerStatus();
      // Only run the pin check when the operator asked for it — it walks every
      // mapping, and this page is otherwise cheap.
      const pinChecks: PinCheck[] | null = req.query.pins ? await service.checkPins() : null;

      const form = (section: string, inner: SafeHtml): SafeHtml =>
        html`<form method="post" action="/plugins/crypto-prices" class="flex flex-col gap-3">
          <input type="hidden" name="_csrf" value="${csrf}" />
          <input type="hidden" name="section" value="${section}" />
          ${inner}
        </form>`;

      const statusCard = card(
        'Status',
        html`<p class="mb-3 text-sm ${enabled ? 'text-emerald-700' : 'text-amber-700'}">
            ${
              enabled
                ? 'Enabled — price questions are understood.'
                : 'Disabled — price questions are not in the intent catalog at all.'
            }
          </p>
          <div class="overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead>
                <tr
                  class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500"
                >
                  <th class="py-2 pr-3">Provider</th>
                  <th class="py-2 pr-3">Usable</th>
                  <th class="py-2 pr-3">Last result</th>
                  <th class="py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                ${status.map(
                  (p) =>
                    html`<tr class="border-b border-slate-100 align-top">
                      <td class="py-2 pr-3 font-medium">${p.label}</td>
                      <td class="py-2 pr-3">${p.configured ? 'yes' : 'no'}</td>
                      <td class="py-2 pr-3 text-slate-500">
                        ${p.health ? `${p.health.ok ? 'ok' : 'error'} — ${p.health.detail}` : '—'}
                      </td>
                      <td class="py-2 text-xs text-slate-500">${p.note}</td>
                    </tr>`,
                )}
              </tbody>
            </table>
          </div>`,
      );

      const chainCard = card(
        'Provider chain',
        html`<p class="mb-3 text-sm text-slate-500">
            Tried in this order. A provider that errors, times out, is rate-limited, or does not
            know the asset is skipped and the next one is asked. A provider with no key, where one
            is required, skips itself.
          </p>
          <div
            class="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          >
            <p class="font-semibold">
              Licence notes, checked against the providers' current terms.
            </p>
            <p class="mt-1">
              <strong>CoinGecko</strong> requires the credit "Powered by CoinGecko" wherever its
              data is shown; CIND3R3LLA appends it to replies it served. Its terms also require
              cached data to be refreshed at least daily, which the cache enforces.
              <strong>CoinMarketCap</strong> requires "Data provided by CoinMarketCap.com", and its
              free tier is licensed for personal use — showing its data to a group may need a paid
              plan. Check your plan before enabling it. <strong>Dexscreener</strong> requires no
              attribution.
            </p>
          </div>
          ${form(
            'chain',
            html`
              ${field(
                'Order',
                text('chain', s.chain.join(', ')),
                'Comma separated. Any provider left out is still available, just last.',
              )}
              ${s.chain.map((name) => {
                const p = s.providers[name];
                if (!p) return null;
                const key = providerKeyStatus(s, name);
                return html`<div class="rounded-lg border border-slate-200 p-3">
                  <div class="mb-2 text-sm font-semibold">${name}</div>
                  ${check(`providers.${name}.enabled`, 'Enabled', p.enabled)}
                  <div class="mt-2 grid gap-2 sm:grid-cols-2">
                    ${field(
                      'API key',
                      html`<input
                        name="providers.${name}.apiKeyInput"
                        type="password"
                        value=""
                        autocomplete="off"
                        placeholder="${key.undecryptable ? 'A key is stored but cannot be decrypted' : key.set ? 'A key is stored, leave blank to keep it' : 'No key stored'}"
                        class="${INPUT}"
                      />`,
                      key.undecryptable
                        ? 'A key IS stored but cannot be decrypted (was SESSION_SECRET rotated?). Re-enter it, or clear it.'
                        : key.set
                          ? 'A key is stored and is never shown again. Leave blank to keep it.'
                          : 'Blank means no key. Stored encrypted; never displayed or logged.',
                    )}
                    ${field('Timeout (ms)', number(`providers.${name}.timeoutMs`, p.timeoutMs, 1000, 30000))}
                    ${field(
                      'Requests per minute',
                      number(`providers.${name}.rateLimitPerMinute`, p.rateLimitPerMinute, 1, 600),
                    )}
                    <div class="flex items-end">
                      ${check(`providers.${name}.clearApiKey`, 'Remove the stored key', false)}
                    </div>
                  </div>
                </div>`;
              })}
              ${save()}
            `,
          )}`,
      );

      const behaviourCard = card(
        'Answering',
        form(
          'behaviour',
          html`
            ${field(
              'Default quote currency',
              text('baseCurrency', s.baseCurrency),
              'Prices default to this, and asset-to-asset conversions are crossed through it.',
            )}
            ${field(
              'Price cache lifetime (seconds)',
              number('cacheTtlSeconds', s.cacheTtlSeconds, 5, 3600),
              'How long a quote is reused. Prices are always fetched on request; this only stops a busy group burning the provider quota.',
            )}
            ${field(
              'Price questions per member, per minute',
              number('rateLimitPerMember', s.rateLimitPerMember, 1, 120),
            )}
            ${field(
              'Price questions per chat, per minute',
              number('rateLimitPerChat', s.rateLimitPerChat, 1, 600),
            )}
            ${field(
              'Disclaimer (optional, off by default)',
              text('disclaimer', s.disclaimer, 'Market data for information only.'),
              'Appended to every price reply. Empty means none.',
            )}
            ${save()}
          `,
        ),
      );

      const mappingCard = card(
        'Pinned assets',
        html`<p class="mb-3 text-sm text-slate-500">
            A symbol is resolved once and then pinned here, so the same question always means the
            same asset. Deleting a row makes the next question resolve it again.
            <strong>Locked</strong> rows are never touched by automatic resolution, which is how a
            contested ticker stays pinned to the asset you chose.
          </p>
          <div class="mb-4 overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead>
                <tr
                  class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500"
                >
                  <th class="py-2 pr-3">Symbol</th>
                  <th class="py-2 pr-3">Asset</th>
                  <th class="py-2 pr-3">Chain / contract</th>
                  <th class="py-2 pr-3">Provider ids</th>
                  <th class="py-2 pr-3">Source</th>
                  <th class="py-2"></th>
                </tr>
              </thead>
              <tbody>
                ${
                  mappings.length === 0
                    ? html`<tr>
                        <td colspan="6" class="py-3 text-sm text-slate-500">
                          Nothing pinned yet. The first time someone asks about a symbol it is
                          resolved and recorded here.
                        </td>
                      </tr>`
                    : mappings.map(
                        (m) =>
                          html`<tr class="border-b border-slate-100 align-top">
                            <td class="py-2 pr-3 font-medium">
                              ${m.symbol}${m.locked ? html` <span class="text-xs text-amber-700">locked</span>` : null}
                            </td>
                            <td class="py-2 pr-3">${m.displayName}</td>
                            <td class="py-2 pr-3 break-all text-xs text-slate-500">
                              ${m.chain ?? '—'}${m.contract ? html`<br />${m.contract}` : null}
                            </td>
                            <td class="py-2 pr-3 text-xs text-slate-500">
                              ${
                              Object.entries(m.providerIds)
                                .map(([k, v]) => `${k}=${v}`)
                                .join(', ') || '—'
                            }
                            </td>
                            <td class="py-2 pr-3 text-xs text-slate-500">${m.source}</td>
                            <td class="py-2">
                              <div class="flex gap-2">
                                <form method="post" action="/plugins/crypto-prices">
                                  <input type="hidden" name="_csrf" value="${csrf}" />
                                  <input type="hidden" name="section" value="mapping-lock" />
                                  <input type="hidden" name="id" value="${String(m.id)}" />
                                  <input
                                    type="hidden"
                                    name="locked"
                                    value="${m.locked ? 'off' : 'on'}"
                                  />
                                  <button
                                    class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
                                  >
                                    ${m.locked ? 'Unlock' : 'Lock'}
                                  </button>
                                </form>
                                <form method="post" action="/plugins/crypto-prices">
                                  <input type="hidden" name="_csrf" value="${csrf}" />
                                  <input type="hidden" name="section" value="mapping-delete" />
                                  <input type="hidden" name="id" value="${String(m.id)}" />
                                  <button
                                    class="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                                  >
                                    Delete
                                  </button>
                                </form>
                              </div>
                            </td>
                          </tr>`,
                      )
                }
              </tbody>
            </table>
          </div>
          ${form(
            'mapping-add',
            html`
              <div class="text-sm font-semibold">Add or override a mapping</div>
              <div class="grid gap-2 sm:grid-cols-2">
                ${field('Symbol', text('symbol', '', 'HEX'))}
                ${field('Display name', text('displayName', '', 'HEX'))}
                ${field('Chain', text('chain', '', 'ethereum'))}
                ${field('Contract', text('contract', '', '0x…'))}
                ${field(
                  'Provider ids',
                  text('providerIds', '', 'coingecko=hex, coinmarketcap=5015'),
                  'Comma separated name=id pairs. Dexscreener needs no id, only chain and contract.',
                )}
                ${field('Decimals', number('decimals', 8, 0, 18))}
              </div>
              ${check('locked', 'Lock this mapping (automatic resolution will never change it)', true)}
              ${save('Add mapping')}
            `,
          )}`,
      );

      /* ── Provider health and recent failures (CCB-S3-008 §3) ──────────── */

      const ago = (at: number | undefined): string => {
        if (at === undefined) return 'never';
        const secs = Math.max(0, Math.round((Date.now() - at) / 1000));
        if (secs < 60) return `${secs}s ago`;
        if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
        return `${Math.round(secs / 3600)}h ago`;
      };
      // Said in the operator's terms, not the wire's. "Rejected the key" is the
      // one an operator can actually act on, and it used to be invisible.
      const OUTCOME_LABEL: Record<AttemptOutcome, string> = {
        ok: 'answered',
        'not-found': 'does not know it',
        unauthorized: 'rejected the key',
        throttled: 'throttled us',
        'skipped-rate-limit': 'skipped — our own limit',
        'skipped-no-id': 'skipped — no id for this pin',
        unreachable: 'unreachable',
        'bad-response': 'unusable answer',
      };

      const health = providerHealth(s.chain);
      const failures = recentFailures(15);

      const healthCard = card(
        'Provider health',
        html`<p class="mb-3 text-sm text-slate-600">
            What each provider in the chain has actually done, this run. A provider
            that keeps rejecting the key is a settings problem, not a quiet market —
            the difference used to be invisible from both sides.
          </p>
          <div class="overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead class="text-xs uppercase text-slate-500">
                <tr>
                  <th class="py-1 pr-4">Provider</th>
                  <th class="py-1 pr-4">Last success</th>
                  <th class="py-1 pr-4">Last failure</th>
                  <th class="py-1 pr-4">Cause</th>
                  <th class="py-1">Attempts</th>
                </tr>
              </thead>
              <tbody>
                ${health.map(
                  (h) => html`<tr class="border-t border-slate-100">
                    <td class="py-1 pr-4 font-medium">${h.provider}</td>
                    <td class="py-1 pr-4 ${h.lastOk ? 'text-emerald-700' : 'text-slate-400'}">
                      ${ago(h.lastOk)}
                    </td>
                    <td class="py-1 pr-4 ${h.lastFail ? 'text-red-700' : 'text-slate-400'}">
                      ${ago(h.lastFail)}
                    </td>
                    <td class="py-1 pr-4 text-slate-600">
                      ${h.lastFailOutcome ? OUTCOME_LABEL[h.lastFailOutcome] : '—'}
                    </td>
                    <td class="py-1 text-slate-500">${String(h.ok)} / ${String(h.attempts)}</td>
                  </tr>`,
                )}
              </tbody>
            </table>
          </div>
          ${
            failures.length === 0
              ? html`<p class="mt-3 text-sm text-slate-500">No failures recorded this run.</p>`
              : html`<div class="mt-4">
                  <div class="mb-1 text-xs uppercase text-slate-500">Recent failures</div>
                  <ul class="flex flex-col gap-1 text-sm">
                    ${failures.map(
                      (f) => html`<li class="flex flex-wrap gap-x-2 text-slate-600">
                        <span class="text-slate-400">${ago(f.at)}</span>
                        <span class="font-medium">${f.provider}</span>
                        <span>${f.op}</span>
                        <span class="font-mono">${f.symbol}</span>
                        <span class="text-red-700">${OUTCOME_LABEL[f.outcome]}</span>
                        ${f.status ? html`<span class="text-slate-400">HTTP ${String(f.status)}</span>` : null}
                      </li>`,
                    )}
                  </ul>
                </div>`
          }
          ${form(
            'checkpins',
            html`<button
              type="submit"
              class="self-start rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
            >
              Check every pinned asset
            </button>`,
          )}
          ${
            pinChecks === null
              ? html`<p class="mt-2 text-xs text-slate-500">
                  Verifies that each pin can be served by an enabled provider. A pin that cannot is
                  worse than no pin: it fails every lookup, silently.
                </p>`
              : pinChecks.filter((c) => !c.ok).length === 0
                ? html`<p class="mt-2 text-sm text-emerald-700">
                    All ${String(pinChecks.length)} pinned asset(s) can be served.
                  </p>`
                : html`<ul class="mt-2 flex flex-col gap-1 text-sm text-red-700">
                    ${pinChecks
                      .filter((c) => !c.ok)
                      .map(
                        (c) => html`<li>
                          <span class="font-mono">${c.symbol}</span> — ${c.displayName}: ${c.reason}
                        </li>`,
                      )}
                  </ul>`
          }`,
      );

      const body = html`
        ${pageHeader('Crypto Prices', 'Market data, pinned to the assets you actually mean')}
        ${
          req.query.saved
            ? html`<div
                class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
              >
                Saved.
              </div>`
            : req.query.error
              ? html`<div
                  class="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  ${req.query.error}
                </div>`
              : null
        }
        <div class="flex flex-col gap-6">
          ${statusCard} ${chainCard} ${healthCard} ${behaviourCard} ${mappingCard}
        </div>
      `;
      reply.type('text/html');
      return page({
        title: 'Crypto Prices',
        active: `plugin:${CRYPTO_PRICES_ID}`,
        csrfToken: csrf,
        body,
      });
    },
  );

  app.post('/plugins/crypto-prices', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const section = typeof body['section'] === 'string' ? body['section'] : '';
    const actor = req.session?.username ?? 'unknown';
    const str = (k: string): string => (typeof body[k] === 'string' ? body[k] : '');

    try {
      if (section === 'checkpins') {
        return reply.redirect('/plugins/crypto-prices?pins=1');
      } else if (section === 'chain') {
        const current = plugins.getCryptoPrices();
        const providers: Record<string, unknown> = {};
        for (const name of Object.keys(current.providers)) {
          providers[name] = {
            enabled: `providers.${name}.enabled` in body,
            // The typed key travels as `apiKeyInput`; `apiKey` is reserved for the
            // stored envelope, so a form post can never be mistaken for storage
            // being loaded back (CCB-S3-008 §2).
            apiKeyInput: str(`providers.${name}.apiKeyInput`),
            clearApiKey: `providers.${name}.clearApiKey` in body,
            timeoutMs: str(`providers.${name}.timeoutMs`),
            rateLimitPerMinute: str(`providers.${name}.rateLimitPerMinute`),
          };
        }
        await plugins.saveCryptoPrices({ chain: str('chain'), providers }, actor);
      } else if (section === 'behaviour') {
        await plugins.saveCryptoPrices(
          {
            baseCurrency: str('baseCurrency'),
            cacheTtlSeconds: str('cacheTtlSeconds'),
            rateLimitPerMember: str('rateLimitPerMember'),
            rateLimitPerChat: str('rateLimitPerChat'),
            disclaimer: str('disclaimer'),
          },
          actor,
        );
      } else if (section === 'mapping-add') {
        const ids: Record<string, string> = {};
        for (const pair of str('providerIds').split(',')) {
          const [k, v] = pair.split('=').map((x) => x.trim());
          if (k && v) ids[k.toLowerCase()] = v;
        }
        const symbol = str('symbol').trim();
        if (!symbol) throw new Error('A symbol is required.');
        await upsertMapping(db, {
          symbol,
          displayName: str('displayName').trim() || symbol.toUpperCase(),
          chain: str('chain').trim() || null,
          contract: str('contract').trim() || null,
          decimals: Number.parseInt(str('decimals'), 10) || 8,
          providerIds: ids,
          source: 'manual',
          locked: 'locked' in body,
        });
      } else if (section === 'mapping-delete') {
        await deleteMapping(db, Number.parseInt(str('id'), 10));
      } else if (section === 'mapping-lock') {
        await updateMapping(db, Number.parseInt(str('id'), 10), { locked: str('locked') === 'on' });
      } else {
        return reply.redirect(
          `/plugins/crypto-prices?error=${encodeURIComponent('Unknown section.')}`,
        );
      }
      return reply.redirect('/plugins/crypto-prices?saved=1');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save.';
      return reply.redirect(`/plugins/crypto-prices?error=${encodeURIComponent(message)}`);
    }
  });

  /* ── Web Search (CCB-S4-037, D-141) ───────────────────────────────────── */

  app.get<{ Querystring: { saved?: string; error?: string } }>(
    '/plugins/web-search',
    async (req, reply) => {
      const csrf = req.session?.csrfToken ?? '';
      const cfg = ctx.plugins.getWebSearch();
      const key = describeWebSearchKey(cfg);
      const enabled = ctx.plugins.isEnabled(WEB_SEARCH_ID);
      reply.type('text/html');

      return page({
        title: 'Web Search',
        active: 'plugins',
        csrfToken: csrf,
        body: html`
          ${pageHeader(
            'Web Search',
            'Looks a question up on the web and lets her answer from what it found, with the sources named.',
          )}

          ${card(
            'What this actually does, and what it costs',
            html`<p class="text-sm text-slate-600">
                When a member <strong>explicitly asks her to look something up</strong>, she
                queries the provider below, reads the results, and answers from them. The source
                line is written by the application rather than by the model, so she cannot cite a
                page she was not given, and it names <strong>only the results the answer actually
                used</strong>: a refusal cites nothing at all.
              </p>
              <p class="mt-3 text-sm text-slate-600">
                <strong>Search results are treated as hostile input.</strong> They are text
                written by strangers, and a page can contain an instruction aimed at her. They
                reach the model as clearly fenced quoted material, never as part of her
                instructions, and she is told plainly to obey nothing inside the fence. They
                also cannot cause anything: a result can change no consent record, trigger no
                command, reach no moderation ladder, and cause no message to anybody but the
                person who asked.
              </p>
              <p class="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <strong>This makes outbound requests and may cost money.</strong> That is why it
                ships off. While it is off, the lookup intent is absent from her vocabulary
                entirely, so nothing can reach a search even by accident.
              </p>`,
          )}

          <div class="mt-4">
            ${card(
              'What she will not search for, before the query is sent',
              html`<p class="text-sm text-slate-600">
                  A request she would refuse <strong>never reaches the provider</strong>. Until
                  CCB-S4-042 the only thing that could refuse was the model, and the model does not
                  see the request until after the search has run: she said
                  <em>"Not happening."</em> and the next message read
                  <em>"From the web: xnxx.com, pornhub.com, ..."</em> because the source line was
                  attached to the search rather than to the answer. Both halves are fixed.
                </p>
                <p class="mt-3 text-sm text-slate-600">Four categories are refused outright:</p>
                <ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
                  <li><strong>Sexual material</strong> named as such, and the sites themselves.</li>
                  <li><strong>Child safety</strong> terms. Refused first and hardest.</li>
                  <li><strong>Darknet</strong> addresses: a <code>.onion</code> in a search request
                    is asking for an address, not for a topic.</li>
                  <li><strong>Illegal goods</strong>, as an intent word plus a subject word, so
                    "buy cocaine online" is refused and "the history of drug policy" is not.</li>
                </ul>
                <p class="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <strong>It is a term list, and a term list has limits.</strong> It misses
                  paraphrase, it covers English and German only, and it will occasionally refuse a
                  legitimate question that happens to use a screened word. It is a floor under the
                  model's own refusal, not a replacement for it. There is deliberately
                  <strong>no setting</strong> here: a threshold an operator could lower is a
                  threshold that ends with the domains back in the group, and the categories are
                  not a matter of taste. Changing them is a code change and a review.
                </p>`,
            )}
          </div>

          <div class="mt-4">
            ${card(
              'What the source line contains',
              html`<p class="text-sm text-slate-600">
                  <code>🔎 From the web: example.org [1](https://example.org/the/page), ...</code>
                </p>
                <p class="mt-3 text-sm text-slate-600">
                  The <strong>domain</strong> is the part you read to judge whether to trust the
                  answer. The <strong>numbered link</strong> carries the full URL, so the page is
                  actually reachable. A member asked for exactly this: the line used to print hosts
                  only, which looked clickable and landed on a homepage.
                </p>
                <p class="mt-3 text-sm text-slate-600">
                  The number rather than the domain is the visible link text because SimpleX
                  requires it: measured against the shipped 6.5.4 parser, a dot inside the display
                  text makes the <em>entire message</em> render as literal brackets. It is written
                  by the application, never by the model, and it lists
                  <strong>only the results the answer actually used</strong>. A refusal cites
                  nothing, and if the model declares nothing the line is omitted rather than
                  guessed at.
                </p>`,
            )}
          </div>

          <div class="mt-4">
            ${card(
              'Diagnostics',
              diagnosticsBody(cfg),
            )}
          </div>

          <div class="mt-4">
            ${card(
              'When she searches',
              html`<p class="text-sm text-slate-600">
                  Only on an <strong>explicit request</strong>: "look up ...", "search the web
                  for ...", "google ...", "can you look up ...", and their German equivalents.
                  The trigger is a deterministic rule, not a judgement the model makes, so you
                  can read it and a check can prove it.
                </p>
                <p class="mt-3 text-sm text-slate-600">
                  There is deliberately <strong>no</strong> "this sounds like it wants current
                  information" heuristic. A false positive there is not a clumsy answer, it is an
                  outbound request and a stranger's text entering her prompt. "I wonder what the
                  weather is doing" gets a conversation, not a search.
                </p>`,
            )}
          </div>

          <div class="mt-4">
            ${card(
              enabled ? 'Settings' : 'Settings (the plugin is off)',
              html`<form method="post" action="/plugins/web-search" class="flex flex-col gap-4">
                <input type="hidden" name="_csrf" value="${csrf}" />

                <div class="flex flex-wrap items-center gap-3">
                  ${enabled ? badge('enabled', 'green') : badge('off', 'slate')}
                  ${key.set
                    ? badge('key set', 'green')
                    : badge('no key, so she cannot search', 'amber')}
                  <a class="text-sm underline" href="/plugins">Turn it on or off on the plugin list</a>
                </div>

                ${field(
                  'Provider',
                  html`<select
                    name="provider"
                    class="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  >
                    ${SEARCH_PROVIDERS.map(
                      (name) =>
                        html`<option value="${name}" ${name === cfg.provider ? raw('selected') : ''}>
                          ${name}
                        </option>`,
                    )}
                  </select>`,
                  SEARCH_PROVIDERS.map((name) => `${name}: ${SEARCH_PROVIDER_NOTES[name]}`).join(' '),
                )}

                ${field(
                  'API key',
                  html`<input
                    name="apiKey"
                    type="password"
                    autocomplete="off"
                    placeholder="${key.set ? 'stored, leave blank to keep it' : 'not set'}"
                    class="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  />`,
                  'Encrypted at rest and never shown again. Leaving this blank keeps the stored key; clearing it is the separate checkbox below.',
                )}
                ${check('clearApiKey', 'Delete the stored key', false)}

                <div class="grid gap-4 sm:grid-cols-2">
                  ${field('Results per search', number('maxResults', cfg.maxResults, 1, 10))}
                  ${field('Timeout (ms)', number('timeoutMs', cfg.timeoutMs, 1000, 20000))}
                  ${field(
                    'Characters per result',
                    number('perResultChars', cfg.perResultChars, 80, 1200),
                  )}
                  ${field(
                    'Characters in total',
                    number('totalChars', cfg.totalChars, 200, 6000),
                  )}
                </div>
                <p class="text-xs text-slate-500">
                  Those two are a <strong>safety control, not a quality knob</strong>. They are
                  the amount of untrusted text that reaches the model: enough for real snippets,
                  and nowhere near enough to crowd her own instructions out of the context.
                </p>

                <div class="grid gap-4 sm:grid-cols-3">
                  ${field(
                    'Searches per member',
                    number('rateLimitPerMember', cfg.rateLimitPerMember, 0, 1000),
                  )}
                  ${field(
                    'Searches per chat',
                    number('rateLimitPerChat', cfg.rateLimitPerChat, 0, 5000),
                  )}
                  ${field(
                    'Window (seconds)',
                    number('rateLimitWindowSeconds', cfg.rateLimitWindowSeconds, 30, 86400),
                  )}
                </div>
                <p class="text-xs text-slate-500">
                  Past the limit she says she could not look it up. She never falls back to
                  answering from memory and presenting it as current.
                </p>

                ${save()}
              </form>`,
            )}
          </div>
        `,
      });
    },
  );

  app.post<{ Body: Record<string, unknown> }>('/plugins/web-search', async (req, reply) => {
    try {
      await ctx.plugins.saveWebSearch(req.body, req.session?.username ?? 'unknown');
      return reply.redirect('/plugins/web-search?saved=1');
    } catch (error) {
      return reply.redirect(
        '/plugins/web-search?error=' +
          encodeURIComponent(error instanceof Error ? error.message : String(error)),
      );
    }
  });
}
