/**
 * The Retention page (CCB-S5-054, D-240).
 *
 * What the archive stops keeping, and when. Its own page rather than a card on Capture,
 * because it holds a DECISION rather than a status: three controls that between them
 * settle how long two different databases hold content nobody consented to. D-235's
 * second question is the test - could a customer do the thing this page is for without
 * already knowing where everything else lives - and a retention control tucked under a
 * page about which bot records which room fails it.
 *
 * ── THE ONE SENTENCE THIS PAGE EXISTS TO MAKE TRUE ───────────────────────────
 *
 *     The content is gone. The fact that a message existed is not.
 *
 * It is printed on the page, in those words, because the operator has to be able to
 * repeat it to somebody who asks - and because it is the honest description of a
 * tombstone, which is neither "deleted" nor "kept".
 *
 * ── BOTH COPIES, ON ONE PAGE ─────────────────────────────────────────────────
 *
 * There are two databases holding everything said in his rooms: the archive's Postgres,
 * and the SimpleX core's own SQLite beside it. A page that swept one and said nothing
 * about the other would be a page that let him believe the promise was kept. So the core
 * control is here, on the same page, showing what the core is set to RIGHT NOW by asking
 * it rather than by remembering what we last sent.
 */

import type { FastifyInstance } from 'fastify';
import type { ViewContext } from '../server.js';
import { html, page } from '../html.js';
import { badge, card, fmtDate, pageHeader } from './ui.js';
import {
  DEFAULT_RETENTION,
  RETENTION_MAX_HOURS,
  RETENTION_MIN_HOURS,
  cutoffFor,
  getRetentionSettings,
  lastSweptAt,
  nextMidnight,
  saveRetentionSettings,
  sweepUnconsented,
  sweepableCount,
  tombstoneCount,
} from '../../archive/retention.js';
import {
  readCoreRetention,
  runtimeAdminAvailable,
  setCoreRetention,
} from '../../bot/runtime/admin-actions.js';
import { writeAudit } from '../../db/audit.js';
import { log } from '../../log.js';

/**
 * The core's own vocabulary, from `ciTTL` in `Commands.hs` (D-209).
 *
 * Not our own scale of numbers: these are the five values the core itself names, so the
 * operator's choice maps exactly onto what SimpleX understands, and there is no arithmetic
 * between the label and the command.
 */
const CORE_TTL_CHOICES: { seconds: number; label: string }[] = [
  { seconds: 0, label: 'For ever (no expiry)' },
  { seconds: 86_400, label: 'One day' },
  { seconds: 7 * 86_400, label: 'One week' },
  { seconds: 30 * 86_400, label: 'One month' },
  { seconds: 365 * 86_400, label: 'One year' },
];

function describeCoreTtl(seconds: number): string {
  const match = CORE_TTL_CHOICES.find((c) => c.seconds === seconds);
  if (match) return match.label;
  // A value we did not offer is a value somebody set elsewhere. Say the number rather than
  // rounding it to the nearest thing on our list, which would misreport the core's state.
  return `${String(seconds)} seconds`;
}

/** The bounds the operator may pick, in the units he thinks in. */
const BOUND_CHOICES: { hours: number; label: string }[] = [
  { hours: RETENTION_MIN_HOURS, label: '24 hours' },
  { hours: 3 * 24, label: '3 days' },
  { hours: 7 * 24, label: '7 days' },
  { hours: 14 * 24, label: '14 days' },
  { hours: 30 * 24, label: '30 days' },
  { hours: 90 * 24, label: '90 days' },
  { hours: 180 * 24, label: '180 days' },
  { hours: RETENTION_MAX_HOURS, label: '1 year' },
];

function bodyStr(body: unknown, key: string): string {
  const v = (body as Record<string, unknown> | null)?.[key];
  return typeof v === 'string' ? v : '';
}

export function registerRetentionPage(app: FastifyInstance, ctx: ViewContext): void {
  const { db } = ctx;

  app.get<{ Querystring: { saved?: string; error?: string; swept?: string } }>(
    '/retention',
    async (req, reply) => {
      const csrf = req.session?.csrfToken ?? '';
      const settings = await getRetentionSettings(db);
      const cutoff = cutoffFor(settings.hours, new Date());
      const waiting = await sweepableCount(db, cutoff);
      const tombstones = await tombstoneCount(db);
      const lastSwept = await lastSweptAt(db);
      const nextRun = nextMidnight(new Date());
      const core = runtimeAdminAvailable()
        ? await readCoreRetention()
        : { ok: [], failed: [] as { displayName: string; error: string }[] };

      reply.type('text/html');
      return page({
        title: 'Retention',
        active: 'retention',
        csrfToken: csrf,
        body: html`
          ${pageHeader(
            'Retention',
            'How long the archive keeps content nobody agreed to, and how long the SimpleX core keeps its own copy.',
          )}
          ${req.query.saved
            ? html`<div class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Saved.</div>`
            : ''}
          ${req.query.swept
            ? html`<div class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                ${req.query.swept} message(s) now hold no content.
              </div>`
            : ''}
          ${req.query.error
            ? html`<div class="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">${req.query.error}</div>`
            : ''}

          ${card(
            'What this does',
            html`<p class="mb-3 text-sm text-slate-700">
                Publication has always needed consent. Storage did not: everything said in a
                room was kept, whether the member had opted in or not. This page is what
                closes that, and it is worth being able to say exactly what it leaves behind.
              </p>
              <p class="mb-3 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-base font-medium text-slate-900">
                The content is gone. The fact that a message existed is not.
              </p>
              <p class="mb-3 text-sm text-slate-700">
                A swept message keeps its skeleton: which room, which member id, when, and what
                kind of thing it was. It keeps nothing it said - no text, no link, no picture,
                no display name, and the media file is removed from disk. That skeleton is what
                lets moderation counts, deletion records and capture stay correct instead of
                quietly losing rows.
              </p>
              <p class="text-sm text-slate-700">
                Only messages from members who have <strong>never touched consent at all</strong>
                are swept - never opted in, never opted out, never hidden or restored anything.
                A member who has ever engaged with it keeps everything, in whatever state they
                chose. Nothing published is ever touched, and nothing swept could ever have
                become published: opting in only publishes what you say <em>afterwards</em>.
              </p>`,
          )}

          ${card(
            'The archive',
            html`<div class="mb-4 grid gap-3 sm:grid-cols-3">
                <div class="rounded-lg border border-slate-200 px-3 py-2">
                  <div class="text-xs uppercase tracking-wide text-slate-500">Waiting to be swept</div>
                  <div class="text-2xl font-semibold text-slate-900">${String(waiting)}</div>
                  <div class="text-xs text-slate-500">past the current bound, right now</div>
                </div>
                <div class="rounded-lg border border-slate-200 px-3 py-2">
                  <div class="text-xs uppercase tracking-wide text-slate-500">Already swept</div>
                  <div class="text-2xl font-semibold text-slate-900">${String(tombstones)}</div>
                  <div class="text-xs text-slate-500">rows holding no content</div>
                </div>
                <div class="rounded-lg border border-slate-200 px-3 py-2">
                  <div class="text-xs uppercase tracking-wide text-slate-500">Next sweep</div>
                  <div class="text-2xl font-semibold text-slate-900">
                    ${settings.enabled ? 'Midnight' : 'Off'}
                  </div>
                  <div class="text-xs text-slate-500">
                    ${settings.enabled
                      ? html`${fmtDate(nextRun.toISOString())}`
                      : 'nothing is being removed'}
                  </div>
                </div>
              </div>
              <form method="post" action="/retention/settings" class="flex flex-wrap items-end gap-3">
                <input type="hidden" name="_csrf" value="${csrf}" />
                <label class="block">
                  <span class="mb-1 block text-xs font-medium text-slate-700">Keep unconsented content for</span>
                  <select name="hours" class="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                    ${BOUND_CHOICES.map(
                      (c) => html`<option value="${String(c.hours)}" ${c.hours === settings.hours ? 'selected' : ''}>
                        ${c.label}
                      </option>`,
                    )}
                  </select>
                </label>
                <label class="flex items-center gap-2 pb-2 text-sm text-slate-700">
                  <input type="checkbox" name="enabled" value="yes" ${settings.enabled ? 'checked' : ''} />
                  Sweep automatically
                </label>
                <button type="submit" class="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">
                  Save
                </button>
              </form>
              <p class="mt-3 text-xs text-slate-500">
                The bound is an AGE and the schedule is a TIME, and they are separate: the sweep
                runs once a night at midnight on this host and takes everything older than the
                bound. It does not run at startup, so restarting the bot never brings an erasure
                forward. 24 hours is the shortest offered and is what a new deployment gets: the
                only thing that reads a message's content after the fact is her conversation
                memory, which cannot look back further than 12 hours at any setting. The longer
                bounds are there for a longer moderation rhythm, or simply to have a week to look
                at what arrived. Sweeping ships switched off, so nothing is removed until the
                number above has been read and this has been turned on.
                ${lastSwept === null
                  ? html`Nothing has been swept yet.`
                  : html`Last swept ${fmtDate(lastSwept)}.`}
              </p>
              <form method="post" action="/retention/sweep" class="mt-4 border-t border-slate-200 pt-4">
                <input type="hidden" name="_csrf" value="${csrf}" />
                <button
                  type="submit"
                  class="rounded-lg border border-amber-400 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
                >
                  Sweep now (${String(waiting)} message${waiting === 1 ? '' : 's'})
                </button>
                <span class="ml-2 text-xs text-slate-500">
                  Runs one pass immediately, whether automatic sweeping is on or off. This cannot
                  be undone.
                </span>
              </form>`,
          )}

          ${card(
            "The SimpleX core's own copy",
            html`<p class="mb-3 text-sm text-slate-700">
                The core keeps its own full copy of every room on this machine, and by default
                it keeps it for ever. It also keeps the text of messages members have
                <strong>deleted</strong>: a delete older than 78 hours is refused outright, and
                a normal delete marks the item rather than emptying it. Sweeping the archive and
                leaving this is a promise kept in one database and broken in the one beside it.
              </p>
              <div class="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <strong>This takes effect immediately, not just from now on.</strong> Setting a
                shorter retention makes the core delete everything already older than it, at
                once, for every profile on this host. There is no undo and no export first.
              </div>
              ${!runtimeAdminAvailable()
                ? html`<p class="text-sm text-slate-500">
                    The bot is not running, so the core cannot be asked what it is keeping. Start
                    it to see and change this.
                  </p>`
                : html`
                    <table class="mb-3 w-full text-left text-sm">
                      <tbody>
                        ${core.ok.map(
                          (c) => html`<tr class="border-b border-slate-100">
                            <td class="py-2 pr-3 font-medium">${c.displayName}</td>
                            <td class="py-2 pr-3">${describeCoreTtl(c.seconds)}</td>
                            <td class="py-2 text-slate-500">
                              ${c.seconds === 0 ? 'keeps everything' : 'expires older items'}
                            </td>
                          </tr>`,
                        )}
                        ${core.failed.map(
                          (f) => html`<tr class="border-b border-slate-100">
                            <td class="py-2 pr-3 font-medium">${f.displayName}</td>
                            <td class="py-2 pr-3">${badge('could not read', 'red')}</td>
                            <td class="py-2 text-slate-500">${f.error}</td>
                          </tr>`,
                        )}
                      </tbody>
                    </table>
                    <form method="post" action="/retention/core" class="flex flex-wrap items-end gap-3">
                      <input type="hidden" name="_csrf" value="${csrf}" />
                      <label class="block">
                        <span class="mb-1 block text-xs font-medium text-slate-700">The core keeps items for</span>
                        <select name="seconds" class="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                          ${CORE_TTL_CHOICES.map(
                            (c) => html`<option value="${String(c.seconds)}" ${core.ok[0]?.seconds === c.seconds ? 'selected' : ''}>
                              ${c.label}
                            </option>`,
                          )}
                        </select>
                      </label>
                      <input type="hidden" name="confirmed" value="yes" />
                      <button type="submit" class="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">
                        Apply to every profile
                      </button>
                    </form>
                    <p class="mt-2 text-xs text-slate-500">
                      This is one answer for the whole host rather than a per-bot setting: the
                      question is how long this machine keeps a second copy of everything.
                    </p>`}`,
          )}
        `,
      });
    },
  );

  /* ── actions ──────────────────────────────────────────────────────────────── */

  app.post<{ Body: Record<string, unknown> }>('/retention/settings', async (req, reply) => {
    const hours = Number.parseInt(bodyStr(req.body, 'hours'), 10);
    const enabled = bodyStr(req.body, 'enabled') === 'yes';
    const saved = await saveRetentionSettings(db, {
      enabled,
      hours: Number.isFinite(hours) ? hours : DEFAULT_RETENTION.hours,
    });
    await writeAudit(db, req.session?.username ?? 'unknown', 'retention.settings', 'archive', {
      enabled: saved.enabled,
      hours: saved.hours,
    });
    return reply.redirect('/retention?saved=1');
  });

  app.post<{ Body: Record<string, unknown> }>('/retention/sweep', async (req, reply) => {
    const settings = await getRetentionSettings(db);
    const cutoff = cutoffFor(settings.hours, new Date());
    try {
      // The same transaction discipline as the timer: paths are read, the rows are cleared
      // and the bytes unlinked together, so a failure leaves the content intact rather than
      // a tombstone standing over files nothing can find.
      const outcome = await ctx.transaction((tx) => sweepUnconsented(tx, ctx.cfg.mediaRoot, cutoff));
      await writeAudit(db, req.session?.username ?? 'unknown', 'retention.sweep', 'archive', {
        swept: outcome.swept,
        filesRemoved: outcome.filesRemoved,
        hours: settings.hours,
      });
      log.info('retention console: the operator swept by hand', {
        swept: outcome.swept,
        filesRemoved: outcome.filesRemoved,
      });
      return reply.redirect(`/retention?swept=${String(outcome.swept)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`retention console: the sweep failed: ${message}`);
      return reply.redirect(`/retention?error=${encodeURIComponent(message)}`);
    }
  });

  app.post<{ Body: Record<string, unknown> }>('/retention/core', async (req, reply) => {
    const seconds = Number.parseInt(bodyStr(req.body, 'seconds'), 10);
    if (!Number.isFinite(seconds) || seconds < 0) {
      return reply.redirect('/retention?error=Pick+a+retention+first.');
    }
    const result = await setCoreRetention(seconds);
    await writeAudit(db, req.session?.username ?? 'unknown', 'retention.core', 'simplex', {
      seconds,
      applied: result.applied,
      failed: result.failed.map((f) => f.displayName),
    });
    if (result.failed.length > 0) {
      // Partial is reported as partial. Every profile is attempted, and the ones that took it
      // are named beside the ones that did not, because "applied" over a host where one core
      // refused is the shape that leaves an unswept copy nobody knows about.
      const failed = result.failed.map((f) => `${f.displayName}: ${f.error}`).join('; ');
      return reply.redirect(
        `/retention?error=${encodeURIComponent(
          `Applied to ${String(result.applied.length)} profile(s); ${failed}`,
        )}`,
      );
    }
    return reply.redirect('/retention?saved=1');
  });
}
