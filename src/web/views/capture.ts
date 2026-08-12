/**
 * The Capture page (CCB-S5-033, D-190).
 *
 * Which bot records which room, and the one control that changes it.
 *
 * ── WHY ASSIGNING IS A WARNING AND NOT A REFUSAL ─────────────────────────────
 *
 * Giving capture to a second bot in a room that already has one is not an error - it is a
 * reasonable thing to want, and the operator may well be moving it deliberately. Refusing
 * silently would be wrong; allowing it silently is how the archive came to hold two of
 * everything. So the page says what will happen, says that switching is possible, and asks.
 *
 * ── AND WHY SWITCHING IS ONE ACTION ──────────────────────────────────────────
 *
 * Not "turn one off, then turn the other on". Between those two steps the room captures
 * NOTHING and nobody is told, and a crash in the gap leaves it that way. `assignCapture`
 * clears the room's other records and writes the new one in a single transaction.
 */

import type { FastifyInstance } from 'fastify';
import type { ViewContext } from '../server.js';
import { html, page } from '../html.js';
import { badge, card, fmtDate, pageHeader } from './ui.js';
import { captureRoomState } from '../../capture/room-service.js';
import {
  assignCapture,
  clearCaptureAssignments,
  listCaptureAssignments,
} from '../../db/capture-assignments.js';
import { clearEndedRoomRecord, leaveRoom } from '../../bot/runtime/admin-actions.js';
import { describeChatError } from '../../bot/runtime/chat-error.js';
import { listMembershipChanges, recordMembershipChange } from '../../db/group-memberships.js';
import { listBotOnboardingProfiles } from '../../profiles/bot-onboarding.js';
import { runtimeAdminAvailable } from '../../bot/runtime/admin-actions.js';
import { writeAudit } from '../../db/audit.js';
import { log } from '../../log.js';

function bodyStr(body: unknown, key: string): string {
  const v = (body as Record<string, unknown> | null)?.[key];
  return typeof v === 'string' ? v : '';
}

function bodyInt(body: unknown, key: string): number | null {
  const v = (body as Record<string, unknown> | null)?.[key];
  const raw = typeof v === 'string' ? v.trim() : '';
  if (raw === '') return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function registerCapturePage(app: FastifyInstance, ctx: ViewContext): void {
  const { db } = ctx;

  app.get<{
    Querystring: {
      saved?: string;
      error?: string;
      confirm?: string;
      to?: string;
      leaving?: string;
      bot?: string;
      mode?: string;
    };
  }>(
    '/capture',
    async (req, reply) => {
      const csrf = req.session?.csrfToken ?? '';
      const { rooms, decisions } = captureRoomState();
      const profiles = await listBotOnboardingProfiles(db);
      const assignments = await listCaptureAssignments(db);
      const history = await listMembershipChanges(db, 25);

      const nameOf = (botProfileId: number | null): string =>
        botProfileId === null
          ? 'nobody'
          : (profiles.find((p) => p.id === botProfileId)?.displayName ??
            `bot ${String(botProfileId)}`);

      /** The confirmation the operator is being asked for, if any. */
      const pending = req.query.confirm ?? '';
      /** The record a leave/clear confirmation is about, if any. */
      const leaving = req.query.leaving ? Number.parseInt(req.query.leaving, 10) : null;
      const leavingBot = req.query.bot ? Number.parseInt(req.query.bot, 10) : null;

      reply.type('text/html');
      return page({
        title: 'Capture',
        active: 'capture',
        csrfToken: csrf,
        body: html`
          ${pageHeader(
            'Capture',
            'Which bot records which room. One bot captures a room; the others are still in it and still answer.',
          )}
          ${req.query.saved
            ? html`<div class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Saved.</div>`
            : ''}
          ${req.query.error
            ? html`<div class="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">${req.query.error}</div>`
            : ''}

          ${!runtimeAdminAvailable()
            ? html`<div class="mb-4 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                The bot is not running, so the rooms below are whatever was last read. Start it to
                see the current membership.
              </div>`
            : ''}

          ${card(
            'Rooms',
            html`<div class="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <strong>Two different things, and both are shown here.</strong>
                The <em>capability</em> (on the
                <a class="underline" href="/plugins">Plugins</a> page) means a bot MAY capture.
                The <em>assignment</em> means it DOES, in one particular room. A room has exactly
                one capturing bot, so in a room two bots share, both can have the capability on
                and only one of them records it. That is not a fault and it is why "on for both"
                and "Cinderella is capturing it" are both true at once.
              </div>
              <p class="mb-3 text-sm text-slate-500">
                A room is one real group. It can appear more than once in the core - once per bot
                that is in it, and once more for a membership that ended - so the rows below are
                grouped by the members they share rather than by name. The name shown is the
                group's own, not the core's local alias.
              </p>
              ${rooms.length === 0
                ? html`<p class="text-sm text-slate-500">No rooms known yet.</p>`
                : html`${decisions.map((d) => {
                    const room = rooms.find((r) => r.key === d.roomKey);
                    if (room === undefined) return html``;
                    return html`<div class="mb-4 rounded-lg border ${d.conflict ? 'border-amber-300 bg-amber-50' : 'border-slate-200'} p-3">
                      <div class="mb-2 flex flex-wrap items-center gap-2">
                        <strong class="text-sm">${room.displayName}</strong>
                        ${d.botProfileId === null
                          ? badge('captured by nobody', 'slate')
                          : badge(`captured by ${nameOf(d.botProfileId)}`, d.conflict ? 'amber' : 'green')}
                        ${d.how === 'assigned' ? badge('you chose this', 'green') : ''}
                        ${d.how === 'elected' ? badge('chosen automatically', 'amber') : ''}
                        ${d.how === 'only' ? badge('the only one here', 'slate') : ''}
                      </div>

                      ${d.conflict
                        ? html`<p class="mb-3 text-sm text-amber-900">
                            <strong>More than one bot could capture this room.</strong>
                            ${nameOf(d.botProfileId)} is doing it, chosen automatically because
                            nobody has decided, so the archive keeps one copy rather than two.
                            Choose below to make it deliberate.
                          </p>`
                        : ''}

                      <table class="mb-3 w-full text-left text-sm">
                        <thead>
                          <tr class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                            <th class="py-1 pr-3">Bot</th><th class="py-1 pr-3">Group id</th>
                            <th class="py-1 pr-3">Membership</th><th class="py-1 pr-3">Captures</th><th class="py-1"></th>
                          </tr>
                        </thead>
                        <tbody>
                          ${room.records.map(
                            (rec) => html`<tr class="border-b border-slate-100">
                              <td class="py-1 pr-3">${nameOf(rec.botProfileId)}</td>
                              <td class="py-1 pr-3 text-slate-500">${String(rec.groupId)}</td>
                              <td class="py-1 pr-3">${rec.active ? badge('current', 'green') : badge('ended', 'slate')}</td>
                              <td class="py-1 pr-3">
                                ${rec.active && rec.botProfileId === d.botProfileId && rec.groupId === d.groupId
                                  ? badge('yes', 'green')
                                  : html`<span class="text-slate-400">no</span>`}
                              </td>
                              <td class="py-1">
                                ${leaving === rec.groupId && leavingBot === rec.botProfileId
                                  ? html`<form method="post" action="/capture/leave" class="flex flex-wrap items-center gap-2">
                                      <input type="hidden" name="_csrf" value="${csrf}" />
                                      <input type="hidden" name="botProfileId" value="${String(rec.botProfileId)}" />
                                      <input type="hidden" name="groupId" value="${String(rec.groupId)}" />
                                      <input type="hidden" name="mode" value="${rec.active ? 'leave' : 'clear'}" />
                                      <input type="hidden" name="confirmed" value="yes" />
                                      <span class="text-xs text-amber-900">
                                        ${rec.active
                                          ? html`<strong>Leave "${room.displayName}" as ${nameOf(rec.botProfileId)}?</strong>
                                              The group is told. Rejoining needs a fresh link. Everything already
                                              archived from this room stays: the messages remain, stay published if
                                              their sender consented, and stay searchable. Leaving stops new
                                              messages arriving; it does not retract the old ones.`
                                          : html`<strong>Clear the leftover record for "${room.displayName}"?</strong>
                                              This membership is already over; only the local row goes. The archive
                                              is untouched.`}
                                      </span>
                                      <button type="submit" class="rounded-lg bg-red-700 px-2 py-1 text-xs font-medium text-white hover:bg-red-600">
                                        ${rec.active ? 'Yes, leave it' : 'Yes, clear it'}
                                      </button>
                                      <a href="/capture" class="rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100">Cancel</a>
                                    </form>`
                                  : html`<form method="post" action="/capture/leave">
                                      <input type="hidden" name="_csrf" value="${csrf}" />
                                      <input type="hidden" name="botProfileId" value="${String(rec.botProfileId)}" />
                                      <input type="hidden" name="groupId" value="${String(rec.groupId)}" />
                                      <input type="hidden" name="mode" value="${rec.active ? 'leave' : 'clear'}" />
                                      <button type="submit" class="rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100">
                                        ${rec.active ? 'Leave' : 'Clear record'}
                                      </button>
                                    </form>`}
                              </td>
                            </tr>`,
                          )}
                        </tbody>
                      </table>

                      ${pending === d.roomKey
                        ? html`<div class="rounded-lg border border-amber-400 bg-white p-3">
                            <p class="mb-2 text-sm text-slate-800">
                              <strong>Switch capture to ${nameOf(bodyIntFromQuery(req.query))}?</strong>
                              ${nameOf(d.botProfileId)} stops recording this room and
                              ${nameOf(bodyIntFromQuery(req.query))} starts, in one step, so nothing
                              is recorded twice and nothing is missed in between.
                            </p>
                            <p class="mb-3 text-xs text-slate-600">
                              What this does NOT change: everything already archived stays exactly as
                              it is, and consent is unaffected. A member who opted in stays opted in,
                              because consent is recorded per member and not per bot or per room.
                              What it does change: messages from now on are recorded by the new bot.
                            </p>
                            <form method="post" action="/capture/assign" class="flex gap-2">
                              <input type="hidden" name="_csrf" value="${csrf}" />
                              <input type="hidden" name="roomKey" value="${d.roomKey}" />
                              <input type="hidden" name="botProfileId" value="${String(bodyIntFromQuery(req.query) ?? '')}" />
                              <input type="hidden" name="confirmed" value="yes" />
                              <button type="submit" class="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500">
                                Yes, switch it
                              </button>
                              <a href="/capture" class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">Cancel</a>
                            </form>
                          </div>`
                        : html`<form method="post" action="/capture/assign" class="flex flex-wrap items-end gap-2">
                            <input type="hidden" name="_csrf" value="${csrf}" />
                            <input type="hidden" name="roomKey" value="${d.roomKey}" />
                            <label class="block">
                              <span class="mb-1 block text-xs font-medium text-slate-700">Capture this room with</span>
                              <select name="botProfileId" class="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                                ${room.records
                                  .filter((r) => r.active)
                                  .map(
                                    (r) => html`<option value="${String(r.botProfileId)}" ${r.botProfileId === d.botProfileId ? 'selected' : ''}>
                                      ${nameOf(r.botProfileId)}
                                    </option>`,
                                  )}
                              </select>
                            </label>
                            <button type="submit" class="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">
                              Set
                            </button>
                            ${assignments.some((a) =>
                              room.records.some((r) => r.botProfileId === a.botProfileId && r.groupId === a.groupId),
                            )
                              ? html`<button
                                  type="submit"
                                  formaction="/capture/clear"
                                  class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
                                >
                                  Let it choose automatically
                                </button>`
                              : ''}
                          </form>`}
                    </div>`;
                  })}`}`,
          )}

          ${card(
            'Membership history',
            html`<p class="mb-3 text-sm text-slate-500">
                When a bot joined or left a room, and how. A join by link used to leave no trace
                anywhere, which is why one went unnoticed.
              </p>
              ${history.length === 0
                ? html`<p class="text-sm text-slate-500">Nothing recorded yet.</p>`
                : html`<table class="w-full text-left text-sm">
                    <tbody>
                      ${history.map(
                        (h) => html`<tr class="border-b border-slate-100">
                          <td class="whitespace-nowrap py-2 pr-3 text-slate-500">${fmtDate(h.at.toISOString())}</td>
                          <td class="py-2 pr-3">${nameOf(h.botProfileId)}</td>
                          <td class="py-2 pr-3">${h.change === 'joined' ? badge('joined', 'green') : badge('left', 'slate')}</td>
                          <td class="py-2 pr-3">${h.groupName}</td>
                          <td class="py-2 text-slate-500">${h.how}</td>
                        </tr>`,
                      )}
                    </tbody>
                  </table>`}`,
          )}
        `,
      });
    },
  );

  /* ── actions ──────────────────────────────────────────────────────────────── */

  app.post<{ Body: Record<string, unknown> }>('/capture/assign', async (req, reply) => {
    const roomKey = bodyStr(req.body, 'roomKey');
    const botProfileId = bodyInt(req.body, 'botProfileId');
    const confirmed = req.body['confirmed'] === 'yes';
    const { rooms, decisions } = captureRoomState();
    const room = rooms.find((r) => r.key === roomKey);
    const decision = decisions.find((d) => d.roomKey === roomKey);
    if (room === undefined || decision === undefined || botProfileId === null) {
      return reply.redirect('/capture?error=No+such+room.');
    }

    // THE WARNING. Assigning to a bot that is not the current capturer, in a room that
    // already has one, asks first and says what switching does.
    const alreadyCaptured = decision.botProfileId !== null;
    const changing = decision.botProfileId !== botProfileId;
    if (alreadyCaptured && changing && !confirmed) {
      return reply.redirect(
        `/capture?confirm=${encodeURIComponent(roomKey)}&to=${String(botProfileId)}`,
      );
    }

    const record = room.records.find((r) => r.botProfileId === botProfileId && r.active);
    if (record === undefined) {
      return reply.redirect(
        `/capture?error=${encodeURIComponent('That bot is not currently a member of that room.')}`,
      );
    }

    // ONE ACTION: the room's other records are cleared and this one written together.
    await assignCapture(
      db,
      { botProfileId, groupId: record.groupId },
      room.records.map((r) => ({ botProfileId: r.botProfileId, groupId: r.groupId })),
      req.session?.username ?? 'unknown',
    );
    await writeAudit(db, req.session?.username ?? 'unknown', 'capture.assign', `room:${roomKey}`, {
      botProfileId,
      groupId: record.groupId,
    });
    log.info('capture: the operator assigned a room', {
      room: room.displayName,
      botProfileId,
      groupId: record.groupId,
    });
    return reply.redirect('/capture?saved=1');
  });

  /**
   * Leave a room, or clear the record of one already left.
   *
   * Two operations, not one button with a mode. Leaving ANNOUNCES a departure and is
   * irreversible from the product's side; clearing removes a local row for a membership that
   * is already over. `clearEndedRoomRecord` refuses while the membership is current, because
   * deleting the record of a group the bot is still in would leave it there with nothing here
   * to show it and no way out.
   */
  app.post<{ Body: Record<string, unknown> }>('/capture/leave', async (req, reply) => {
    const botProfileId = bodyInt(req.body, 'botProfileId');
    const groupId = bodyInt(req.body, 'groupId');
    const mode = bodyStr(req.body, 'mode') === 'clear' ? 'clear' : 'leave';
    if (botProfileId === null || groupId === null) {
      return reply.redirect('/capture?error=Pick+a+room+first.');
    }
    // Named confirmation. Leaving is not undoable from here: rejoining needs a link the bot
    // does not keep.
    if (bodyStr(req.body, 'confirmed') !== 'yes') {
      return reply.redirect(
        `/capture?leaving=${String(groupId)}&bot=${String(botProfileId)}&mode=${mode}`,
      );
    }
    try {
      const record =
        mode === 'clear'
          ? await clearEndedRoomRecord(botProfileId, groupId)
          : await leaveRoom(botProfileId, groupId);
      await writeAudit(
        db,
        req.session?.username ?? 'unknown',
        mode === 'clear' ? 'capture.record.clear' : 'capture.room.leave',
        `group:${String(groupId)}`,
        { botProfileId, room: record.displayName },
      );
      if (mode === 'leave') {
        // The history the operator had none of: which bot, which room, when, how.
        await recordMembershipChange(db, {
          botProfileId,
          simplexUserId: 0,
          groupId,
          groupName: record.displayName,
          change: 'left',
          how: 'console',
        });
      }
      return reply.redirect('/capture?saved=1');
    } catch (err) {
      const message = describeChatError(err);
      log.error(`capture console: ${mode} failed`, { botProfileId, groupId, error: message });
      return reply.redirect(`/capture?error=${encodeURIComponent(message)}`);
    }
  });

  app.post<{ Body: Record<string, unknown> }>('/capture/clear', async (req, reply) => {
    const roomKey = bodyStr(req.body, 'roomKey');
    const { rooms } = captureRoomState();
    const room = rooms.find((r) => r.key === roomKey);
    if (room === undefined) return reply.redirect('/capture?error=No+such+room.');
    await clearCaptureAssignments(
      db,
      room.records.map((r) => ({ botProfileId: r.botProfileId, groupId: r.groupId })),
    );
    await writeAudit(db, req.session?.username ?? 'unknown', 'capture.clear', `room:${roomKey}`, {});
    return reply.redirect('/capture?saved=1');
  });
}

/** The bot the pending confirmation is about, carried on the querystring. */
function bodyIntFromQuery(q: { to?: string } & Record<string, unknown>): number | null {
  const raw = typeof q.to === 'string' ? q.to.trim() : '';
  if (raw === '') return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}
