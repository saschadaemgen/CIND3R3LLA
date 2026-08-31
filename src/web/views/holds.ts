/**
 * Evidence hold review (CCB-S3-013 Part B). Operator-only, behind the existing
 * auth, CSRF and step-up guards.
 *
 * Three outcomes, each audited:
 *
 *   RELEASE  - no issue found. The hold lifts, and any deletion the member asked
 *              for while it was held runs by itself.
 *   DESTROY  - the operator removes it now, through the same destruction path a
 *              member's delete uses.
 *   ESCALATE - preserved for a legal process: segregated, and not deletable by
 *              any path, including this page.
 *
 * TWO RULES THIS VIEW ENFORCES TWICE OVER, in the markup AND in the handler,
 * following the `group_deleted` precedent in the Messages browser:
 *
 *  1. **Destroy is never offered for a hash-match quarantine.** Destroying such an
 *     item would eliminate the evidence, which is the opposite of the obligation.
 *     The briefing asks for this to be impossible in the interface, not merely
 *     discouraged, so the button is absent AND the route refuses with 409.
 *  2. **Restore is never offered for something destroyed.** There is nothing to
 *     restore, and offering it would imply otherwise.
 *
 * The CSAM source has no producer yet (screening is a later track), but the
 * mechanism is built and tested now so the hook has somewhere to attach.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { destroyMessage, destructionBlockedBy } from '../../archive/destroy.js';
import { getAdminMessage } from '../../db/admin-queries.js';
import { writeAudit } from '../../db/audit.js';
import { liveHold, listHolds, resolveHold, type HoldListRow } from '../../db/holds.js';
import { withTransaction } from '../../db/pool.js';
import { log } from '../../log.js';
import { enqueueDestructionFor } from '../../queue/jobs/destruction.js';
import { quarantineMedia, releaseQuarantinedMedia } from '../../media/quarantine.js';
import { status } from '../status.js';
import { html, page, type SafeHtml } from '../html.js';
import type { ViewContext } from '../server.js';
import { actionButton } from './messages.js';
import { badge, fmtDate, pageHeader, truncate } from './ui.js';

const VIEWS = ['live', 'resolved'] as const;
type HoldView = (typeof VIEWS)[number];

const BACK_RE = /^\?view=(live|resolved)$/;

const HOLD_FLASH: Record<string, string> = {
  release: 'Hold released. Any deletion the member asked for will now run.',
  destroy: 'Content destroyed and the hold closed.',
  escalate: 'Escalated and segregated. It cannot be destroyed by any path now.',
  gone: 'That hold no longer exists.',
  refused: 'That outcome is not available for this hold.',
  failed: 'The destruction did not complete. Nothing was removed; see the logs.',
  'segregation-failed':
    'The escalation was NOT applied: this item’s media could not be moved out of the served ' +
    'media store, so segregating it would not have been true. See the logs.',
};

/** Days before expiry at which the operator is warned, so a hold lapses by decision. */
const EXPIRY_WARN_DAYS = 7;

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

export function registerHolds(app: FastifyInstance, ctx: ViewContext): void {
  app.get<{ Querystring: { view?: string; flash?: string } }>('/holds', async (req, reply) => {
    const csrf = req.session?.csrfToken ?? '';
    const view: HoldView = VIEWS.includes(req.query.view as HoldView)
      ? (req.query.view as HoldView)
      : 'live';
    const back = `?view=${view}`;
    const flashKey = req.query.flash ?? '';
    // Own-key guard, as on the reports queue: a crafted ?flash=constructor would
    // otherwise resolve an inherited prototype member and 500 the render.
    const flash = Object.hasOwn(HOLD_FLASH, flashKey) ? HOLD_FLASH[flashKey] : '';

    const holds = await listHolds(ctx.db, view);
    const rows = await Promise.all(
      holds.map(async (h) => ({ h, m: await getAdminMessage(ctx.db, h.messageId) })),
    );
    const expiringSoon = holds.filter((h) => {
      const d = daysUntil(h.expiresAt);
      return h.state === 'active' && d !== null && d <= EXPIRY_WARN_DAYS;
    }).length;

    const body = html`
      ${pageHeader(
        'Evidence holds',
        // The old subtitle said "a hold never hides content and never publishes it",
        // which is true of report-holds only: a csam or escalated hold DOES withhold
        // publication and relocates the bytes to quarantine (migration 022). A page
        // header that overstates a guarantee for two of the kinds it lists is the
        // D-212 class (CCB-S5-063).
        'Content held against destruction while a report is reviewed. Every hold defers ' +
          'erasure; a report-hold changes nothing else, while a csam or escalated hold also ' +
          'withholds the item from publication and moves its bytes to quarantine.',
      )}
      ${flash ? html`<div class="rounded-lg bg-blue-900/40 px-4 py-2 text-sm">${flash}</div>` : ''}
      ${expiringSoon > 0 && view === 'live'
        ? html`<div class="rounded-lg bg-amber-900/40 px-4 py-3 text-sm">
            <strong>${String(expiringSoon)}</strong> hold(s) expire within ${String(
              EXPIRY_WARN_DAYS,
            )}
            days. When a hold expires it is released automatically and any deletion the member
            asked for runs. Review them so they lapse by decision rather than by being forgotten.
          </div>`
        : ''}
      <div class="flex gap-2 text-sm">
        ${VIEWS.map(
          (v) =>
            html`<a
              class="rounded px-3 py-1 ${v === view ? 'bg-slate-700' : 'bg-slate-800/60'}"
              href="/holds?view=${v}"
              >${v === 'live' ? 'Live' : 'Resolved'}</a
            >`,
        )}
      </div>
      ${rows.length === 0
        ? html`<p class="text-sm text-slate-400">
            ${view === 'live' ? 'Nothing is held right now.' : 'No resolved holds yet.'}
          </p>`
        : html`<div class="grid gap-3">
            ${rows.map(({ h, m }) => holdCard(h, m?.textBody ?? null, m?.type ?? null, csrf, back))}
          </div>`}
    `;
    reply.type('text/html');
    return page({ title: 'Evidence holds', active: 'holds', csrfToken: csrf, body });
  });

  async function outcome(
    req: FastifyRequest<{ Params: { holdId: string } }>,
    reply: FastifyReply,
    action: 'release' | 'destroy' | 'escalate',
  ): Promise<unknown> {
    const holdId = Number.parseInt(req.params.holdId, 10);
    if (!Number.isInteger(holdId) || holdId < 1) return reply.code(400).send({ error: 'bad id' });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const back =
      typeof body['back'] === 'string' && BACK_RE.test(body['back']) ? body['back'] : '?view=live';
    const user = req.session?.username ?? 'unknown';

    const holds = await listHolds(ctx.db, 'live');
    const hold = holds.find((h) => h.id === holdId);
    if (!hold) return reply.redirect(`/holds${back}&flash=gone`);

    // Rule 1, server side. The UI omits the control; this refuses it outright, so
    // a stale page, a replayed form or a crafted POST cannot destroy evidence.
    if (action === 'destroy' && hold.source === 'csam') {
      log.warn(
        `Holds: refused a destroy on hash-match hold ${holdId}; only release or escalate apply.`,
      );
      return reply.code(409).redirect(`/holds${back}&flash=refused`);
    }
    // AN ESCALATION IS TERMINAL. Guarding only `destroy` here was a hole: RELEASE
    // on an escalated hold would have moved it to 'released', which satisfies the
    // DB trigger, and the release branch then enqueues the member's deferred
    // destruction. Two operators and one stale tab would have destroyed exactly
    // the evidence the escalation existed to preserve.
    //
    // So nothing lifts an escalation. Releasing it needs a deliberate,
    // audited de-escalation that does not exist yet, and must not be reachable by
    // a button that reads "Release".
    if (hold.state === 'escalated') {
      log.warn(
        `Holds: refused '${action}' on escalated hold ${holdId}; an escalation is not reversible here.`,
      );
      return reply.code(409).redirect(`/holds${back}&flash=refused`);
    }

    const messageId = hold.messageId;

    if (action === 'destroy') {
      // The operator destroys through the SAME path a member's delete uses, so
      // there is one destruction implementation and one set of guarantees.
      //
      // BOTH STEPS SHARE ONE TRANSACTION. The hold must be resolved before the
      // delete, because the DB trigger would otherwise refuse it, but doing that
      // on the pool would autocommit: a destruction that then failed would leave
      // the item BOTH undestroyed and no longer protected, with the hold reading
      // "Released (destroy)" for content that still exists. Inside one
      // transaction, a failure rolls the release back with it and the hold stands.
      try {
        await withTransaction(async (tx) => {
          const resolved = await resolveHold(tx, holdId, 'destroy', user);
          if (!resolved) throw new Error('hold was resolved by someone else');
          await destroyMessage(tx, ctx.cfg.mediaRoot, messageId, ctx.cfg.quarantineRoot);
        });
      } catch (err) {
        log.error(
          `Holds: operator destroy of message ${messageId} failed; the hold is unchanged: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
        return reply.redirect(`/holds${back}&flash=failed`);
      }
      // Identifiers only. The audit records that a destruction happened, never the
      // content it destroyed.
      await writeAudit(ctx.db, user, 'hold.destroy', `message:${messageId}`, {
        holdId,
        source: hold.source,
      });
      return reply.redirect(`/holds${back}&flash=destroy`);
    }

    if (action === 'escalate') {
      // SEGREGATION IS PHYSICAL, and it happens BEFORE the state changes.
      //
      // "Not deletable by any path" was only ever half the requirement; the other
      // half is that nobody can read it in normal operation, and a database state
      // cannot deliver that while the admin console can still fetch the bytes.
      // So the files leave MEDIA_ROOT first: if the move fails, the hold stays
      // exactly as it was and the operator is told, rather than the item being
      // marked escalated while its bytes are still being served.
      try {
        await quarantineMedia(ctx.db, ctx.cfg.mediaRoot, ctx.cfg.quarantineRoot, messageId);
      } catch (err) {
        log.error(
          `Holds: could not segregate media for message ${messageId}; the escalation was not applied: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
        return reply.redirect(`/holds${back}&flash=segregation-failed`);
      }
    }

    const resolved = await resolveHold(ctx.db, holdId, action, user);
    // Scoped to a live hold, so a double-submitted button resolves nothing a
    // second time and writes no duplicate audit row.
    if (!resolved) return reply.redirect(`/holds${back}&flash=gone`);

    if (action === 'release' && hold.source === 'csam') {
      // A hash match released as a false positive gets its bytes back, so the item
      // behaves normally again. Failure here is loud but does not undo the release:
      // the content is readable-by-nobody until it is fixed, which is the safe way
      // round for this one.
      try {
        await releaseQuarantinedMedia(ctx.db, ctx.cfg.mediaRoot, ctx.cfg.quarantineRoot, messageId);
      } catch (err) {
        status.error(
          `Hold ${holdId} on message ${messageId} was released but its quarantined media could not ` +
            `be moved back. The item is public again with its media missing: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    await writeAudit(ctx.db, user, `hold.${action}`, `message:${messageId}`, {
      holdId,
      source: hold.source,
      destructionPending: hold.destructionPending,
    });

    if (action === 'release') {
      // "When the hold is released or expires, the queued deletion runs
      // automatically. The member must not have to ask twice."
      await enqueueDestructionFor(messageId);
    }
    return reply.redirect(`/holds${back}&flash=${action}`);
  }

  app.post<{ Params: { holdId: string } }>('/holds/:holdId/release', (req, reply) =>
    outcome(req, reply, 'release'),
  );
  app.post<{ Params: { holdId: string } }>('/holds/:holdId/destroy', (req, reply) =>
    outcome(req, reply, 'destroy'),
  );
  app.post<{ Params: { holdId: string } }>('/holds/:holdId/escalate', (req, reply) =>
    outcome(req, reply, 'escalate'),
  );

  /** Whether one message is currently protected, for the Messages browser. */
  app.get<{ Params: { messageId: string } }>('/holds/state/:messageId', async (req, reply) => {
    const id = Number.parseInt(req.params.messageId, 10);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'bad id' });
    const hold = await liveHold(ctx.db, id);
    const blocked = await destructionBlockedBy(ctx.db, id);
    return reply.send({ held: hold !== null, state: hold?.state ?? null, blocked });
  });
}

function holdCard(
  h: HoldListRow,
  text: string | null,
  type: string | null,
  csrf: string,
  back: string,
): SafeHtml {
  const days = daysUntil(h.expiresAt);
  const expiry =
    h.state === 'escalated'
      ? badge('Never expires', 'red')
      : h.expiresAt === null
        ? badge('No expiry', 'amber')
        : days !== null && days <= EXPIRY_WARN_DAYS
          ? badge(`Expires in ${String(days)} day(s)`, 'amber')
          : badge(`Expires ${fmtDate(h.expiresAt)}`, 'slate');

  const live = h.state === 'active' || h.state === 'escalated';
  return html`
    <div class="rounded-lg border border-slate-700 bg-slate-900/60 p-4">
      <div class="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <span class="font-mono text-slate-400">message:${String(h.messageId)}</span>
        ${h.source === 'csam' ? badge('Hash match', 'red') : badge('Illegal-content report', 'blue')}
        ${h.state === 'escalated' ? badge('Escalated', 'red') : ''}
        ${h.state === 'released' ? badge(`Released (${h.outcome ?? ''})`, 'slate') : ''} ${expiry}
        ${h.destructionPending
          ? badge('Member asked for deletion', 'amber')
          : ''}
        <span class="text-slate-500">${String(h.reportCount)} illegal report(s)</span>
      </div>
      <p class="mb-3 text-sm text-slate-300">
        ${text ? truncate(text, 240) : html`<em class="text-slate-500">No preview available.</em>`}
        ${type ? html`<span class="ml-2 text-xs text-slate-500">(${type})</span>` : ''}
      </p>
      ${h.destructionPending
        ? html`<p class="mb-3 text-xs text-amber-300">
            This member has asked for this content to be destroyed. It is already hidden from the
            public archive. Releasing the hold runs that deletion; escalating blocks it for good.
          </p>`
        : ''}
      ${live
        ? html`<div class="flex flex-wrap gap-2">
            ${h.state === 'active'
              ? actionButton('Release', `/holds/${String(h.id)}/release`, csrf, back, 'green')
              : ''}
            <!-- Rule 1: no destroy control for a hash match, and none once escalated. -->
            ${h.source === 'csam' || h.state === 'escalated'
              ? ''
              : actionButton('Destroy', `/holds/${String(h.id)}/destroy`, csrf, back, 'red')}
            ${h.state === 'active'
              ? actionButton('Escalate', `/holds/${String(h.id)}/escalate`, csrf, back, 'slate')
              : ''}
            <a
              class="rounded bg-slate-800 px-3 py-1 text-sm"
              href="/messages?id=${String(h.messageId)}"
              >Manage in Messages</a
            >
          </div>`
        : html`<p class="text-xs text-slate-500">
            Resolved ${h.resolvedAt ? fmtDate(h.resolvedAt) : ''} by ${h.resolvedBy ?? 'unknown'}.
          </p>`}
      ${h.source === 'csam' && live
        ? html`<p class="mt-2 text-xs text-red-300">
            A hash match cannot be destroyed here. Destroying it would remove the evidence. Release
            it only after a verified false positive, or escalate it.
          </p>`
        : ''}
    </div>
  `;
}
