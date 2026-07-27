/**
 * The screening console (CCB-S3-012 §4).
 *
 * Two cards: provider health in the style of the price-provider panel, and
 * quarantined items BY REFERENCE ONLY.
 *
 * THE HARD RULE OF THIS PAGE: it never renders, embeds, previews, thumbnails or
 * links to quarantined content. Not the text, not the media, not a filename. An
 * operator may not analyse suspect material, so the console must not put it in
 * front of them, and "just a thumbnail" is exactly the thing being forbidden.
 * What it shows is a message id, a timestamp, a provider and a state, which is
 * everything needed to hand a reference to a lawyer and nothing more.
 *
 * That is why this is a separate page from Evidence holds, which DOES show a text
 * preview: an ordinary report hold is content an operator is expected to review,
 * and a quarantine is content they must not.
 */

import type { FastifyInstance } from 'fastify';

import { describeMediaEncryption } from '../../media/at-rest.js';
import {
  activeScreeningProvider,
  recentScreeningAttempts,
  screeningHealth,
} from '../../screening/service.js';
import { html, page } from '../html.js';
import type { ViewContext } from '../server.js';
import { badge, card, fmtDate, pageHeader } from './ui.js';

function ago(at: number | null): string {
  if (at === null) return 'never';
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `${String(s)}s ago`;
  if (s < 3600) return `${String(Math.round(s / 60))}m ago`;
  return `${String(Math.round(s / 3600))}h ago`;
}

export function registerScreening(app: FastifyInstance, ctx: ViewContext): void {
  app.get('/screening', async (req, reply) => {
    const csrf = req.session?.csrfToken ?? '';
    const provider = activeScreeningProvider();
    const health = screeningHealth(provider);
    const encryption = describeMediaEncryption();

    const { rows: quarantined } = await ctx.db.query<{
      message_id: string;
      created_at: string;
      state: string;
      source: string;
      sender: string | null;
    }>(
      `SELECT h.message_id, h.created_at, h.state, h.source, m.sender_member_id AS sender
       FROM evidence_holds h
       LEFT JOIN messages m ON m.id = h.message_id
       WHERE h.state IN ('active', 'escalated')
         AND (h.source = 'csam' OR h.state = 'escalated')
       ORDER BY h.created_at DESC`,
    );

    const attempts = recentScreeningAttempts(25);

    const body = html`
      ${pageHeader(
        'Screening and custody',
        'Automated comparison against hashes of known material. No human review, no general-purpose analysis, no preview of quarantined items.',
      )}

      <div class="flex flex-col gap-6">
        ${card(
          'What this can and cannot do',
          html`<div class="flex flex-col gap-2 text-sm text-slate-600">
            <p>
              Hash screening detects <strong>known</strong> material by comparing against a list of
              hashes. It does <strong>not</strong> detect new or previously unseen material, and a
              result of "no match" means only "not on the list". It is not a guarantee, and nothing
              in this product presents it as one.
            </p>
            <p>
              A match is a signal, not evidence. The correct response is to preserve and report
              through your legal process, never to delete: destroying a match destroys what makes a
              prosecution possible. Quarantined items are therefore held, not removed, and cannot be
              deleted by any path in this system.
            </p>
            <p class="text-red-700">
              Do not open, download or examine a quarantined item. Hand the reference to your
              lawyer.
            </p>
          </div>`,
        )}
        ${card(
          'Provider',
          html`<div class="overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th class="py-2">Provider</th>
                  <th class="py-2">Configured</th>
                  <th class="py-2">Transmits content</th>
                  <th class="py-2">Screened</th>
                  <th class="py-2">Matches</th>
                  <th class="py-2">Errors</th>
                  <th class="py-2">Last activity</th>
                </tr>
              </thead>
              <tbody>
                <tr class="border-b border-slate-100 align-top">
                  <td class="py-2 font-medium">${health.label}</td>
                  <td class="py-2">
                    ${health.configured ? badge('yes', 'green') : badge('no', 'slate')}
                  </td>
                  <td class="py-2">
                    ${health.transmitsContent
                      ? badge('yes', 'amber')
                      : badge('nothing leaves the host', 'green')}
                  </td>
                  <td class="py-2">${String(health.screened)}</td>
                  <td class="py-2">
                    ${health.matches > 0
                      ? badge(String(health.matches), 'red')
                      : html`<span class="text-slate-400">0</span>`}
                  </td>
                  <td class="py-2">
                    ${health.errors > 0
                      ? html`<span class="text-red-700">${String(health.errors)}</span>`
                      : html`<span class="text-slate-400">0</span>`}
                  </td>
                  <td class="py-2 text-slate-500">${ago(health.lastAt)}</td>
                </tr>
              </tbody>
            </table>
            ${health.lastError
              ? html`<p class="mt-2 text-sm text-red-700">Last error: ${health.lastError}</p>`
              : ''}
            <p class="mt-3 text-sm text-slate-600">
              ${provider.name === 'none'
                ? 'No screening provider is configured. Nothing is transmitted anywhere, and every item is recorded as "not screened". This is the shipped default.'
                : 'A provider is active. Screening runs at receipt on every image, independent of consent.'}
            </p>
          </div>`,
        )}
        ${card(
          'Originals at rest',
          html`<div class="flex flex-col gap-2 text-sm text-slate-600">
            <p>
              ${encryption.configured
                ? html`Originals are encrypted at rest with ${encryption.algo}. ${badge('on', 'green')}`
                : html`Originals are stored unencrypted. ${badge('off', 'amber')} Set
                  <code>MEDIA_SECRET</code> to enable encryption.`}
            </p>
            <p>
              Every original is encrypted, not only suspect material, so that a file's encryption
              status reveals nothing about whether it is under suspicion. The published, stripped
              derivative stays unencrypted: it is public by definition.
            </p>
            ${encryption.configured
              ? html`<p class="text-amber-700">
                  The key is not stored with the media. Back up <code>MEDIA_SECRET</code> separately
                  from the media backups: a restore without it yields unreadable bytes, and there is
                  no key history.
                </p>`
              : ''}
          </div>`,
        )}
        ${card(
          'Quarantined items',
          quarantined.length === 0
            ? html`<p class="text-sm text-slate-500">Nothing is quarantined.</p>`
            : html`<div class="overflow-x-auto">
                <p class="mb-3 text-sm text-red-700">
                  These items are withheld everywhere, preserved, and cannot be deleted. They are
                  listed by reference only and cannot be viewed from this console.
                </p>
                <table class="w-full text-left text-sm">
                  <thead
                    class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500"
                  >
                    <tr>
                      <th class="py-2">Reference</th>
                      <th class="py-2">Source</th>
                      <th class="py-2">State</th>
                      <th class="py-2">Since</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${quarantined.map(
                      (q) => html`
                        <tr class="border-b border-slate-100">
                          <td class="py-2 font-mono">message:${q.message_id}</td>
                          <td class="py-2">
                            ${q.source === 'csam'
                              ? badge('hash match', 'red')
                              : badge('escalated', 'amber')}
                          </td>
                          <td class="py-2">${q.state}</td>
                          <td class="py-2 text-slate-500">${fmtDate(q.created_at)}</td>
                        </tr>
                      `,
                    )}
                  </tbody>
                </table>
              </div>`,
        )}
        ${card(
          'Recent screening activity',
          attempts.length === 0
            ? html`<p class="text-sm text-slate-500">Nothing screened this run.</p>`
            : html`<ul class="flex flex-col gap-1 text-sm">
                ${attempts.map(
                  (a) => html`<li class="flex flex-wrap gap-x-2 text-slate-600">
                    <span class="text-slate-400">${ago(a.at)}</span>
                    <span class="font-mono">message:${String(a.messageId)}</span>
                    <span class="font-medium">${a.provider}</span>
                    <span
                      class="${a.verdict === 'match'
                        ? 'text-red-700'
                        : a.verdict === 'error'
                          ? 'text-amber-700'
                          : 'text-slate-500'}"
                      >${a.verdict}</span
                    >
                    <span class="text-slate-400">${String(a.ms)}ms</span>
                  </li>`,
                )}
              </ul>`,
        )}
      </div>
    `;
    reply.type('text/html');
    return page({ title: 'Screening', active: 'screening', csrfToken: csrf, body });
  });
}
