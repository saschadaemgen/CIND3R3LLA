/**
 * The Music Library console (CCB-S5-044, D-216/D-217).
 *
 * Everything visible and configurable: the library with its real storage cost,
 * upload with the tag read back to the operator instead of retyped, playlists,
 * per-bot assignment with the cadence per assignment, the two unbidden budgets,
 * and the diagnostics with every skip counted.
 *
 * TWO THINGS ARE DELIBERATELY NOT SETTABLE, and the page says so beside them:
 * the send shape (the cover decides it: one video message with a cover, title
 * plus bare voice player without - the Stage-0 proof, not a preference), and
 * shuffle-without-replacement (every track plays once before any repeats;
 * derived from the plays log, so there is no cycle state to configure or lose).
 */

import type { FastifyInstance } from 'fastify';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { ViewContext } from '../server.js';
import { html, page, type SafeHtml } from '../html.js';
import { badge, card, factList, fmtDate, pageHeader, scopePanel, type ScopeLine } from './ui.js';
import { listBotOnboardingProfiles } from '../../profiles/bot-onboarding.js';
import { resolveSelectedBot } from '../selected-bot.js';
import { writeAudit } from '../../db/audit.js';
import { status } from '../status.js';
import { log } from '../../log.js';
import {
  assignPlaylist,
  assignmentsForBot,
  createPlaylist,
  deletePlaylist,
  deleteTrack,
  getAssignment,
  getTrack,
  insertTrack,
  libraryFacts,
  listPlaylists,
  listTracks,
  playlistTracks,
  removeAssignment,
  setAssignmentCadence,
  setAssignmentOnRequest,
  setPlaylistTracks,
  updateTrackMeta,
  TRACK_KINDS,
  type TrackKind,
} from '../../plugins/music/store.js';
import {
  libraryDiskUsage,
  readTags,
  removeTrackFiles,
  storeTrackCover,
  storeTrackFile,
} from '../../plugins/music/library.js';
import { enqueueMusicEncode } from '../../queue/jobs/music.js';
import { ENCODE_VERSION } from '../../media/encode.js';
import { musicDiagnostics } from '../../plugins/music/music-log.js';
import { MUSIC_ID, MUSIC_UPLOADS_ID } from '../../plugins/music/plugin.js';
import {
  describePluginScopes,
  PLUGIN_SETTING_SCOPES,
  type PluginScopeView,
} from '../../plugins/scope.js';
import { listAllPluginOverrides } from '../../db/plugin-overrides.js';
import { MEMBER_UPLOAD_EXTENSIONS } from '../../plugins/music/settings.js';

const INPUT_CLS = 'w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm';

/** Uploads arrive as base64 form fields, the recital-image pattern (no multipart). */
const TRACK_MAX_BYTES = 100 * 1024 * 1024;
const COVER_MAX_BYTES = 8 * 1024 * 1024;

function bodyString(body: unknown, key: string): string {
  const value = (body as Record<string, unknown> | null)?.[key];
  return typeof value === 'string' ? value : '';
}

function bodyInt(body: unknown, key: string): number | null {
  const raw = bodyString(body, key).trim();
  if (raw === '') return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function labelled(text: string, control: SafeHtml, help?: string): SafeHtml {
  return html`<label class="block">
    <span class="mb-1 block text-sm font-medium text-slate-700">${text}</span>
    ${control}
    ${help ? html`<span class="mt-1 block text-xs text-slate-500">${help}</span>` : ''}
  </label>`;
}

const AUDIO_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
};

function mimeForName(name: string): string {
  const ext = /\.[A-Za-z0-9]{1,5}$/.exec(name.toLowerCase())?.[0] ?? '';
  return AUDIO_MIME[ext] ?? 'application/octet-stream';
}

/**
 * Adaptive, because "0.0 MB" over a non-empty library reads as "nothing stored"
 * (D-212: the first screenshot showed exactly that over a 14 KB fixture).
 */
function mb(bytes: number): string {
  if (bytes === 0) return '0 bytes';
  if (bytes < 1024 * 1024) return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function musicScopePanel(
  scopes: Map<string, PluginScopeView>,
  bots: readonly { id: number; displayName: string }[],
  selectedBotId: number | null,
  assignmentCount: number,
): SafeHtml | null {
  const lines: ScopeLine[] = [];
  for (const p of PLUGIN_SETTING_SCOPES) {
    if (p.pluginId !== MUSIC_ID && p.pluginId !== MUSIC_UPLOADS_ID) continue;
    const v = scopes.get(`${p.pluginId}:${p.key}`);
    if (!v) continue;
    lines.push({
      key: p.label,
      scope: v.scope,
      deviatingBotIds: v.deviatingBotIds,
      sharedBotCount: v.sharedBotCount,
      reason: p.reason,
    });
  }
  lines.push({
    key: 'Playlist assignments and their cadences',
    scope: 'per-bot',
    deviatingBotIds: [],
    sharedBotCount: 0,
    badge: `per bot: ${String(assignmentCount)} here`,
    reason:
      'Rows rather than settings, so there is no shared value to inherit: a bot with no assignment holds no playlist.',
  });
  lines.push({
    key: 'Tracks and playlists themselves',
    scope: 'other',
    deviatingBotIds: [],
    sharedBotCount: 0,
    badge: 'the library: one per deployment',
    reason:
      'The library is the deployment’s shelf; which bot may play from it is what the assignments decide. Switching the bot above changes the assignments shown, never the shelf.',
  });
  return scopePanel({ lines, bots: [...bots], selectedBotId, switcherHref: null });
}

export function registerMusic(app: FastifyInstance, ctx: ViewContext): void {
  const { db, plugins, cfg } = ctx;

  app.get<{ Querystring: { bot?: string; saved?: string; error?: string; notice?: string } }>(
    '/music',
    async (req, reply) => {
      const csrf = req.session?.csrfToken ?? '';
      const botProfiles = await listBotOnboardingProfiles(db);
      const selection = resolveSelectedBot(
        botProfiles,
        req.query.bot,
        req.session?.selectedBotProfileId ?? null,
      );
      const selectedBotId = selection.selectedId;

      const tracks = await listTracks(db);
      const playlists = await listPlaylists(db);
      const assignments = selectedBotId === null ? [] : await assignmentsForBot(db, selectedBotId);
      const facts = await libraryFacts(db, new Date());
      const usage = await libraryDiskUsage(cfg.musicRoot);
      const settings = plugins.musicSettings();
      const diag = musicDiagnostics();
      const overrides = (await listAllPluginOverrides(db)).filter(
        (o) => o.pluginId === MUSIC_ID || o.pluginId === MUSIC_UPLOADS_ID,
      );
      const pluginScopes = describePluginScopes(overrides, botProfiles.length);

      const playlistContents = new Map<number, Awaited<ReturnType<typeof playlistTracks>>>();
      for (const pl of playlists) playlistContents.set(pl.id, await playlistTracks(db, pl.id));

      const kindOptions = (selected: TrackKind): SafeHtml =>
        html`${TRACK_KINDS.map(
          (k) => html`<option value="${k}" ${k === selected ? html`selected` : ''}>${k}</option>`,
        )}`;

      reply.type('text/html');
      return page({
        title: 'Music Library',
        active: 'plugins',
        csrfToken: csrf,
        botSwitcher: { ...selection, returnTo: '/music' },
        body: html`
          ${pageHeader(
            'Music Library',
            selection.selectedName
              ? `One library for the deployment; what ${selection.selectedName} may play from it ` +
                `is the assignments below, which are ${selection.selectedName}'s alone. The ` +
                `budgets and the upload bound are deployment-wide.`
              : 'One library for the deployment; per-bot playlists decide who plays what.',
          )}
          ${req.query.saved
            ? html`<div class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Saved.</div>`
            : ''}
          ${req.query.error
            ? html`<div class="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">${req.query.error}</div>`
            : ''}
          ${req.query.notice
            ? html`<div class="mb-4 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900">${req.query.notice}</div>`
            : ''}

          ${card(
            'The library, and what it costs',
            html`${factList([
                ['Tracks', String(facts.totalTracks)],
                [
                  'By kind',
                  facts.byKind.length === 0
                    ? 'none yet'
                    : facts.byKind.map((k) => `${k.kind}: ${String(k.count)}`).join(', '),
                ],
                [
                  'Genres held',
                  facts.byGenre.length === 0
                    ? 'none tagged yet'
                    : facts.byGenre.map((g) => `${g.genre} (${String(g.count)})`).join(', '),
                ],
                ['Originals and covers on disk', mb(usage.originalsBytes)],
                [
                  'Cached encodes on disk',
                  `${mb(usage.encodedBytes)} (your decision: cached, so a repeat send never re-encodes)`,
                ],
                [
                  'Most played',
                  facts.mostPlayed.length === 0
                    ? 'nothing played yet'
                    : facts.mostPlayed.map((t) => `${t.title} (${String(t.plays)}x)`).join(', '),
                ],
                [
                  'Popular this week',
                  facts.popularNow.length === 0
                    ? 'nothing this week'
                    : facts.popularNow.map((t) => `${t.title} (${String(t.plays)}x)`).join(', '),
                ],
              ])}
              <p class="mt-2 text-xs text-slate-500">
                These same figures, minus the disk numbers, are what she is handed when a member
                asks about her library: the genre list above IS her vocabulary, so she cannot
                claim a genre this page does not show. The two list answers are locked; the
                model writes an opening line and never the list.
              </p>`,
          )}

          ${card(
            'Upload tracks',
            html`<div data-music-upload data-action="/music/tracks/upload" data-max-bytes="${String(TRACK_MAX_BYTES)}" class="flex flex-col gap-3">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <p class="text-sm text-slate-500">
                Choose one file or a whole album. Each file gets its own row below, pre-filled
                from its tag; correct anything the tag got wrong before uploading. A track
                without a cover is a normal state: it sends as a title line plus the bare
                voice player instead of the one-message video. Covers are encoded in the
                background after upload, so this page answers immediately.
              </p>
              ${labelled(
                'Audio files',
                html`<input type="file" accept="audio/*" multiple class="${INPUT_CLS}" />`,
                `Up to ${mb(TRACK_MAX_BYTES)} each; read locally, posted one at a time.`,
              )}
              <div data-music-rows class="flex flex-col gap-3"></div>
              <div class="flex items-center gap-2">
                <button type="button" data-music-submit class="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40">
                  Upload all
                </button>
                <span data-music-status class="text-xs text-slate-500"></span>
              </div>
              <noscript>
                <p class="text-sm text-red-700">
                  This uploader needs JavaScript; the console's scripts are served from its own
                  origin and nothing else.
                </p>
              </noscript>
            </div>
            <script src="/assets/admin-music-upload.js" defer></script>`,
          )}

          ${card(
            'Tracks',
            tracks.length === 0
              ? html`<p class="text-sm text-slate-500">None yet. Upload one above.</p>`
              : html`<div class="overflow-x-auto">
                  <table class="w-full text-left text-sm">
                    <thead>
                      <tr class="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                        <th class="py-2 pr-3">Track</th>
                        <th class="py-2 pr-3">Kind / genre</th>
                        <th class="py-2 pr-3">Cover / encode</th>
                        <th class="py-2 pr-3">Add to playlist</th>
                        <th class="py-2">Remove</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${tracks.map(
                        (t) => html`<tr class="border-b border-slate-100 align-top">
                          <td class="py-2 pr-3">
                            <form method="post" action="/music/tracks/${String(t.id)}/meta" class="flex flex-col gap-1">
                              <input type="hidden" name="_csrf" value="${csrf}" />
                              <input type="text" name="title" value="${t.title}" class="${INPUT_CLS}" />
                              <input type="text" name="artist" value="${t.artist ?? ''}" placeholder="artist" class="${INPUT_CLS}" />
                              <div class="text-xs text-slate-500">
                                ${t.durationSeconds === null ? 'duration unknown' : `${String(Math.floor(t.durationSeconds / 60))}:${String(t.durationSeconds % 60).padStart(2, '0')}`},
                                ${mb(t.fileSize)}
                              </div>
                              <div class="flex gap-1">
                                <select name="kind" class="${INPUT_CLS}">${kindOptions(t.kind)}</select>
                                <input type="text" name="genre" value="${t.genre ?? ''}" placeholder="genre" class="${INPUT_CLS}" />
                              </div>
                              <button type="submit" class="self-start rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100">Save</button>
                            </form>
                          </td>
                          <td class="py-2 pr-3">${badge(t.kind, t.kind === 'spot' ? 'amber' : 'slate')}<div class="mt-1 text-xs text-slate-500">${t.genre ?? 'no genre'}</div></td>
                          <td class="py-2 pr-3">
                            <div class="mb-1 flex flex-wrap gap-1">
                              ${t.coverPath !== null ? badge('cover', 'green') : badge('no cover: sends as voice', 'slate')}
                              ${t.encodedPath !== null ? badge('encoded', 'green') : t.coverPath !== null ? badge('encode queued', 'slate') : ''}
                            </div>
                            <form method="post" action="/music/tracks/${String(t.id)}/cover" data-image-upload class="flex flex-col gap-1">
                              <input type="hidden" name="_csrf" value="${csrf}" />
                              <input type="hidden" name="imageData" value="" />
                              <input type="file" accept="image/*" class="text-xs" />
                              <div class="flex items-center gap-1">
                                <button type="submit" class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100">
                                  ${t.coverPath !== null ? 'Replace cover' : 'Add cover'}
                                </button>
                                <span data-image-upload-status class="text-xs text-slate-500"></span>
                              </div>
                            </form>
                          </td>
                          <td class="py-2 pr-3">
                            ${playlists.length === 0
                              ? html`<span class="text-xs text-slate-500">create a playlist first</span>`
                              : html`<form method="post" action="/music/playlists/add-track" class="flex gap-1">
                                  <input type="hidden" name="_csrf" value="${csrf}" />
                                  <input type="hidden" name="trackId" value="${String(t.id)}" />
                                  <select name="playlistId" class="${INPUT_CLS}">
                                    ${playlists.map((pl) => html`<option value="${String(pl.id)}">${pl.name}</option>`)}
                                  </select>
                                  <button type="submit" class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100">Add</button>
                                </form>`}
                          </td>
                          <td class="py-2">
                            <form method="post" action="/music/tracks/${String(t.id)}/delete" class="flex items-center gap-1">
                              <input type="hidden" name="_csrf" value="${csrf}" />
                              <label class="flex items-center gap-1 text-xs text-slate-600">
                                <input type="checkbox" name="confirm" required class="rounded" /> delete, with its file and plays
                              </label>
                              <button type="submit" class="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50">Delete</button>
                            </form>
                          </td>
                        </tr>`,
                      )}
                    </tbody>
                  </table>
                </div>`,
          )}

          ${card(
            'Playlists',
            html`<p class="mb-3 text-sm text-slate-500">
                The unit of assignment: a playlist can go to several bots and a track can sit in
                several playlists, so two hundred tracks and five bots stay five decisions.
              </p>
              ${playlists.length === 0
                ? html`<p class="mb-3 text-sm text-slate-500">None yet.</p>`
                : playlists.map((pl) => {
                    const contents = playlistContents.get(pl.id) ?? [];
                    return html`<div class="mb-3 rounded-lg border border-slate-200 p-3">
                      <div class="mb-1 flex items-center gap-2">
                        <span class="text-sm font-medium">${pl.name}</span>
                        ${badge(`${String(contents.length)} track${contents.length === 1 ? '' : 's'}`, 'slate')}
                        <form method="post" action="/music/playlists/${String(pl.id)}/delete" class="ml-auto flex items-center gap-1">
                          <input type="hidden" name="_csrf" value="${csrf}" />
                          <label class="flex items-center gap-1 text-xs text-slate-600">
                            <input type="checkbox" name="confirm" required class="rounded" /> delete (tracks stay)
                          </label>
                          <button type="submit" class="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50">Delete</button>
                        </form>
                      </div>
                      ${contents.length === 0
                        ? html`<p class="text-xs text-slate-500">Empty; add tracks from the table above.</p>`
                        : html`<ul class="text-sm text-slate-600">
                            ${contents.map(
                              (t) => html`<li class="flex items-center gap-2 py-0.5">
                                ${t.title}
                                <form method="post" action="/music/playlists/${String(pl.id)}/remove-track" class="ml-auto">
                                  <input type="hidden" name="_csrf" value="${csrf}" />
                                  <input type="hidden" name="trackId" value="${String(t.id)}" />
                                  <button type="submit" class="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100">Remove</button>
                                </form>
                              </li>`,
                            )}
                          </ul>`}
                    </div>`;
                  })}
              <form method="post" action="/music/playlists/create" class="flex gap-2">
                <input type="hidden" name="_csrf" value="${csrf}" />
                <input type="text" name="name" placeholder="New playlist name" class="${INPUT_CLS} grow" />
                <button type="submit" class="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">Create</button>
              </form>`,
          )}

          ${card(
            selection.selectedName
              ? `What ${selection.selectedName} plays`
              : 'Assignments',
            html`<p class="mb-3 text-sm text-slate-500">
                Every new assignment starts ON REQUEST: she answers questions and plays when
                asked, and never unbidden. A cadence is a deliberate second step, per
                assignment, with the bridge's rhythm: every N minutes, every N member
                messages, whichever comes first. Track choice on the cadence is shuffle
                without replacement: every track plays once before any repeats.
              </p>
              ${assignments.length === 0
                ? html`<p class="mb-3 text-sm text-slate-500">
                    ${selection.selectedName ?? 'This bot'} holds no playlists yet.
                  </p>`
                : assignments.map(
                    (a) => html`<div class="mb-3 rounded-lg border border-slate-200 p-3">
                      <div class="mb-2 flex flex-wrap items-center gap-2">
                        <span class="text-sm font-medium">${a.playlistName}</span>
                        ${badge(a.mode, a.mode === 'cadence' ? 'green' : 'slate')}
                        ${a.mode === 'cadence'
                          ? html`<span class="text-xs text-slate-500">
                              into group ${String(a.destGroupId)}, last sent
                              ${a.lastSentAt ? fmtDate(a.lastSentAt.toISOString()) : 'never'}
                            </span>`
                          : ''}
                      </div>
                      <form method="post" action="/music/assignments/${String(a.id)}/cadence" class="mb-2 grid gap-2 md:grid-cols-4">
                        <input type="hidden" name="_csrf" value="${csrf}" />
                        ${labelled('Destination group id', html`<input type="number" name="destGroupId" value="${a.destGroupId === null ? '' : String(a.destGroupId)}" min="1" class="${INPUT_CLS}" />`)}
                        ${labelled('Every N minutes', html`<input type="number" name="intervalMinutes" value="${a.intervalMinutes === null ? '' : String(a.intervalMinutes)}" min="1" max="10080" class="${INPUT_CLS}" />`, 'Empty switches this trigger off.')}
                        ${labelled('Every N member messages', html`<input type="number" name="messageCount" value="${a.messageCount === null ? '' : String(a.messageCount)}" min="1" max="10000" class="${INPUT_CLS}" />`, 'With both set, whichever comes first.')}
                        <div class="flex items-end gap-2">
                          <button type="submit" class="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">Set cadence</button>
                        </div>
                      </form>
                      <div class="flex flex-wrap gap-2">
                        ${a.mode === 'cadence'
                          ? html`<form method="post" action="/music/assignments/${String(a.id)}/onrequest">
                              <input type="hidden" name="_csrf" value="${csrf}" />
                              <button type="submit" class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">Back to on-request only</button>
                            </form>`
                          : ''}
                        <form method="post" action="/music/assignments/${String(a.id)}/delete">
                          <input type="hidden" name="_csrf" value="${csrf}" />
                          <button type="submit" class="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">Take the playlist away</button>
                        </form>
                      </div>
                    </div>`,
                  )}
              ${playlists.length === 0 || selectedBotId === null
                ? ''
                : html`<form method="post" action="/music/assign" class="flex items-end gap-2">
                    <input type="hidden" name="_csrf" value="${csrf}" />
                    <input type="hidden" name="botProfileId" value="${String(selectedBotId)}" />
                    ${labelled(
                      `Give ${selection.selectedName ?? 'this bot'} a playlist`,
                      html`<select name="playlistId" class="${INPUT_CLS}">
                        ${playlists.map((pl) => html`<option value="${String(pl.id)}">${pl.name}</option>`)}
                      </select>`,
                    )}
                    <button type="submit" class="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">Assign, on request</button>
                  </form>`}`,
          )}

          ${card(
            'The unbidden budgets, and the member-upload bound',
            html`<p class="mb-3 text-sm text-slate-500">
                What a ROOM may receive without anyone asking, per day, with a minimum gap.
                SEPARATE budgets for music and spots, your decision: one budget would let a
                busy music day silently buy advertising quiet, or the reverse. A member
                ASKING for a track consults neither budget.
              </p>
              <form method="post" action="/music/settings" class="grid gap-3 md:grid-cols-2">
                <input type="hidden" name="_csrf" value="${csrf}" />
                ${labelled('Unbidden music per room per day', html`<input type="number" name="musicDailyCap" value="${String(settings.musicDailyCap)}" min="1" max="48" class="${INPUT_CLS}" />`)}
                ${labelled('Minimum gap between unbidden music (minutes)', html`<input type="number" name="musicGapMinutes" value="${String(settings.musicGapMinutes)}" min="0" max="1440" class="${INPUT_CLS}" />`)}
                ${labelled('Spots per room per day', html`<input type="number" name="spotDailyCap" value="${String(settings.spotDailyCap)}" min="1" max="48" class="${INPUT_CLS}" />`)}
                ${labelled('Minimum gap between spots (minutes)', html`<input type="number" name="spotGapMinutes" value="${String(settings.spotGapMinutes)}" min="0" max="1440" class="${INPUT_CLS}" />`)}
                ${labelled(
                  'Largest member upload she plays back (bytes)',
                  html`<input type="number" name="memberUploadMaxBytes" value="${String(settings.memberUploadMaxBytes)}" min="65536" max="1073741824" class="${INPUT_CLS}" />`,
                  `She only re-sends audio (${MEMBER_UPLOAD_EXTENSIONS.join(', ')}), plays it back without keeping it, and the per-bot switch lives on the Plugins page.`,
                )}
                <div class="flex items-end">
                  <button type="submit" class="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">Save</button>
                </div>
              </form>`,
          )}

          ${musicScopePanel(pluginScopes, botProfiles, selectedBotId, assignments.length)}

          <script src="/assets/admin-image-upload.js" defer></script>

          ${card(
            'Diagnostics',
            html`${factList([
              ['Last tick', diag.lastTickAt === null ? 'not yet this process' : fmtDate(new Date(diag.lastTickAt).toISOString())],
              ['Plays sent this process', String(diag.announcementsSent)],
              [
                'Cadence slots skipped',
                Object.entries(diag.skips)
                  .filter(([, n]) => n > 0)
                  .map(([k, n]) => `${k}: ${String(n)}`)
                  .join(', ') || 'none',
              ],
              ['Last error', diag.lastError === null ? 'none this process' : `${fmtDate(new Date(diag.lastError.at).toISOString())}, ${diag.lastError.where}: ${diag.lastError.message}`],
            ])}
            <p class="mt-2 text-xs text-slate-500">
              A skipped slot is the budgets working, not a fault: budget-spent means the room
              had its fill today, gap-too-recent means the minimum quiet is being kept. Her
              played captions archive under the 'music' category, excluded from publication;
              the switch lives under Interaction, Archiving.
            </p>`,
          )}
        `,
      });
    },
  );

  /* ── actions ────────────────────────────────────────────────────────────── */

  const back = (extra: string): string => `/music?${extra}`;

  app.post<{ Body: Record<string, unknown> }>(
    '/music/tracks/upload',
    { bodyLimit: Math.ceil(TRACK_MAX_BYTES * 1.4) + 65536 },
    async (req, reply) => {
      const fileData = bodyString(req.body, 'imageData');
      const fileName = bodyString(req.body, 'fileName') || 'upload.mp3';
      const kindRaw = bodyString(req.body, 'kind');
      const kind: TrackKind = (TRACK_KINDS as readonly string[]).includes(kindRaw)
        ? (kindRaw as TrackKind)
        : 'music';
      if (fileData === '') {
        return reply.redirect(back('error=' + encodeURIComponent('No file arrived. Choose one first.')));
      }
      let bytes: Buffer;
      try {
        bytes = Buffer.from(fileData, 'base64');
      } catch {
        return reply.redirect(back('error=' + encodeURIComponent('The upload was not readable.')));
      }
      if (bytes.length === 0 || bytes.length > TRACK_MAX_BYTES) {
        return reply.redirect(back('error=' + encodeURIComponent(`The file must be between 1 byte and ${mb(TRACK_MAX_BYTES)}.`)));
      }
      // The fields the operator EDITED on the form win over the tag; the tag
      // fills only what was left empty (the pre-fill happened client-side, so a
      // blank here is a deliberate blank, not an unread one).
      const typedTitle = bodyString(req.body, 'title').trim();
      const typedArtist = bodyString(req.body, 'artist').trim();
      const typedGenre = bodyString(req.body, 'genre').trim();
      const coverData = bodyString(req.body, 'coverData');
      const wantsJson = bodyString(req.body, 'ajax') === '1';
      const fail = (message: string) => {
        log.error(`music: upload failed: ${message}`);
        status.error(`Music: upload failed: ${message}`);
        if (wantsJson) return reply.code(400).send({ ok: false, error: message.slice(0, 200) });
        return reply.redirect(back('error=' + encodeURIComponent(`Upload failed: ${message.slice(0, 200)}`)));
      };
      try {
        // Written to a temp file first so the tag reader and the prober work on
        // a real path; moved into the track's directory once the row exists.
        await mkdir(join(cfg.musicRoot, '.upload-tmp'), { recursive: true });
        const tempPath = join(cfg.musicRoot, '.upload-tmp', `${String(process.pid)}-${String(Math.floor(Math.random() * 1e9))}`);
        await writeFile(tempPath, bytes);
        const tags = await readTags(tempPath);
        const title = typedTitle || tags.title || fileName.replace(/\.[A-Za-z0-9]{1,5}$/, '');
        const trackId = await insertTrack(db, {
          kind,
          title,
          artist: typedArtist || tags.artist,
          genre: typedGenre || tags.genre,
          durationSeconds: tags.durationSeconds,
          filePath: tempPath,
          fileSize: bytes.length,
          mime: mimeForName(fileName),
          coverPath: null,
        });
        const stored = await storeTrackFile(cfg.musicRoot, trackId, tempPath, fileName);
        await db.query(`UPDATE cinderella_tracks SET file_path = $2 WHERE id = $1`, [trackId, stored.filePath]);
        // A cover chosen on the form wins over the tag's; either way the bytes
        // are re-encoded through sharp before anything serves them.
        const coverBytes =
          coverData !== '' ? Buffer.from(coverData, 'base64') : tags.cover;
        const hadCover = coverBytes !== null && coverBytes.length > 0;
        if (hadCover) {
          await storeTrackCover(db, cfg.musicRoot, trackId, coverBytes);
          // THE ENCODE LEAVES THE REQUEST (the 504). This used to encode HERE,
          // inside the upload request, and the first real track outran nginx's
          // 60-second proxy_read_timeout: the operator got a 504 with no idea
          // why, minutes into first use. Upload now stores and returns; the
          // queue encodes, which is what the queue is for, and a default nginx
          // needs no raised timeout to survive us.
          await enqueueMusicEncode(db, trackId, ENCODE_VERSION);
        }
        await writeAudit(db, req.session?.username ?? 'unknown', 'music.track.upload', `track:${String(trackId)}`, {
          title, kind, bytes: bytes.length, hadCover,
        });
        const covered = hadCover
          ? 'cover attached; the encode is queued and runs in the background'
          : 'no cover: it will send as a voice player until you add one';
        if (wantsJson) return reply.send({ ok: true, trackId, title, hadCover });
        return reply.redirect(back('notice=' + encodeURIComponent(`Uploaded "${title}" (${covered}).`)));
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/music/tracks/:id/meta',
    async (req, reply) => {
      const id = Number.parseInt(req.params.id, 10);
      const kindRaw = bodyString(req.body, 'kind');
      const ok = await updateTrackMeta(db, id, {
        kind: (TRACK_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as TrackKind) : 'music',
        title: bodyString(req.body, 'title').trim() || 'Untitled',
        artist: bodyString(req.body, 'artist').trim() || null,
        genre: bodyString(req.body, 'genre').trim() || null,
      });
      await writeAudit(db, req.session?.username ?? 'unknown', 'music.track.meta', `track:${String(id)}`, { ok });
      return reply.redirect(back(ok ? 'saved=1' : 'error=No+such+track.'));
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/music/tracks/:id/cover',
    { bodyLimit: Math.ceil(COVER_MAX_BYTES * 1.4) + 65536 },
    async (req, reply) => {
      const id = Number.parseInt(req.params.id, 10);
      const data = bodyString(req.body, 'imageData');
      if (data === '') return reply.redirect(back('error=' + encodeURIComponent('No image arrived.')));
      const track = await getTrack(db, id);
      if (track === null) return reply.redirect(back('error=No+such+track.'));
      try {
        const bytes = Buffer.from(data, 'base64');
        if (bytes.length === 0 || bytes.length > COVER_MAX_BYTES) {
          return reply.redirect(back('error=' + encodeURIComponent(`A cover must be between 1 byte and ${mb(COVER_MAX_BYTES)}.`)));
        }
        await storeTrackCover(db, cfg.musicRoot, id, bytes);
        // The same 504 lesson as the upload: the re-encode a new cover needs is
        // the queue's work, not this request's.
        await enqueueMusicEncode(db, id, ENCODE_VERSION);
        await writeAudit(db, req.session?.username ?? 'unknown', 'music.track.cover', `track:${String(id)}`, {});
        return reply.redirect(back('saved=1'));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.redirect(back('error=' + encodeURIComponent(`Cover failed: ${message.slice(0, 200)}`)));
      }
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/music/tracks/:id/delete',
    async (req, reply) => {
      const id = Number.parseInt(req.params.id, 10);
      if ((req.body)['confirm'] !== 'on') return reply.redirect('/music');
      const track = await deleteTrack(db, id);
      if (track === null) return reply.redirect(back('error=No+such+track.'));
      await removeTrackFiles(cfg.musicRoot, id);
      await writeAudit(db, req.session?.username ?? 'unknown', 'music.track.delete', `track:${String(id)}`, { title: track.title });
      return reply.redirect(back('saved=1'));
    },
  );

  app.post<{ Body: Record<string, unknown> }>('/music/playlists/create', async (req, reply) => {
    const name = bodyString(req.body, 'name').trim();
    if (name === '') return reply.redirect(back('error=' + encodeURIComponent('A playlist needs a name.')));
    try {
      const id = await createPlaylist(db, name);
      await writeAudit(db, req.session?.username ?? 'unknown', 'music.playlist.create', `playlist:${String(id)}`, { name });
      return reply.redirect(back('saved=1'));
    } catch {
      return reply.redirect(back('error=' + encodeURIComponent(`A playlist called "${name}" already exists.`)));
    }
  });

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/music/playlists/:id/delete',
    async (req, reply) => {
      const id = Number.parseInt(req.params.id, 10);
      if ((req.body)['confirm'] !== 'on') return reply.redirect('/music');
      const ok = await deletePlaylist(db, id);
      await writeAudit(db, req.session?.username ?? 'unknown', 'music.playlist.delete', `playlist:${String(id)}`, { ok });
      return reply.redirect(back(ok ? 'saved=1' : 'error=No+such+playlist.'));
    },
  );

  app.post<{ Body: Record<string, unknown> }>('/music/playlists/add-track', async (req, reply) => {
    const playlistId = bodyInt(req.body, 'playlistId');
    const trackId = bodyInt(req.body, 'trackId');
    if (playlistId === null || trackId === null) return reply.redirect(back('error=Pick+both.'));
    const current = (await playlistTracks(db, playlistId)).map((t) => t.id);
    if (!current.includes(trackId)) {
      await setPlaylistTracks(db, playlistId, [...current, trackId]);
    }
    return reply.redirect(back('saved=1'));
  });

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/music/playlists/:id/remove-track',
    async (req, reply) => {
      const playlistId = Number.parseInt(req.params.id, 10);
      const trackId = bodyInt(req.body, 'trackId');
      const current = (await playlistTracks(db, playlistId)).map((t) => t.id);
      await setPlaylistTracks(db, playlistId, current.filter((t) => t !== trackId));
      return reply.redirect(back('saved=1'));
    },
  );

  app.post<{ Body: Record<string, unknown> }>('/music/assign', async (req, reply) => {
    const botProfileId = bodyInt(req.body, 'botProfileId');
    const playlistId = bodyInt(req.body, 'playlistId');
    if (botProfileId === null || playlistId === null) return reply.redirect(back('error=Pick+a+bot+and+a+playlist.'));
    const id = await assignPlaylist(db, botProfileId, playlistId);
    await writeAudit(db, req.session?.username ?? 'unknown', 'music.assign', `assignment:${String(id)}`, { botProfileId, playlistId });
    return reply.redirect(`/music?bot=${String(botProfileId)}&saved=1`);
  });

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/music/assignments/:id/cadence',
    async (req, reply) => {
      const id = Number.parseInt(req.params.id, 10);
      const a = await getAssignment(db, id);
      if (a === null) return reply.redirect(back('error=No+such+assignment.'));
      const destGroupId = bodyInt(req.body, 'destGroupId');
      const intervalMinutes = bodyInt(req.body, 'intervalMinutes');
      const messageCount = bodyInt(req.body, 'messageCount');
      if (destGroupId === null) {
        return reply.redirect(back('error=' + encodeURIComponent('A cadence needs a destination group.')));
      }
      if (intervalMinutes === null && messageCount === null) {
        return reply.redirect(back('error=' + encodeURIComponent('At least one trigger is required: an interval, a message count, or both.')));
      }
      await setAssignmentCadence(db, id, { destGroupId, intervalMinutes, messageCount });
      await writeAudit(db, req.session?.username ?? 'unknown', 'music.assignment.cadence', `assignment:${String(id)}`, { destGroupId, intervalMinutes, messageCount });
      return reply.redirect(`/music?bot=${String(a.botProfileId)}&saved=1`);
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/music/assignments/:id/onrequest',
    async (req, reply) => {
      const id = Number.parseInt(req.params.id, 10);
      const a = await getAssignment(db, id);
      if (a === null) return reply.redirect(back('error=No+such+assignment.'));
      await setAssignmentOnRequest(db, id);
      await writeAudit(db, req.session?.username ?? 'unknown', 'music.assignment.onrequest', `assignment:${String(id)}`, {});
      return reply.redirect(`/music?bot=${String(a.botProfileId)}&saved=1`);
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/music/assignments/:id/delete',
    async (req, reply) => {
      const id = Number.parseInt(req.params.id, 10);
      const a = await getAssignment(db, id);
      if (a === null) return reply.redirect(back('error=No+such+assignment.'));
      await removeAssignment(db, id);
      await writeAudit(db, req.session?.username ?? 'unknown', 'music.assignment.delete', `assignment:${String(id)}`, {});
      return reply.redirect(`/music?bot=${String(a.botProfileId)}&saved=1`);
    },
  );

  app.post<{ Body: Record<string, unknown> }>('/music/settings', async (req, reply) => {
    await plugins.saveMusic(
      {
        musicDailyCap: bodyString(req.body, 'musicDailyCap'),
        musicGapMinutes: bodyString(req.body, 'musicGapMinutes'),
        spotDailyCap: bodyString(req.body, 'spotDailyCap'),
        spotGapMinutes: bodyString(req.body, 'spotGapMinutes'),
        memberUploadMaxBytes: bodyString(req.body, 'memberUploadMaxBytes'),
      },
      req.session?.username ?? 'unknown',
    );
    return reply.redirect(back('saved=1'));
  });

}
