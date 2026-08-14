/**
 * The Welcome page (CCB-S5-041, D-206).
 *
 * The words, where they go, and a record of every greeting that did or did not happen.
 *
 * ── WHY THE DIAGNOSTICS ARE HALF THE PAGE ───────────────────────────────────
 *
 * A greeting is invisible to the operator by construction: it goes to somebody else, once,
 * possibly in private, possibly not at all. Every other control in this console can be tested
 * by pressing it; this one cannot. So the record of what happened is not a debugging extra,
 * it is the only way the operator ever learns whether the feature works - and a suppression
 * with no reason would leave him exactly where the clear button and the bridge tick left him,
 * looking at a control that appears to do nothing.
 */

import type { FastifyInstance } from 'fastify';
import type { ViewContext } from '../server.js';
import { html, page } from '../html.js';
import { badge, card, fmtDate, pageHeader } from './ui.js';
import { listBotOnboardingProfiles } from '../../profiles/bot-onboarding.js';
import { resolveSelectedBot } from '../selected-bot.js';
import { listPluginOverridesForBot, setPluginOverride } from '../../db/plugin-overrides.js';
import { WELCOME_ID } from '../../plugins/welcome/plugin.js';
import { listGreetings } from '../../plugins/welcome/store.js';
import type { Destination, Fallback, SuppressionReason } from '../../plugins/welcome/greeting.js';
import { writeAudit } from '../../db/audit.js';

function bodyStr(body: unknown, key: string): string {
  const v = (body as Record<string, unknown> | null)?.[key];
  return typeof v === 'string' ? v.trim() : '';
}

/** One line each, in the operator's terms rather than the field's. */
const WHY_SUPPRESSED: Record<SuppressionReason, string> = {
  disabled: 'The capability is off for this bot.',
  'no-text': 'No greeting has been written for this case.',
  'already-greeted': 'This person had already been greeted, so nothing was sent again.',
  'predates-bot': 'They were already in the room when this bot arrived.',
  'no-contact': 'There is no direct connection to this member, so no private route exists.',
  prohibited: 'The group does not permit direct messages from this bot’s role.',
  'send-failed': 'Something went wrong sending it. This one is a fault.',
};

const DESTINATIONS: { value: Destination; label: string; note: string }[] = [
  {
    value: 'group',
    label: 'In the group, publicly',
    note: 'Always works. Noisy: twenty joins in a day is twenty greetings everybody reads.',
  },
  {
    value: 'support',
    label: 'In the private support thread',
    note: 'Private, and needs no direct-message permission because it never leaves the group.',
  },
  {
    value: 'direct',
    label: 'As a direct message',
    note: 'Needs a direct connection to the member, which the group’s rules may not permit.',
  },
];

export function registerWelcomePage(app: FastifyInstance, ctx: ViewContext): void {
  const { db } = ctx;

  app.get<{ Querystring: { bot?: string; saved?: string; error?: string } }>(
    '/welcome',
    async (req, reply) => {
      const csrf = req.session?.csrfToken ?? '';
      const profiles = await listBotOnboardingProfiles(db);
      // ── THE SIDEBAR'S BOT, NOT THE FIRST ONE (CCB-S5-041, D-211) ────────
      //
      // This read `req.query.bot ?? profiles[0].id`, using neither the session nor the sidebar
      // switcher that every other bot-scoped page goes through. So switching bot in the
      // sidebar and opening this page still showed - and SAVED - the FIRST bot's settings.
      //
      // The operator reported "the same greeting for both bots though the settings are per
      // bot". He was not seeing one text shared by two bots; he was seeing ONE BOT TWICE, and
      // every save he made went to bot 10 whichever bot he thought he was editing. The
      // resolver was right all along: it reads the greeting bot's own overrides.
      const selection = resolveSelectedBot(
        profiles,
        req.query.bot,
        req.session?.selectedBotProfileId ?? null,
      );
      const selected = selection.selectedId ?? undefined;
      const overrides =
        selected === undefined ? [] : await listPluginOverridesForBot(db, selected);
      const val = (key: string): unknown =>
        overrides.find((o) => o.pluginId === WELCOME_ID && o.key === key)?.value;
      const str = (key: string): string => (typeof val(key) === 'string' ? String(val(key)) : '');
      const greetings = selected === undefined ? [] : await listGreetings(db, selected, 50);
      // WHOSE greeting this is. Named, because the page said nothing and read as deployment
      // -wide; see the header note below.
      const botName =
        profiles.find((p) => p.id === selected)?.displayName ?? 'no bot selected';

      reply.type('text/html');
      return page({
        title: 'Welcome',
        active: 'welcome',
        csrfToken: csrf,
        // ── A PER-BOT PAGE MUST CARRY THE PICKER (CCB-S5-041, D-211) ────────
        //
        // Without this the sidebar renders "Deployment-wide", which is not a blank - it is a
        // CLAIM, and on this page a false one. The operator was editing one bot's greeting
        // with no way to see or change which bot, which is how every save went to bot 10.
        // 96b2211 taught the page to honour the switcher; this is the other half.
        botSwitcher: { ...selection, returnTo: '/welcome' },
        body: html`
          ${/*
            ── THE SCOPE STATEMENT WAS MISSING, AND SILENCE READ AS "SHARED" (D-211) ──

            This page said "What she says to somebody who has just joined" and named no bot.
            The picker was in the sidebar and working; the COPY contradicted it. So the
            operator edited one specific bot believing he was setting something shared, every
            value went to whichever bot was selected, and he found out only when both bots
            greeted identically.

            That is D-155's scope visibility failing on a page that HAS the picker: a control
            that says which bot, beside words that imply none, and the words win because they
            are what he is reading while he types.

            The lesson is not "add a label". It is that operating a control proves it works and
            proves nothing about whether the words beside it are true. Every per-bot page owes
            this sentence, and it must name the bot rather than gesture at one.
          */ ''}
          ${pageHeader(
            `Welcome: ${botName}`,
            `Everything on this page belongs to ${botName} alone. Nothing here is shared with ` +
              `your other bots: each one has its own greeting, its own destination, and its ` +
              `own record below. Switch bots in the sidebar to edit another.`,
          )}
          ${req.query.saved
            ? html`<div class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Saved.</div>`
            : ''}
          ${req.query.error
            ? html`<div class="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">${req.query.error}</div>`
            : ''}

          ${card(
            'The greeting',
            html`<form method="post" action="/welcome/save" class="space-y-4">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <input type="hidden" name="botProfileId" value="${String(selected ?? '')}" />

              <div>
                <label class="block text-sm font-medium">What she says</label>
                <p class="mb-1 text-xs text-slate-500">
                  Use <code>{{member}}</code> for their name and <code>{{group}}</code> for the
                  room. She does not write this and never sees it: the words are yours exactly.
                </p>
                <textarea name="text" rows="4" class="w-full rounded-lg border border-slate-300 p-2 text-sm">${str('text')}</textarea>
              </div>

              <div>
                <label class="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="separateReturning" value="yes"
                    ${val('separateReturning') === true ? 'checked' : ''} />
                  Different words for somebody coming back
                </label>
                <p class="mb-1 text-xs text-slate-500">
                  Off, one greeting serves everybody. On, a member whose messages are already in
                  the archive but who has never been greeted gets the second text instead.
                </p>
                <textarea name="returningText" rows="3" class="w-full rounded-lg border border-slate-300 p-2 text-sm">${str('returningText')}</textarea>
              </div>

              <div>
                <label class="block text-sm font-medium">Where it goes</label>
                ${DESTINATIONS.map(
                  (d) => html`<label class="mt-1 flex items-start gap-2 text-sm">
                    <input type="radio" name="destination" value="${d.value}" class="mt-1"
                      ${(str('destination') || 'group') === d.value ? 'checked' : ''} />
                    <span><strong>${d.label}.</strong> <span class="text-slate-500">${d.note}</span></span>
                  </label>`,
                )}
              </div>

              <div>
                <label class="block text-sm font-medium">If the private route is unavailable</label>
                <label class="mt-1 flex items-center gap-2 text-sm">
                  <input type="radio" name="fallback" value="group"
                    ${(str('fallback') || 'group') === 'group' ? 'checked' : ''} />
                  Greet in the group instead
                </label>
                <label class="flex items-center gap-2 text-sm">
                  <input type="radio" name="fallback" value="none"
                    ${str('fallback') === 'none' ? 'checked' : ''} />
                  Do not greet at all
                </label>
                <p class="mt-1 text-xs text-slate-500">
                  A real send failure is never quietly turned into a group greeting: that would
                  hide a fault behind a success. This covers the two settled cases, where no
                  private route exists or the group does not permit one.
                </p>
              </div>

              <button type="submit" class="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">
                Save
              </button>
            </form>`,
          )}

          ${card(
            'What happened',
            greetings.length === 0
              ? html`<p class="text-sm text-slate-500">
                  Nobody has joined a room this bot is in since the greeting was switched on.
                </p>`
              : html`<table class="w-full text-left text-sm">
                  <thead>
                    <tr class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <th class="py-1 pr-3">When</th><th class="py-1 pr-3">Who</th>
                      <th class="py-1 pr-3">Room</th><th class="py-1 pr-3">Route</th>
                      <th class="py-1">Why not</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${greetings.map(
                      (g) => html`<tr class="border-b border-slate-100">
                        <td class="py-1 pr-3 text-slate-500">${fmtDate(g.greetedAt.toISOString())}</td>
                        <td class="py-1 pr-3">
                          ${g.memberName}
                          ${g.isReturning ? badge('returning', 'slate') : ''}
                        </td>
                        <td class="py-1 pr-3">${g.groupName}</td>
                        <td class="py-1 pr-3">
                          ${g.route === 'suppressed'
                            ? badge('not sent', 'amber')
                            : badge(g.route, 'green')}
                        </td>
                        <td class="py-1 text-slate-500">
                          ${g.reason === null ? '' : (WHY_SUPPRESSED[g.reason] ?? g.reason)}
                        </td>
                      </tr>`,
                    )}
                  </tbody>
                </table>`,
          )}
        `,
      });
    },
  );

  app.post<{ Body: Record<string, unknown> }>('/welcome/save', async (req, reply) => {
    const botProfileId = Number.parseInt(bodyStr(req.body, 'botProfileId'), 10);
    if (!Number.isFinite(botProfileId)) {
      return reply.redirect('/welcome?error=Pick+a+bot+first.');
    }
    const destination = bodyStr(req.body, 'destination');
    const fallback = bodyStr(req.body, 'fallback');
    const set = async (key: string, value: unknown): Promise<void> => {
      await setPluginOverride(db, botProfileId, WELCOME_ID, key, value);
    };
    try {
      await set('text', bodyStr(req.body, 'text'));
      await set('returningText', bodyStr(req.body, 'returningText'));
      await set('separateReturning', bodyStr(req.body, 'separateReturning') === 'yes');
      // Validated against the vocabulary rather than stored as typed: an unknown destination
      // would be a setting the runner cannot act on, which is how `trigger` came to be
      // normalised, persisted, audited and read by nobody (see verify:knowledge section 6b).
      await set(
        'destination',
        (['group', 'support', 'direct'] as Destination[]).includes(destination as Destination)
          ? destination
          : 'group',
      );
      await set(
        'fallback',
        (['group', 'none'] as Fallback[]).includes(fallback as Fallback) ? fallback : 'group',
      );
      await writeAudit(
        db,
        req.session?.username ?? 'unknown',
        'welcome.settings.save',
        `bot:${String(botProfileId)}`,
        { destination, fallback },
      );
      return reply.redirect(`/welcome?bot=${String(botProfileId)}&saved=1`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.redirect(`/welcome?bot=${String(botProfileId)}&error=${encodeURIComponent(message)}`);
    }
  });
}
