/**
 * The Music section (CCB-S5-044, D-216/D-217; redesigned under D-225).
 *
 * Four sub-pages - Library, Playlists, Assignments, Storage - built ONE TO ONE
 * from the operator's design deliverable (design/deliverable-music): the
 * prototype is the specification, its copy is the copy, its timings are the
 * timings. The interactive behaviour lives in assets/admin-music.js, whose
 * spec is the prototype's own logic; this file owns the routes, the data, and
 * the static chrome.
 *
 * TWO THINGS ARE DELIBERATELY NOT SETTABLE, and the pages say so beside them:
 * the send shape (the cover decides it) and shuffle-without-replacement
 * (derived from the plays log). Every existing route keeps its path, method
 * and body; the redesign added five small ones (audio preview with Range,
 * playlist order, playlist rename, encode build, encode delete - D-225).
 */

import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { stat, writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { ViewContext } from '../server.js';
import { html, page, raw, type SafeHtml } from '../html.js';
import { scopePanel, type ScopeLine } from './ui.js';
import { listBotOnboardingProfiles } from '../../profiles/bot-onboarding.js';
import { resolveSelectedBot } from '../selected-bot.js';
import { writeAudit } from '../../db/audit.js';
import { status } from '../status.js';
import { log } from '../../log.js';
import {
  assignPlaylist,
  createPlaylist,
  deletePlaylist,
  deleteTrack,
  getAssignment,
  getTrack,
  insertTrack,
  listAssignments,
  listPlaylists,
  listTracks,
  playlistTracks,
  removeAssignment,
  renamePlaylist,
  setAssignmentCadence,
  setAssignmentOnRequest,
  setPlaylistTracks,
  trackPlayCounts,
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
import { fileDeliverySnapshot } from '../../bot/file-log.js';
import { MUSIC_ID, MUSIC_UPLOADS_ID } from '../../plugins/music/plugin.js';
import {
  describePluginScopes,
  PLUGIN_SETTING_SCOPES,
  type PluginScopeView,
} from '../../plugins/scope.js';
import { listAllPluginOverrides } from '../../db/plugin-overrides.js';

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
 * (D-212). The prototype's own rule: KB below a megabyte (never "0 KB"), one
 * decimal of MB below a gigabyte, two of GB above.
 */
function mb(bytes: number): string {
  if (!bytes) return '0 bytes';
  if (bytes < 1024 * 1024) return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** The sidebar's own shorter form. */
function mbShort(bytes: number): string {
  if (!bytes) return '0';
  if (bytes < 1024 * 1024 * 1024) return `${String(Math.round(bytes / (1024 * 1024)))} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Durations: `unknown` is a real value, never a zero and never a blank. */
function mmss(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return 'unknown';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${String(h)}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m)}:${String(s).padStart(2, '0')}`;
}

function stamp(d: Date | null): string {
  if (d === null) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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

interface SectionData {
  tracks: {
    id: number;
    kind: TrackKind;
    title: string;
    artist: string | null;
    album: string | null;
    genre: string | null;
    dur: number | null;
    size: number;
    mime: string | null;
    file: string;
    cover: boolean;
    vid: number;
    vidAt: string;
    plays: number;
    up: string;
    upd: string;
  }[];
  playlists: { id: number; name: string; trackIds: number[] }[];
  assignments: {
    id: number;
    botId: number;
    bot: string;
    playlistId: number;
    playlist: string;
    mode: 'on-request' | 'cadence';
    dest: number | null;
    mins: number | null;
    msgs: number | null;
    last: string;
  }[];
  bots: { id: number; name: string }[];
  usage: { orig: number; enc: number };
}

export function registerMusic(app: FastifyInstance, ctx: ViewContext): void {
  const { db, plugins, cfg } = ctx;

  const back = (extra: string): string => `/music?${extra}`;

  async function sectionData(): Promise<SectionData> {
    const [tracks, playlists, assignmentsRaw, botProfiles, plays, usage] = await Promise.all([
      listTracks(db),
      listPlaylists(db),
      listAssignments(db),
      listBotOnboardingProfiles(db),
      trackPlayCounts(db),
      libraryDiskUsage(cfg.musicRoot),
    ]);
    const botName = new Map(botProfiles.map((b) => [b.id, b.displayName]));
    const contents = new Map<number, number[]>();
    for (const pl of playlists) {
      contents.set(pl.id, (await playlistTracks(db, pl.id)).map((t) => t.id));
    }
    const encodedSize = new Map<number, number>();
    for (const t of tracks) {
      if (t.encodedPath !== null) {
        const s = await stat(t.encodedPath).catch(() => null);
        if (s !== null) encodedSize.set(t.id, s.size);
      }
    }
    return {
      tracks: tracks.map((t) => ({
        id: t.id,
        kind: t.kind,
        title: t.title,
        artist: t.artist,
        album: t.album,
        genre: t.genre,
        dur: t.durationSeconds,
        size: t.fileSize,
        mime: t.mime,
        file: basename(t.filePath),
        cover: t.coverPath !== null,
        vid: encodedSize.get(t.id) ?? 0,
        vidAt: stamp(t.encodedAt),
        plays: plays.get(t.id) ?? 0,
        up: stamp(t.uploadedAt),
        upd: stamp(t.updatedAt),
      })),
      playlists: playlists.map((pl) => ({ id: pl.id, name: pl.name, trackIds: contents.get(pl.id) ?? [] })),
      assignments: assignmentsRaw.map((a) => ({
        id: a.id,
        botId: a.botProfileId,
        bot: botName.get(a.botProfileId) ?? `bot ${String(a.botProfileId)}`,
        playlistId: a.playlistId,
        playlist: a.playlistName,
        mode: a.mode === 'cadence' ? 'cadence' : 'on-request',
        dest: a.destGroupId,
        mins: a.intervalMinutes,
        msgs: a.messageCount,
        last: stamp(a.lastSentAt),
      })),
      bots: botProfiles.map((b) => ({ id: b.id, name: b.displayName })),
      usage: { orig: usage.originalsBytes, enc: usage.encodedBytes },
    };
  }

  function badges(data: SectionData): Record<string, string> {
    return {
      'music:library': String(data.tracks.length),
      'music:playlists': String(data.playlists.length),
      'music:assignments': String(data.assignments.length),
      'music:storage': mbShort(data.usage.orig + data.usage.enc),
    };
  }

  interface PageShellOpts {
    title: string;
    active: string;
    csrf: string;
    data: SectionData;
    scope: 'shared' | 'mixed';
    switcher: Parameters<typeof page>[0]['botSwitcher'];
    body: SafeHtml;
  }

  function musicPage(opts: PageShellOpts): string {
    return page({
      title: opts.title,
      active: opts.active,
      csrfToken: opts.csrf,
      ...(opts.switcher !== undefined ? { botSwitcher: opts.switcher } : {}),
      sidebarBadges: badges(opts.data),
      head: html`<script src="/assets/admin-music.js" defer></script>`,
      body: html`<div class="music-page" data-music-page="${opts.active.replace('music:', '')}">
        <script type="application/json" id="music-data">${raw(
          JSON.stringify({
            csrf: opts.csrf,
            page: opts.active.replace('music:', ''),
            trackMaxBytes: TRACK_MAX_BYTES,
            encodeVersion: ENCODE_VERSION,
            ...opts.data,
          }).replace(/</g, '\\u003c'),
        )}</script>
        ${opts.body}
      </div>`,
    });
  }

  /* ── LIBRARY ─────────────────────────────────────────────────────────────── */

  app.get<{ Querystring: { bot?: string } }>('/music', async (req, reply) => {
    const csrf = req.session?.csrfToken ?? '';
    const botProfiles = await listBotOnboardingProfiles(db);
    const selection = resolveSelectedBot(botProfiles, req.query.bot, req.session?.selectedBotProfileId ?? null);
    const data = await sectionData();
    reply.type('text/html');
    return musicPage({
      title: 'Music Library',
      active: 'music:library',
      csrf,
      data,
      scope: 'shared',
      switcher: { ...selection, returnTo: '/music', scope: 'shared' },
      body: html`
        <div class="admin-page-header music-head">
          <div class="music-head-text">
            <h1 class="admin-page-title">Library</h1>
            <p class="admin-page-subtitle">
              Tags are read from each file at upload. Tick tracks to fill a playlist, press play to
              hear what arrived, Edit opens the track panel.
            </p>
          </div>
          <div class="music-head-spacer"></div>
          <span class="music-meta-line" data-mus="metaLine"></span>
        </div>

        <div class="music-stack">
          <section class="admin-card music-toolbar-card">
            <div class="music-toolbar">
              <input data-mus="q" placeholder="Search title, artist, album, file" aria-label="Search the library" class="music-grow" />
              <select data-mus="fKind" aria-label="Filter by kind" style="width:150px">
                <option value="">All kinds</option>
                <option value="music">music</option>
                <option value="audiobook">audiobook</option>
                <option value="documentary">documentary</option>
                <option value="spot">spot</option>
              </select>
              <select data-mus="fGenre" aria-label="Filter by genre" style="width:160px"></select>
              <select data-mus="fX" aria-label="Filter by state" style="width:200px">
                <option value="">Everything</option>
                <option value="nocover">no cover</option>
                <option value="novideo">cover, video not built</option>
                <option value="video">video cached</option>
                <option value="nopl">in no playlist</option>
                <option value="nodur">duration unknown</option>
              </select>
              <button class="admin-action-button" data-mus="clearF" hidden>Reset</button>
              <span class="music-count-line" data-mus="countLine"></span>
            </div>
            <div data-mus="dz" class="music-dropzone">
              <span class="music-dz-lead">Drop audio files here, or</span>
              <label class="admin-action-button admin-action-primary" for="mus-files" style="cursor:pointer">Choose files</label>
              <input id="mus-files" type="file" accept="audio/*" multiple class="music-visually-hidden" />
              <span class="music-dz-note">Title, artist, album, genre and often the cover are read from the file itself.</span>
              <div class="music-head-spacer"></div>
              <span class="music-ceil-line">up to ${mb(TRACK_MAX_BYTES)} per file</span>
            </div>
          </section>

          <section class="admin-card music-staged-card" data-mus="stagedCard" hidden>
            <div class="music-staged-head">
              <h2 class="admin-card-title">Read from the files</h2>
              <span aria-live="polite" class="music-staged-line" data-mus="stagedLine"></span>
              <div class="music-head-spacer"></div>
              <button class="admin-action-button admin-action-primary" data-mus="importAll">Import all</button>
              <button class="admin-action-button" data-mus="discardAll">Discard</button>
            </div>
            <div class="music-scroll"><div style="min-width:820px">
              <div class="music-staged-grid music-staged-header">
                <span class="mus-th" style="cursor:default">Title</span>
                <span class="mus-th" style="cursor:default">Artist</span>
                <span class="mus-th" style="cursor:default">Genre</span>
                <span class="mus-th" style="cursor:default">Kind</span>
                <span class="mus-th" style="cursor:default">From the file</span>
                <span></span>
              </div>
              <div data-mus="stagedRows"></div>
            </div></div>
            <p class="music-staged-foot">
              Read in the browser. Nothing reaches the server until you press Import, and the fields
              you change here win over the tag.
            </p>
          </section>

          <section class="admin-card music-table-card">
            <div class="music-bulk-bar" data-mus="bulkBar" hidden>
              <span class="music-bulk-line" aria-live="polite" data-mus="checkedLine"></span>
              <span class="music-bulk-to">add to</span>
              <select data-mus="bulkPl" aria-label="Target playlist" style="width:200px;min-height:34px"></select>
              <button class="admin-action-button admin-action-primary" data-mus="bulkAdd">Add to playlist</button>
              <div class="music-head-spacer"></div>
              <button class="admin-action-button" data-mus="clearChecked">Clear selection</button>
            </div>
            <p aria-live="polite" class="music-lib-note" data-mus="libNote" hidden></p>
            <div class="music-scroll music-table-scroll" data-mus="tableWrap">
              <div style="min-width:1080px">
                <div class="music-grid music-grid-header" data-mus="tableHeader"></div>
                <div data-mus="tableRows"></div>
              </div>
            </div>
            <div class="music-foot-row" data-mus="footRow"><span class="music-foot-line" data-mus="footLine"></span></div>
            <div class="music-empty" data-mus="emptyBox" hidden>
              <p class="music-empty-title" data-mus="emptyTitle"></p>
              <p class="music-empty-note" data-mus="emptyNote"></p>
            </div>
          </section>
        </div>

        <datalist id="mus-genres" data-mus="genreDatalist"></datalist>

        <aside class="music-drawer" data-mus="drawer" aria-hidden="true">
          <div data-mus="drawerBody"></div>
        </aside>
      `,
    });
  });

  /* ── PLAYLISTS ───────────────────────────────────────────────────────────── */

  app.get<{ Querystring: { bot?: string } }>('/music/playlists', async (req, reply) => {
    const csrf = req.session?.csrfToken ?? '';
    const botProfiles = await listBotOnboardingProfiles(db);
    const selection = resolveSelectedBot(botProfiles, req.query.bot, req.session?.selectedBotProfileId ?? null);
    const data = await sectionData();
    reply.type('text/html');
    return musicPage({
      title: 'Music Playlists',
      active: 'music:playlists',
      csrf,
      data,
      scope: 'shared',
      switcher: { ...selection, returnTo: '/music/playlists', scope: 'shared' },
      body: html`
        <div class="admin-page-header music-head">
          <div class="music-head-text">
            <h1 class="admin-page-title">Playlists</h1>
            <p class="admin-page-subtitle">
              The unit of assignment. To fill one with many tracks at once, tick them in the Library
              and add them in one step.
            </p>
          </div>
        </div>
        <section class="admin-card music-table-card">
          <div class="music-scroll"><div style="min-width:760px">
            <div class="music-pl-grid music-grid-header">
              <span class="mus-th" style="cursor:default">Playlist</span>
              <span class="mus-th" style="cursor:default;justify-content:flex-end">Tracks</span>
              <span class="mus-th" style="cursor:default;justify-content:flex-end">Length</span>
              <span class="mus-th" style="cursor:default">Held by</span>
              <span class="mus-th" style="cursor:default;justify-content:flex-end">Actions</span>
            </div>
            <div data-mus="plRows"></div>
            <div class="music-create-row">
              <input data-mus="newPl" placeholder="New playlist name" aria-label="New playlist name" style="flex:1;max-width:340px" />
              <button class="admin-action-button admin-action-primary" data-mus="plCreate">Create</button>
              <span class="music-create-hint">Edit opens the playlist panel: order, adding tracks, rename.</span>
            </div>
          </div></div>
          <p aria-live="polite" class="music-note-foot" data-mus="plNote"></p>
        </section>

        <aside class="music-drawer" data-mus="drawer" aria-hidden="true">
          <div data-mus="drawerBody"></div>
        </aside>
      `,
    });
  });

  /* ── ASSIGNMENTS ─────────────────────────────────────────────────────────── */

  app.get<{ Querystring: { bot?: string } }>('/music/assignments', async (req, reply) => {
    const csrf = req.session?.csrfToken ?? '';
    const botProfiles = await listBotOnboardingProfiles(db);
    const selection = resolveSelectedBot(botProfiles, req.query.bot, req.session?.selectedBotProfileId ?? null);
    const data = await sectionData();
    const overrides = (await listAllPluginOverrides(db)).filter(
      (o) => o.pluginId === MUSIC_ID || o.pluginId === MUSIC_UPLOADS_ID,
    );
    const pluginScopes = describePluginScopes(overrides, botProfiles.length);
    reply.type('text/html');
    return musicPage({
      title: 'Music Assignments',
      active: 'music:assignments',
      csrf,
      data,
      scope: 'mixed',
      switcher: { ...selection, returnTo: '/music/assignments', scope: 'mixed' },
      body: html`
        <div class="admin-page-header music-head">
          <div class="music-head-text">
            <h1 class="admin-page-title">Assignments</h1>
            <p class="admin-page-subtitle">
              Every row belongs to the bot named in it. Nothing on this page is deployment-wide.
            </p>
          </div>
        </div>
        <section class="admin-card music-table-card">
          <div class="music-scroll"><div style="min-width:1000px">
            <div class="music-asg-grid music-grid-header">
              <span class="mus-th" style="cursor:default">Bot</span>
              <span class="mus-th" style="cursor:default">Playlist</span>
              <span class="mus-th" style="cursor:default">Rhythm</span>
              <span class="mus-th" style="cursor:default">Into group</span>
              <span class="mus-th" style="cursor:default">Minutes</span>
              <span class="mus-th" style="cursor:default">Messages</span>
              <span class="mus-th" style="cursor:default">State</span>
              <span></span>
            </div>
            <div data-mus="asgRows"></div>
            <div class="music-asg-empty" data-mus="asgEmpty" hidden>
              <p class="music-empty-title">No bot holds a playlist yet.</p>
              <p class="music-empty-note">
                A normal state, not a fault: she answers music questions and plays nothing until a
                playlist is assigned below.
              </p>
            </div>
            <div class="music-create-row">
              <select data-mus="newBot" aria-label="Bot" style="width:130px"></select>
              <span class="music-bulk-to">gets</span>
              <select data-mus="newPlaylist" aria-label="Playlist" style="width:210px"></select>
              <button class="admin-action-button admin-action-primary" data-mus="asgAdd">Assign, on request</button>
              <span class="music-create-hint">Every new assignment starts on request only. A cadence is a deliberate second step.</span>
            </div>
          </div></div>
          <p aria-live="polite" class="music-note-foot" data-mus="asgNote">nothing changed yet</p>
        </section>
        <div class="music-2col" data-2col>
          <section class="admin-card music-explainer">
            <span class="music-kicker">What a cadence can say</span>
            <p>
              A destination group and at least one trigger: every N minutes, every N member
              messages, or both, whichever comes first. Minutes run 1 to 10080, messages 1 to
              10000. Nothing applies until you press Set cadence.
            </p>
          </section>
          <section class="admin-card music-explainer">
            <span class="music-kicker">What is not settable, on purpose</span>
            <p>
              Track choice on a cadence is shuffle without replacement: every track plays once
              before any repeats, derived from the plays log. A member asking for a track consults
              no budget; the budgets under Storage bound only unbidden sends.
            </p>
          </section>
        </div>
        ${musicScopePanel(pluginScopes, botProfiles, selection.selectedId, data.assignments.length) ?? ''}
      `,
    });
  });

  /* ── STORAGE AND DIAGNOSTICS ─────────────────────────────────────────────── */

  app.get<{ Querystring: { bot?: string } }>('/music/storage', async (req, reply) => {
    const csrf = req.session?.csrfToken ?? '';
    const botProfiles = await listBotOnboardingProfiles(db);
    const selection = resolveSelectedBot(botProfiles, req.query.bot, req.session?.selectedBotProfileId ?? null);
    const data = await sectionData();
    const overrides = (await listAllPluginOverrides(db)).filter(
      (o) => o.pluginId === MUSIC_ID || o.pluginId === MUSIC_UPLOADS_ID,
    );
    const pluginScopes = describePluginScopes(overrides, botProfiles.length);
    const settings = plugins.musicSettings();
    const diag = musicDiagnostics();
    const delivery = fileDeliverySnapshot();

    const kindCount = (k: TrackKind): number => data.tracks.filter((t) => t.kind === k).length;
    const kindLine = `music ${String(kindCount('music'))} · audiobook ${String(kindCount('audiobook'))} · documentary ${String(kindCount('documentary'))} · spot ${String(kindCount('spot'))}`;
    const cached = data.tracks.filter((t) => t.vid > 0).length;
    const encLine = `${String(cached)} of ${String(data.tracks.length)} cached, your decision`;
    const totalPlays = data.tracks.reduce((n, t) => n + t.plays, 0);

    const genreCounts = new Map<string, number>();
    for (const t of data.tracks) {
      const g = t.genre ?? '(no genre)';
      genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
    }
    const genres = [...genreCounts.entries()].sort((a, b) =>
      a[0] === '(no genre)' ? 1 : b[0] === '(no genre)' ? -1 : a[0].localeCompare(b[0]),
    );
    const gMax = Math.max(1, ...genres.map(([, n]) => n));

    const topPlayed = [...data.tracks].sort((a, b) => b.plays - a.plays).slice(0, 6);

    const skipsLine =
      Object.entries(diag.skips)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k}: ${String(n)}`)
        .join(' · ') || 'none';
    const encodeFaults = diag.lastError === null ? 'none this process' : `${diag.lastError.where}: ${diag.lastError.message}`;

    reply.type('text/html');
    return musicPage({
      title: 'Music Storage',
      active: 'music:storage',
      csrf,
      data,
      scope: 'shared',
      switcher: { ...selection, returnTo: '/music/storage', scope: 'shared' },
      body: html`
        <div class="admin-page-header music-head">
          <div class="music-head-text">
            <h1 class="admin-page-title">Storage and diagnostics</h1>
            <p class="admin-page-subtitle">
              Measured figures, not estimates. The budgets below apply to every bot on this
              deployment.
            </p>
          </div>
        </div>
        <div class="admin-tiles">
          <article class="admin-tile"><span class="admin-tile-label">Tracks</span><strong class="admin-tile-value music-mono">${String(data.tracks.length)}</strong><small class="admin-tile-note">${kindLine}</small></article>
          <article class="admin-tile"><span class="admin-tile-label">Originals and covers</span><strong class="admin-tile-value music-mono">${mb(data.usage.orig)}</strong><small class="admin-tile-note">byte-identical to what you uploaded</small></article>
          <article class="admin-tile"><span class="admin-tile-label">Cached videos</span><strong class="admin-tile-value music-mono">${mb(data.usage.enc)}</strong><small class="admin-tile-note">${encLine}</small></article>
          <article class="admin-tile"><span class="admin-tile-label">Plays recorded</span><strong class="admin-tile-value music-mono">${String(totalPlays)}</strong><small class="admin-tile-note">no member is recorded</small></article>
        </div>
        <div class="music-2col" data-2col>
          <section class="admin-card music-explainer">
            <span class="music-kicker">Genres held</span>
            <p class="music-genre-caption">This list is her whole vocabulary: she cannot claim a genre it does not show.</p>
            ${genres.map(
              ([g, n]) => html`<div class="music-genre-row">
                <span class="music-genre-label" style="color:${g === '(no genre)' ? 'var(--text-faint)' : 'var(--text-soft)'}">${g}</span>
                <span class="music-genre-bar"><span style="position:absolute;left:0;top:0;bottom:0;width:${String(Math.round((n / gMax) * 100))}%;border-radius:99px;min-width:2px;background:${g === '(no genre)' ? 'rgba(148,163,184,.4)' : 'linear-gradient(90deg,rgba(232,56,159,.7),rgba(69,189,209,.7))'}"></span></span>
                <span class="music-genre-n">${String(n)}</span>
              </div>`,
            )}
          </section>
          <section class="admin-card music-explainer">
            <span class="music-kicker">Most played</span>
            <p class="music-genre-caption">
              Grouped over the plays log at read time. Nothing is stored as a total, so deleting the
              rows leaves no ghost of them.
            </p>
            ${topPlayed.map(
              (t) => html`<div class="music-top-row">
                <button class="mus-play" data-play-track="${String(t.id)}" aria-label="Play ${t.title}"><svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg></button>
                <span class="music-top-title">${t.title}</span>
                <span class="music-top-time">${mmss(t.dur)}</span>
                <span class="music-top-plays">${String(t.plays)}</span>
              </div>`,
            )}
          </section>
        </div>
        <section class="admin-card music-budgets-card">
          <div class="music-budgets-head">
            <h2 class="admin-card-title">The unbidden budgets</h2>
            <span class="music-pill">applies to every bot</span>
            <div class="music-head-spacer"></div>
            <span class="music-set-dirty" data-mus="setCount" hidden></span>
            <button class="admin-action-button" data-mus="setRevert" hidden>Revert</button>
            <button class="admin-action-button admin-action-primary" data-mus="setSave" hidden>Save</button>
            <span aria-live="polite" class="music-set-clean" data-mus="setSavedLine">no pending changes</span>
          </div>
          <p class="music-budgets-copy">
            What a room may receive without anyone asking, per day, with a minimum quiet between.
            Separate for music and for spots: one budget would let a busy music day silently buy
            advertising quiet, or the reverse. A member asking for a track consults neither budget.
          </p>
          <div class="music-budgets-grid">
            <label><span class="music-field-label">Unbidden music, per room per day</span><input data-set="musicDailyCap" value="${String(settings.musicDailyCap)}" type="number" min="1" max="48" class="music-mono" /></label>
            <label><span class="music-field-label">Minimum gap, minutes</span><input data-set="musicGapMinutes" value="${String(settings.musicGapMinutes)}" type="number" min="0" max="1440" class="music-mono" /></label>
            <label><span class="music-field-label">Spots, per room per day</span><input data-set="spotDailyCap" value="${String(settings.spotDailyCap)}" type="number" min="1" max="48" class="music-mono" /></label>
            <label><span class="music-field-label">Minimum gap between spots</span><input data-set="spotGapMinutes" value="${String(settings.spotGapMinutes)}" type="number" min="0" max="1440" class="music-mono" /></label>
            <label><span class="music-field-label">Largest member file, MB</span><input data-set="memberUploadMb" value="${String(Math.round(settings.memberUploadMaxBytes / (1024 * 1024)))}" type="number" min="1" max="1024" class="music-mono" /></label>
          </div>
          <p class="music-budgets-foot">
            She re-sends a member's own mp3 without keeping it, checked by name and by first bytes.
            Whether she accepts them at all is a per-bot switch on the Plugins page, shipped off.
            Your own uploads are bounded separately, at ${mb(TRACK_MAX_BYTES)} per file.
          </p>
        </section>
        <section class="admin-card music-explainer">
          <span class="music-kicker">Diagnostics</span>
          <div class="music-diag-grid">
            <span class="music-diag-label">Last tick</span><span class="music-mono music-diag-value">${diag.lastTickAt === null ? 'not yet this process' : stamp(new Date(diag.lastTickAt)) + ' UTC'}</span>
            <span class="music-diag-label">Plays sent this process</span><span class="music-mono music-diag-value">${String(diag.announcementsSent)}</span>
            <span class="music-diag-label">Cadence slots skipped</span><span class="music-mono music-diag-value">${skipsLine}</span>
            <span class="music-diag-label">Encode faults</span><span class="music-mono" style="color:${diag.lastError === null ? 'var(--success)' : 'var(--danger)'}">${encodeFaults}</span>
          </div>
          <p class="music-diag-foot">
            A skipped slot is the budgets working, not a fault: budget-spent means the room had its
            fill today, gap-too-recent means the minimum quiet is being kept. A failed encode
            degrades the send to title plus voice player rather than losing the track.
          </p>
        </section>
        <section class="admin-card music-explainer">
          <span class="music-kicker">File delivery</span>
          <p class="music-genre-caption">
            A surface the design template does not show (D-224, added after it was drawn): every
            file-bearing send books a check that reads the item's own file status back out of the
            core a few minutes later, because a send command returning is not the file arriving.
          </p>
          <div class="music-diag-grid">
            <span class="music-diag-label">Sends watched this process</span><span class="music-mono music-diag-value">${String(delivery.counts.watched)}</span>
            <span class="music-diag-label">Confirmed complete</span><span class="music-mono" style="color:var(--success)">${String(delivery.counts.complete)}</span>
            <span class="music-diag-label">Stuck, never started uploading</span><span class="music-mono" style="color:${delivery.counts.stuck === 0 ? 'var(--text-soft)' : 'var(--danger)'}">${String(delivery.counts.stuck)}</span>
            <span class="music-diag-label">Transfer errors</span><span class="music-mono" style="color:${delivery.counts.sendError === 0 ? 'var(--text-soft)' : 'var(--danger)'}">${String(delivery.counts.sendError)}</span>
            <span class="music-diag-label">Transient warnings</span><span class="music-mono music-diag-value">${String(delivery.counts.sendWarning)}</span>
          </div>
          ${delivery.entries.length === 0
            ? html`<p class="music-diag-foot">No delivery outcomes recorded yet this process.</p>`
            : html`<div class="music-delivery-list">
                ${delivery.entries.slice(0, 10).map(
                  (e) => html`<p class="music-delivery-row">
                    <span class="music-mono">${e.at.slice(11, 19)}</span> · ${e.outcome}${e.groupId !== null ? ` · group ${String(e.groupId)}` : ''} · ${e.label}${e.detail ? `, ${e.detail}` : ''}
                  </p>`,
                )}
              </div>`}
        </section>
        ${musicScopePanel(pluginScopes, botProfiles, selection.selectedId, data.assignments.length) ?? ''}
      `,
    });
  });

  /* ── THE AUDIO PREVIEW (D-225 route 1) ───────────────────────────────────── */
  //
  // Addressed by track id and never by path (the admin-media rule). Serves the
  // ORIGINAL bytes: the preview must prove what was uploaded, not what was
  // encoded. Answers Range so seeking does not refetch. A preview writes NO
  // row to cinderella_track_plays: a play record means a member received a
  // track, and the console listening is not that.
  app.get<{ Params: { id: string } }>('/music/tracks/:id/audio', async (req, reply) => {
    const id = Number.parseInt(req.params.id, 10);
    const track = Number.isInteger(id) ? await getTrack(db, id) : null;
    if (track === null) return reply.code(404).type('text/plain').send('Not found');
    const info = await stat(track.filePath).catch(() => null);
    if (info === null) return reply.code(404).type('text/plain').send('Not found');
    reply.header('cache-control', 'no-store');
    reply.header('accept-ranges', 'bytes');
    reply.type(track.mime ?? 'audio/mpeg');
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range !== null && (range[1] !== '' || range[2] !== '')) {
      const start = range[1] === '' ? Math.max(0, info.size - Number(range[2])) : Number(range[1]);
      const end = range[2] === '' || range[1] === '' ? info.size - 1 : Math.min(Number(range[2]), info.size - 1);
      if (start >= info.size || start > end) {
        reply.header('content-range', `bytes */${String(info.size)}`);
        return reply.code(416).send();
      }
      reply.code(206);
      reply.header('content-range', `bytes ${String(start)}-${String(end)}/${String(info.size)}`);
      reply.header('content-length', String(end - start + 1));
      return reply.send(createReadStream(track.filePath, { start, end }));
    }
    reply.header('content-length', String(info.size));
    return reply.send(createReadStream(track.filePath));
  });

  /* ── PRESERVED MUTATION ROUTES (paths, methods and bodies unchanged) ─────── */

  const answered = (req: { body: unknown }, reply: { send: (v: unknown) => unknown }, ok: boolean, error?: string): unknown => {
    if (bodyString(req.body, 'ajax') !== '1') return null;
    return reply.send(error === undefined ? { ok } : { ok, error });
  };

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
      const typedAlbum = bodyString(req.body, 'album').trim();
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
          album: typedAlbum || tags.album,
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
        if (wantsJson) {
          // Additive fields (D-225): the redesigned client renders the imported
          // row from this answer, so it carries what the tag read established.
          return reply.send({
            ok: true, trackId, title, hadCover,
            artist: typedArtist || tags.artist,
            album: typedAlbum || tags.album,
            genre: typedGenre || tags.genre,
            duration: tags.durationSeconds,
            size: bytes.length,
            mime: mimeForName(fileName),
            file: fileName,
          });
        }
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
        album: bodyString(req.body, 'album').trim() || null,
        genre: bodyString(req.body, 'genre').trim() || null,
      });
      await writeAudit(db, req.session?.username ?? 'unknown', 'music.track.meta', `track:${String(id)}`, { ok });
      return answered(req, reply, ok, ok ? undefined : 'No such track.') ?? reply.redirect(back(ok ? 'saved=1' : 'error=No+such+track.'));
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/music/tracks/:id/cover',
    { bodyLimit: Math.ceil(COVER_MAX_BYTES * 1.4) + 65536 },
    async (req, reply) => {
      const id = Number.parseInt(req.params.id, 10);
      const data = bodyString(req.body, 'imageData');
      if (data === '') return answered(req, reply, false, 'No image arrived.') ?? reply.redirect(back('error=' + encodeURIComponent('No image arrived.')));
      const track = await getTrack(db, id);
      if (track === null) return answered(req, reply, false, 'No such track.') ?? reply.redirect(back('error=No+such+track.'));
      try {
        const bytes = Buffer.from(data, 'base64');
        if (bytes.length === 0 || bytes.length > COVER_MAX_BYTES) {
          const msg = `A cover must be between 1 byte and ${mb(COVER_MAX_BYTES)}.`;
          return answered(req, reply, false, msg) ?? reply.redirect(back('error=' + encodeURIComponent(msg)));
        }
        await storeTrackCover(db, cfg.musicRoot, id, bytes);
        // The same 504 lesson as the upload: the re-encode a new cover needs is
        // the queue's work, not this request's.
        await enqueueMusicEncode(db, id, ENCODE_VERSION);
        await writeAudit(db, req.session?.username ?? 'unknown', 'music.track.cover', `track:${String(id)}`, {});
        return answered(req, reply, true) ?? reply.redirect(back('saved=1'));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return answered(req, reply, false, message.slice(0, 200)) ?? reply.redirect(back('error=' + encodeURIComponent(`Cover failed: ${message.slice(0, 200)}`)));
      }
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/music/tracks/:id/delete',
    async (req, reply) => {
      const id = Number.parseInt(req.params.id, 10);
      if ((req.body)['confirm'] !== 'on') return reply.redirect('/music');
      const track = await deleteTrack(db, id);
      if (track === null) return answered(req, reply, false, 'No such track.') ?? reply.redirect(back('error=No+such+track.'));
      await removeTrackFiles(cfg.musicRoot, id);
      await writeAudit(db, req.session?.username ?? 'unknown', 'music.track.delete', `track:${String(id)}`, { title: track.title });
      return answered(req, reply, true) ?? reply.redirect(back('saved=1'));
    },
  );

  /* ── THE CACHED-VIDEO ROUTES (D-225 routes 4 and 5, operator-approved) ───── */

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/music/tracks/:id/encode',
    async (req, reply) => {
      const id = Number.parseInt(req.params.id, 10);
      const track = await getTrack(db, id);
      if (track === null) return answered(req, reply, false, 'No such track.') ?? reply.redirect(back('error=No+such+track.'));
      if (track.coverPath === null) {
        const msg = 'Nothing to encode: this track has no cover.';
        return answered(req, reply, false, msg) ?? reply.redirect(back('error=' + encodeURIComponent(msg)));
      }
      // A rebuild must not be blocked by the cache: clear the stamp first, so
      // ensureEncoded cannot serve the old file, then queue (the 504 rule).
      await db.query(
        `UPDATE cinderella_tracks SET encoded_path = NULL, encoded_at = NULL, encode_version = NULL WHERE id = $1`,
        [id],
      );
      await enqueueMusicEncode(db, id, ENCODE_VERSION);
      await writeAudit(db, req.session?.username ?? 'unknown', 'music.track.encode', `track:${String(id)}`, {});
      return answered(req, reply, true) ?? reply.redirect(back('saved=1'));
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/music/tracks/:id/encode/delete',
    async (req, reply) => {
      const id = Number.parseInt(req.params.id, 10);
      const track = await getTrack(db, id);
      if (track === null) return answered(req, reply, false, 'No such track.') ?? reply.redirect(back('error=No+such+track.'));
      if (track.encodedPath !== null) {
        await rm(track.encodedPath, { force: true }).catch(() => undefined);
      }
      await db.query(
        `UPDATE cinderella_tracks SET encoded_path = NULL, encoded_at = NULL, encode_version = NULL WHERE id = $1`,
        [id],
      );
      await writeAudit(db, req.session?.username ?? 'unknown', 'music.track.encode-delete', `track:${String(id)}`, {});
      return answered(req, reply, true) ?? reply.redirect(back('saved=1'));
    },
  );

  app.post<{ Body: Record<string, unknown> }>('/music/playlists/create', async (req, reply) => {
    const name = bodyString(req.body, 'name').trim();
    if (name === '') return answered(req, reply, false, 'A playlist needs a name.') ?? reply.redirect(back('error=' + encodeURIComponent('A playlist needs a name.')));
    try {
      const id = await createPlaylist(db, name);
      await writeAudit(db, req.session?.username ?? 'unknown', 'music.playlist.create', `playlist:${String(id)}`, { name });
      if (bodyString(req.body, 'ajax') === '1') return reply.send({ ok: true, id });
      return reply.redirect(back('saved=1'));
    } catch {
      const msg = `A playlist called "${name}" already exists.`;
      return answered(req, reply, false, msg) ?? reply.redirect(back('error=' + encodeURIComponent(msg)));
    }
  });

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/music/playlists/:id/delete',
    async (req, reply) => {
      const id = Number.parseInt(req.params.id, 10);
      if ((req.body)['confirm'] !== 'on') return reply.redirect('/music');
      const ok = await deletePlaylist(db, id);
      await writeAudit(db, req.session?.username ?? 'unknown', 'music.playlist.delete', `playlist:${String(id)}`, { ok });
      return answered(req, reply, ok, ok ? undefined : 'No such playlist.') ?? reply.redirect(back(ok ? 'saved=1' : 'error=No+such+playlist.'));
    },
  );

  /* ── PLAYLIST ORDER AND RENAME (D-225 routes 2 and 3) ────────────────────── */

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/music/playlists/:id/order',
    async (req, reply) => {
      const id = Number.parseInt(req.params.id, 10);
      const raw = (req.body)['trackIds'];
      const ids = (Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [])
        .map((v) => Number.parseInt(String(v), 10))
        .filter((n) => Number.isInteger(n) && n > 0);
      await setPlaylistTracks(db, id, ids);
      await writeAudit(db, req.session?.username ?? 'unknown', 'music.playlist.order', `playlist:${String(id)}`, { count: ids.length });
      return answered(req, reply, true) ?? reply.redirect(back('saved=1'));
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/music/playlists/:id/rename',
    async (req, reply) => {
      const id = Number.parseInt(req.params.id, 10);
      const name = bodyString(req.body, 'name').trim();
      if (name === '') return answered(req, reply, false, 'A playlist needs a name.') ?? reply.redirect(back('error=' + encodeURIComponent('A playlist needs a name.')));
      const ok = await renamePlaylist(db, id, name);
      await writeAudit(db, req.session?.username ?? 'unknown', 'music.playlist.rename', `playlist:${String(id)}`, { name, ok });
      return answered(req, reply, ok, ok ? undefined : 'No such playlist.') ?? reply.redirect(back(ok ? 'saved=1' : 'error=No+such+playlist.'));
    },
  );

  /** The cover thumbnail, by track id, never by path (the admin-media rule). */
  app.get<{ Params: { id: string } }>('/music/tracks/:id/cover.jpg', async (req, reply) => {
    const id = Number.parseInt(req.params.id, 10);
    const track = Number.isInteger(id) ? await getTrack(db, id) : null;
    if (track === null || track.coverPath === null) {
      return reply.code(404).type('text/plain').send('Not found');
    }
    const bytes = await readFile(track.coverPath).catch(() => null);
    if (bytes === null) return reply.code(404).type('text/plain').send('Not found');
    reply.header('cache-control', 'no-store');
    reply.type('image/jpeg');
    return reply.send(bytes);
  });

  /** Forty tracks, one press: the ticked rows into one playlist. */
  app.post<{ Body: Record<string, unknown> }>('/music/playlists/add-tracks', async (req, reply) => {
    const playlistId = bodyInt(req.body, 'playlistId');
    if (playlistId === null) return answered(req, reply, false, 'Pick a playlist.') ?? reply.redirect(back('error=Pick+a+playlist.'));
    const raw = (req.body)['trackIds'];
    const picked = (Array.isArray(raw) ? raw : raw === undefined ? [] : typeof raw === 'string' && raw.includes(',') ? raw.split(',') : [raw])
      .map((v) => Number.parseInt(String(v), 10))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (picked.length === 0) {
      const msg = 'Nothing was ticked, so nothing was added.';
      return answered(req, reply, false, msg) ?? reply.redirect(back('error=' + encodeURIComponent(msg)));
    }
    const current = (await playlistTracks(db, playlistId)).map((t) => t.id);
    const merged = [...current, ...picked.filter((id) => !current.includes(id))];
    await setPlaylistTracks(db, playlistId, merged);
    await writeAudit(db, req.session?.username ?? 'unknown', 'music.playlist.add-tracks', `playlist:${String(playlistId)}`, {
      added: merged.length - current.length,
      ticked: picked.length,
    });
    if (bodyString(req.body, 'ajax') === '1') {
      return reply.send({ ok: true, added: merged.length - current.length, skipped: picked.length - (merged.length - current.length) });
    }
    return reply.redirect(back('notice=' + encodeURIComponent(
      `${String(merged.length - current.length)} added (${String(picked.length - (merged.length - current.length))} were already in it).`)));
  });

  app.post<{ Body: Record<string, unknown> }>('/music/playlists/add-track', async (req, reply) => {
    const playlistId = bodyInt(req.body, 'playlistId');
    const trackId = bodyInt(req.body, 'trackId');
    if (playlistId === null || trackId === null) return answered(req, reply, false, 'Pick both.') ?? reply.redirect(back('error=Pick+both.'));
    const current = (await playlistTracks(db, playlistId)).map((t) => t.id);
    if (!current.includes(trackId)) {
      await setPlaylistTracks(db, playlistId, [...current, trackId]);
    }
    return answered(req, reply, true) ?? reply.redirect(back('saved=1'));
  });

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/music/playlists/:id/remove-track',
    async (req, reply) => {
      const playlistId = Number.parseInt(req.params.id, 10);
      const trackId = bodyInt(req.body, 'trackId');
      const current = (await playlistTracks(db, playlistId)).map((t) => t.id);
      await setPlaylistTracks(db, playlistId, current.filter((t) => t !== trackId));
      return answered(req, reply, true) ?? reply.redirect(back('saved=1'));
    },
  );

  app.post<{ Body: Record<string, unknown> }>('/music/assign', async (req, reply) => {
    const botProfileId = bodyInt(req.body, 'botProfileId');
    const playlistId = bodyInt(req.body, 'playlistId');
    if (botProfileId === null || playlistId === null) return answered(req, reply, false, 'Pick a bot and a playlist.') ?? reply.redirect(back('error=Pick+a+bot+and+a+playlist.'));
    const id = await assignPlaylist(db, botProfileId, playlistId);
    await writeAudit(db, req.session?.username ?? 'unknown', 'music.assign', `assignment:${String(id)}`, { botProfileId, playlistId });
    if (bodyString(req.body, 'ajax') === '1') return reply.send({ ok: true, id });
    return reply.redirect(`/music?bot=${String(botProfileId)}&saved=1`);
  });

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/music/assignments/:id/cadence',
    async (req, reply) => {
      const id = Number.parseInt(req.params.id, 10);
      const a = await getAssignment(db, id);
      if (a === null) return answered(req, reply, false, 'No such assignment.') ?? reply.redirect(back('error=No+such+assignment.'));
      const destGroupId = bodyInt(req.body, 'destGroupId');
      const intervalMinutes = bodyInt(req.body, 'intervalMinutes');
      const messageCount = bodyInt(req.body, 'messageCount');
      if (destGroupId === null) {
        const msg = 'A cadence needs a destination group.';
        return answered(req, reply, false, msg) ?? reply.redirect(back('error=' + encodeURIComponent(msg)));
      }
      if (intervalMinutes === null && messageCount === null) {
        const msg = 'At least one trigger is required: an interval, a message count, or both.';
        return answered(req, reply, false, msg) ?? reply.redirect(back('error=' + encodeURIComponent(msg)));
      }
      await setAssignmentCadence(db, id, { destGroupId, intervalMinutes, messageCount });
      await writeAudit(db, req.session?.username ?? 'unknown', 'music.assignment.cadence', `assignment:${String(id)}`, { destGroupId, intervalMinutes, messageCount });
      return answered(req, reply, true) ?? reply.redirect(`/music?bot=${String(a.botProfileId)}&saved=1`);
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/music/assignments/:id/onrequest',
    async (req, reply) => {
      const id = Number.parseInt(req.params.id, 10);
      const a = await getAssignment(db, id);
      if (a === null) return answered(req, reply, false, 'No such assignment.') ?? reply.redirect(back('error=No+such+assignment.'));
      await setAssignmentOnRequest(db, id);
      await writeAudit(db, req.session?.username ?? 'unknown', 'music.assignment.onrequest', `assignment:${String(id)}`, {});
      return answered(req, reply, true) ?? reply.redirect(`/music?bot=${String(a.botProfileId)}&saved=1`);
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/music/assignments/:id/delete',
    async (req, reply) => {
      const id = Number.parseInt(req.params.id, 10);
      const a = await getAssignment(db, id);
      if (a === null) return answered(req, reply, false, 'No such assignment.') ?? reply.redirect(back('error=No+such+assignment.'));
      await removeAssignment(db, id);
      await writeAudit(db, req.session?.username ?? 'unknown', 'music.assignment.delete', `assignment:${String(id)}`, {});
      return answered(req, reply, true) ?? reply.redirect(`/music?bot=${String(a.botProfileId)}&saved=1`);
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
    return answered(req, reply, true) ?? reply.redirect(back('saved=1'));
  });

}
