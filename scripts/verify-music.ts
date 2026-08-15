/**
 * The music plugin (CCB-S5-044, D-216/D-217): the two send shapes, the playlist
 * boundary, the cadence with the operator's budgets, and the profile fence.
 *
 * ── WHAT IS PROVEN ───────────────────────────────────────────────────────────
 *
 *  1. THE COVER DECIDES THE SHAPE: with one, exactly one video send carrying
 *     caption, preview path and duration; without one, exactly two sends -
 *     the title as text, then the voice player with an EMPTY caption.
 *  2. Asked directly, through the REAL engine: which playlists (locked, the
 *     application's list), what's on one, play something (the track IS the
 *     reply - no text line), an unknown title answered honestly without
 *     echoing it, and the busy line while a send is in flight.
 *  3. THE BRIEFING-NAMED MUTATION: a bot asked to play from a playlist it was
 *     not given cannot - proven at the data layer, through the engine, AND by
 *     the positive control (the bot that WAS given it plays it).
 *  4. The cadence reuses the bridge's model: whichever trigger first, and the
 *     budgets bound it - SEPARATE for music and spots (the operator's
 *     decision), with the gap, and a requested play consuming neither.
 *  5. THE PROFILE FENCE (D-217): every play row has member_id NULL, the plays
 *     table is registered in the member-data registry under 'music'/profile,
 *     and no per-member aggregate is stored anywhere in migration 063.
 *  6. Part 4b is play-only and MP3-only, and the allow-list has TWO sides:
 *     the extension refuses an m4a that was accepted before this activation,
 *     the MAGIC BYTES refuse a renamed binary wearing .mp3, and both real
 *     openings (ID3 tag, frame sync) play. Too large, no file and capability
 *     off each get their own honest line - the size line carrying the LIVE
 *     bound - and a successful play stores NOTHING: no track, no play row,
 *     no archived message, and the workspace is swept.
 *  7. NO MODEL on the play path, asserted structurally.
 *
 * Every negative has a positive control: "bot B cannot play it" passes against
 * a library that plays nothing, so bot A playing the same title is beside it.
 *
 *   npx tsx scripts/verify-music.ts
 */

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { readFileSync } from 'node:fs';
import type { Queryable } from '../src/db/pool.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import { InteractionEngine } from '../src/interaction/engine.js';
import { capabilityCatalog, type Intent } from '../src/interaction/intent.js';
import { normalizeInteraction, type InteractionSettings } from '../src/interaction/settings.js';
import type { CapturedMessage } from '../src/capture/message.js';
import type { T } from '@simplex-chat/types';
import type { MusicSendPort } from '../src/bot/music-port.js';
import {
  playMemberUpload,
  playTrackToGroup,
  resetInFlight,
  runMusicTick,
  botMusicView,
  type MusicDeps,
} from '../src/plugins/music/service.js';
import {
  assignPlaylist,
  assignmentsForBot,
  createPlaylist,
  findTrackForBot,
  insertTrack,
  playlistTracks,
  randomTrackForBot,
  setAssignmentCadence,
  setPlaylistTracks,
  randomTrackFromPlaylistForBot,
  randomTrackByGenreForBot,
  libraryFactsForBot,
  trackReachableByBot,
  unbiddenSpend,
  libraryFacts,
  type Track,
} from '../src/plugins/music/store.js';
import { planCadence } from '../src/plugins/music/cadence.js';
import { resetMusicDiagnostics, musicDiagnostics } from '../src/plugins/music/music-log.js';
import { MUSIC_DEFAULTS, type MusicSettings } from '../src/plugins/music/settings.js';
import {
  MEMBER_DATA_SOURCES,
  deletableCategories,
} from '../src/members/data-registry.js';
import { setLogLevel } from '../src/log.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

const GROUP = 77;
const OTHER_GROUP = 78;
const NOW = new Date('2026-08-15T12:00:00Z');

interface PortCall {
  kind: 'video' | 'voice' | 'text';
  groupId: number;
  caption?: string;
  path?: string;
  duration?: number;
}

async function main(): Promise<void> {
  setLogLevel('error');
  const pg = new PGlite({ extensions: { vector } });
  const db: Queryable = {
    async query(text, values) {
      const res = await pg.query(text, values ? [...values] : undefined);
      return { rows: res.rows as never[], rowCount: (res.affectedRows ?? res.rows.length) as number };
    },
  };
  for (const m of await loadMigrationFiles()) await pg.exec(m.sql);

  const bots = await db.query<{ id: string }>(
    `INSERT INTO cinderella_bot_profiles (slug, display_name, enabled)
     VALUES ('dj', 'CIND3R3LLA', TRUE), ('quiet', 'Rick', TRUE) RETURNING id`,
  );
  const DJ = Number(bots.rows[0]?.id);
  const RICK = Number(bots.rows[1]?.id);

  const calls: PortCall[] = [];
  const fakePort: MusicSendPort = {
    async sendVideo(groupId, mp4Path, caption, _cover, duration) {
      calls.push({ kind: 'video', groupId, caption, path: mp4Path, duration });
      return { itemId: 900 + calls.length, sharedMsgId: `s-${String(calls.length)}`, raw: null };
    },
    async sendVoice(groupId, audioPath, duration) {
      calls.push({ kind: 'voice', groupId, path: audioPath, duration });
      return { itemId: 900 + calls.length, sharedMsgId: `s-${String(calls.length)}`, raw: null };
    },
    async sendText(groupId, text) {
      calls.push({ kind: 'text', groupId, caption: text });
      return { itemId: 900 + calls.length, sharedMsgId: `s-${String(calls.length)}`, raw: null };
    },
  };

  let clock = NOW;
  let musicSettings: MusicSettings = { ...MUSIC_DEFAULTS };
  let uploadsOn = false;
  const faults: string[] = [];
  const deps: MusicDeps = {
    db,
    port: () => fakePort,
    isEnabledFor: () => true,
    uploadsEnabledFor: () => uploadsOn,
    langFor: () => 'en',
    musicRoot: './state/verify-music-root',
    settings: () => musicSettings,
    onFault: (m) => faults.push(m),
    now: () => clock,
  };

  /* ══ 1. The cover decides the shape ══════════════════════════════════════ */

  console.log('\n1. The cover decides the shape');
  // The fake port never opens the paths, but ensureEncoded STATS the cached
  // encode before trusting the row (a cache the disk lost must re-encode), so
  // the covered track's paths must exist. Real bytes are verify:music-encode's
  // job; here a few placeholder bytes satisfy the stat.
  const root = deps.musicRoot;
  const { mkdir: mkdirF, writeFile: writeF, rm: rmF } = await import('node:fs/promises');
  await rmF(root, { recursive: true, force: true });
  await mkdirF(`${root}/1`, { recursive: true });
  await writeF(`${root}/1/cover.jpg`, Buffer.from('jpg'));
  await writeF(`${root}/1/video-v1.mp4`, Buffer.from('mp4'));
  const covered = await insertTrack(db, {
    kind: 'music', title: 'Harbour Lights', artist: 'The Quay', album: null, genre: 'folk',
    durationSeconds: 200, filePath: `${root}/1/track.mp3`, fileSize: 7_400_000,
    mime: 'audio/mpeg', coverPath: `${root}/1/cover.jpg`,
  });
  await db.query(
    `UPDATE cinderella_tracks SET encoded_path = $2, encoded_at = now(), encode_version = 1 WHERE id = $1`,
    [covered, `${root}/1/video-v1.mp4`],
  );
  const coverless = await insertTrack(db, {
    kind: 'music', title: 'Bare Voice', artist: null, album: null, genre: 'folk',
    durationSeconds: 90, filePath: '/x/2/track.mp3', fileSize: 3_000_000,
    mime: 'audio/mpeg', coverPath: null,
  });

  const t1 = (await db.query<{ id: string }>(`SELECT id FROM cinderella_tracks WHERE id=$1`, [covered])).rows[0];
  void t1;
  const coveredTrack = (await findTrackAnyBot(db, covered));
  const coverlessTrack = (await findTrackAnyBot(db, coverless));

  calls.length = 0;
  const out1 = await playTrackToGroup(deps, DJ, GROUP, coveredTrack, { requested: true, assignmentId: null });
  check('with a cover: ONE message', out1.sent && calls.length === 1, JSON.stringify(calls));
  check('  and it is the video shape', calls[0]?.kind === 'video' && out1.shape === 'video');
  check('  carrying the cached encode, the caption and the duration',
    calls[0]?.path === `${root}/1/video-v1.mp4` &&
    calls[0]?.caption === 'Harbour Lights - The Quay' &&
    calls[0]?.duration === 200);

  calls.length = 0;
  const out2 = await playTrackToGroup(deps, DJ, GROUP, coverlessTrack, { requested: true, assignmentId: null });
  check('without one: TWO messages', out2.sent && calls.length === 2, JSON.stringify(calls));
  check('  the title as its own text first', calls[0]?.kind === 'text' && calls[0]?.caption === 'Bare Voice');
  check('  then the voice player', calls[1]?.kind === 'voice' && calls[1]?.duration === 90);
  check('POSITIVE CONTROL: both plays were recorded',
    Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM cinderella_track_plays`)).rows[0]?.n) === 2);

  /* ══ 2+3. Asked directly, and the playlist boundary ══════════════════════ */

  console.log('\n2. Asked directly, through the real engine');

  const djList = await createPlaylist(db, 'Evening Set');
  await setPlaylistTracks(db, djList, [covered, coverless]);
  await assignPlaylist(db, DJ, djList);
  // Rick gets a DIFFERENT playlist so his positive control can play SOMETHING.
  const rickOnly = await insertTrack(db, {
    kind: 'music', title: 'Rick Anthem', artist: null, album: null, genre: 'rock',
    durationSeconds: 100, filePath: '/x/3/track.mp3', fileSize: 1_000_000,
    mime: 'audio/mpeg', coverPath: null,
  });
  const rickList = await createPlaylist(db, 'Rick Picks');
  await setPlaylistTracks(db, rickList, [rickOnly]);
  await assignPlaylist(db, RICK, rickList);

  let uploadOutcome: 'off' | 'too-large' = 'off';
  const musicOpsFor = (botId: number) => ({
    view: () => botMusicView(deps, botId),
    tracksOf: async (name: string) => {
      const assignments = await assignmentsForBot(db, botId);
      const hit = assignments.find((a) => a.playlistName.toLowerCase() === name.toLowerCase())
        ?? assignments.find((a) => a.playlistName.toLowerCase().includes(name.toLowerCase()));
      if (hit === undefined) return null;
      const tracks = await playlistTracks(db, hit.playlistId);
      return {
        playlist: hit.playlistName,
        items: tracks.map((t) => ({ id: t.id, title: t.title })),
        total: tracks.length,
      };
    },
    playById: async (groupId: number, trackId: number) => {
      if (!(await trackReachableByBot(db, botId, trackId))) return 'unknown' as const;
      const track = await findTrackAnyBot(db, trackId);
      const o = await playTrackToGroup(deps, botId, groupId, track, { requested: true, assignmentId: null });
      return o.busy ? ('busy' as const) : o.sent ? ('sent' as const) : ('unavailable' as const);
    },
    playFromPlaylist: async (groupId: number, name: string) => {
      const track = await randomTrackFromPlaylistForBot(db, botId, name);
      if (track === null) return 'empty' as const;
      const o = await playTrackToGroup(deps, botId, groupId, track, { requested: true, assignmentId: null });
      return o.busy ? ('busy' as const) : o.sent ? ('sent' as const) : ('unavailable' as const);
    },
    facts: async () => {
      // Per BOT (D-220), mirroring src/index.ts: the DJ sheet is what SHE
      // can reach, never the deployment's shelf.
      const f = await libraryFactsForBot(db, botId);
      return {
        tracks: f.tracks,
        genres: f.genres,
        playlists: (await assignmentsForBot(db, botId)).length,
      };
    },
    playByGenre: async (groupId: number, genre: string) => {
      const track = await randomTrackByGenreForBot(db, botId, genre);
      if (track === null) return 'empty' as const;
      const o = await playTrackToGroup(deps, botId, groupId, track, { requested: true, assignmentId: null });
      return o.busy ? ('busy' as const) : o.sent ? ('sent' as const) : ('unavailable' as const);
    },
    playByTitle: async (groupId: number, title: string) => {
      const track = await findTrackForBot(db, botId, title);
      if (track === null) return 'unknown' as const;
      const o = await playTrackToGroup(deps, botId, groupId, track, { requested: true, assignmentId: null });
      return o.busy ? ('busy' as const) : o.sent ? ('sent' as const) : ('unavailable' as const);
    },
    playSomething: async (groupId: number) => {
      const track = await randomTrackForBot(db, botId);
      if (track === null) return 'empty' as const;
      const o = await playTrackToGroup(deps, botId, groupId, track, { requested: true, assignmentId: null });
      return o.busy ? ('busy' as const) : o.sent ? ('sent' as const) : ('unavailable' as const);
    },
    playUpload: async () => uploadOutcome,
    uploadLimitBytes: () => musicSettings.memberUploadMaxBytes,
  });

  const catalog: Intent[] = capabilityCatalog(['MUSIC']);
  const settings: InteractionSettings = normalizeInteraction({});
  const replies: string[] = [];
  let itemId = 1;
  const makeMsg = (text: string, groupId: number = GROUP): CapturedMessage => ({
    groupId,
    groupName: 'archive',
    itemId: itemId++,
    sharedMsgId: undefined,
    senderMemberId: 'member-1',
    senderDisplayName: 'Alice',
    sentAt: clock.toISOString(),
    type: 'text',
    text,
    linkPreview: undefined,
    file: undefined,
    forwarded: false,
    quotedFromBot: false,
    raw: {} as T.AChatItem,
  });

  const engineFor = (botId: number) =>
    new InteractionEngine({
      capabilities: () => catalog,
      db,
      settings: () => settings,
      send: async (_msg, text) => {
        replies.push(text);
        return Promise.resolve();
      },
      now: () => clock.getTime(),
      music: () => musicOpsFor(botId),
    } as never);

  const dj = engineFor(DJ);
  const rick = engineFor(RICK);

  replies.length = 0;
  clock = new Date(clock.getTime() + 61_000);
  await dj.handle(makeMsg('CIND3R3LLA which playlists do you have?'));
  check('which playlists: the application list, with the count',
    replies.length === 1 && (replies[0] ?? '').includes('Evening Set (2)'), replies[0] ?? '(none)');

  replies.length = 0;
  clock = new Date(clock.getTime() + 61_000);
  await dj.handle(makeMsg("CIND3R3LLA what's on Evening Set?"));
  check("what's on: the titles",
    replies.length === 1 && (replies[0] ?? '').includes('Harbour Lights') && (replies[0] ?? '').includes('Bare Voice'),
    replies[0] ?? '(none)');

  replies.length = 0; calls.length = 0;
  clock = new Date(clock.getTime() + 61_000);
  await dj.handle(makeMsg('CIND3R3LLA play Harbour Lights'));
  check('play by title: the track goes out', calls.some((c) => c.kind === 'video'));
  check('  and NO text reply rides with it - the track is the reply', replies.length === 0, replies.join(' | '));

  replies.length = 0; calls.length = 0;
  clock = new Date(clock.getTime() + 61_000);
  await dj.handle(makeMsg('CIND3R3LLA play me something'));
  check('play me something: something went out', calls.length > 0);

  replies.length = 0; calls.length = 0;
  clock = new Date(clock.getTime() + 61_000);
  await dj.handle(makeMsg('CIND3R3LLA play The Unheld Title'));
  check('an unknown title: the honest line, with no echo of the title',
    replies.length === 1 && (replies[0] ?? '').includes('no track by that name') && !(replies[0] ?? '').includes('Unheld'),
    replies[0] ?? '(none)');
  check('  and nothing was sent', calls.length === 0);

  replies.length = 0; calls.length = 0;
  clock = new Date(clock.getTime() + 61_000);
  await dj.handle(makeMsg('CIND3R3LLA which track is on the list?'));
  check('THE BEHAVIOUR FAULT, held down: asking ABOUT a track plays NOTHING',
    calls.length === 0, JSON.stringify(calls));
  check('  and answers the locked overview with the application numbers',
    // '2 tracks': per BOT since D-220 - the sheet is what SHE can reach
    // (DJ's one playlist holds two), never the deployment's shelf of three.
    replies.length === 1 && (replies[0] ?? '').includes('2 tracks') && (replies[0] ?? '').includes('1 playlists'),
    replies[0] ?? '(none)');
  replies.length = 0; calls.length = 0;
  clock = new Date(clock.getTime() + 61_000);
  await dj.handle(makeMsg('CIND3R3LLA what is on the list?'));
  check('"what is on the list" answers honestly instead of falling through to a play',
    calls.length === 0 && replies.length === 1 && (replies[0] ?? '').includes('no playlist by that name'),
    replies[0] ?? '(none)');

  // The numbered conversation the operator asked for, end to end by NUMBER alone.
  replies.length = 0; calls.length = 0;
  clock = new Date(clock.getTime() + 61_000);
  await dj.handle(makeMsg('CIND3R3LLA which playlists do you have?'));
  check('the playlists come NUMBERED', (replies[0] ?? '').includes('1. Evening Set'), replies[0] ?? '');
  replies.length = 0;
  clock = new Date(clock.getTime() + 61_000);
  await dj.handle(makeMsg("CIND3R3LLA what's on 1?"));
  check('what\'s-on-a-NUMBER resolves against what she just listed',
    replies.length === 1 && (replies[0] ?? '').includes('1. Harbour Lights') && (replies[0] ?? '').includes('2. Bare Voice'),
    replies[0] ?? '(none)');
  replies.length = 0; calls.length = 0;
  clock = new Date(clock.getTime() + 61_000);
  await dj.handle(makeMsg('CIND3R3LLA play 2'));
  check('"play 2" plays the SECOND track of that list, by id',
    calls.length > 0 && calls.some((c) => c.caption === 'Bare Voice' || c.kind === 'voice'),
    JSON.stringify(calls));
  check('  with no text reply riding along', replies.length === 0, replies.join(' | '));
  replies.length = 0; calls.length = 0;
  clock = new Date(clock.getTime() + 61_000);
  await dj.handle(makeMsg('CIND3R3LLA play 9'));
  check('a number past the list answers honestly and plays nothing',
    calls.length === 0 && (replies[0] ?? '').includes('no track by that name'),
    replies[0] ?? '(none)');

  console.log('\n3. The playlist boundary (the briefing-named mutation)');
  check('data layer: the title resolves for the bot that was GIVEN it',
    (await findTrackForBot(db, DJ, 'Harbour Lights')) !== null);
  check('data layer: and NOT for the bot that was not',
    (await findTrackForBot(db, RICK, 'Harbour Lights')) === null);
  replies.length = 0; calls.length = 0;
  clock = new Date(clock.getTime() + 61_000);
  await rick.handle(makeMsg('CIND3R3LLA play Harbour Lights'));
  check('through the engine: the ungiven bot answers the honest line and sends nothing',
    calls.length === 0 && replies.length === 1 && (replies[0] ?? '').includes('no track by that name'));
  replies.length = 0; calls.length = 0;
  clock = new Date(clock.getTime() + 61_000);
  await rick.handle(makeMsg('CIND3R3LLA play Rick Anthem'));
  check('POSITIVE CONTROL: the same bot plays from its OWN playlist',
    calls.some((c) => c.kind === 'voice'), JSON.stringify(calls));
  // THE MUTATION: drop the assignment scoping - query without the bot join -
  // and the ungiven title becomes findable, which is what the boundary prevents.
  const unscoped = await db.query<{ id: string }>(
    `SELECT t.id FROM cinderella_tracks t WHERE lower(t.title) = lower($1) LIMIT 1`,
    ['Harbour Lights'],
  );
  check('MUTATION: without the assignment join, the ungiven title IS findable, so the join is load-bearing',
    unscoped.rows.length === 1);

  replies.length = 0; calls.length = 0;
  const { default: serviceModule } = { default: null };
  void serviceModule;
  // Busy: mark the group in flight through a hanging fake send.
  let release: (() => void) | null = null;
  const hangingPort: MusicSendPort = {
    ...fakePort,
    sendVideo: (groupId, mp4Path, caption, cover, duration) =>
      new Promise((resolve) => {
        release = () =>
          resolve(
            fakePort.sendVideo(groupId, mp4Path, caption, cover, duration) as never,
          );
      }),
  };
  const hangingDeps: MusicDeps = { ...deps, port: () => hangingPort };
  const first = playTrackToGroup(hangingDeps, DJ, GROUP, coveredTrack, { requested: true, assignmentId: null });
  await new Promise((r) => setTimeout(r, 10));
  const second = await playTrackToGroup(deps, DJ, GROUP, coveredTrack, { requested: true, assignmentId: null });
  check('one send at a time per group: the second is BUSY, not queued', second.busy && !second.sent);
  const third = await playTrackToGroup(deps, DJ, OTHER_GROUP, coverlessTrack, { requested: true, assignmentId: null });
  check('POSITIVE CONTROL: another group is not blocked', third.sent);
  release?.();
  await first;
  resetInFlight();

  replies.length = 0;
  clock = new Date(clock.getTime() + 61_000);
  await dj.handle(makeMsg('CIND3R3LLA make it playable'));
  check('4b through the engine while OFF: the honest off line',
    replies.length === 1 && (replies[0] ?? '').includes('switched off'), replies[0] ?? '(none)');

  // The too-large line reads the LIVE bound, so the operator raising the
  // ceiling on the console can never make her words stale.
  replies.length = 0;
  uploadOutcome = 'too-large';
  clock = new Date(clock.getTime() + 61_000);
  await dj.handle(makeMsg('CIND3R3LLA make it playable'));
  const liveBound = `${String(Math.round(musicSettings.memberUploadMaxBytes / (1024 * 1024)))} MB`;
  check('4b through the engine when TOO LARGE: the refusal carries the LIVE bound',
    replies.length === 1 && (replies[0] ?? '').includes(liveBound), replies[0] ?? '(none)');
  uploadOutcome = 'off';

  /* ══ 4. The cadence and the budgets ══════════════════════════════════════ */

  console.log('\n4. The cadence, and the operator\'s budgets');
  resetMusicDiagnostics();
  // Clean slate for budget arithmetic.
  await db.query(`DELETE FROM cinderella_track_plays`);
  const cadenceList = await createPlaylist(db, 'On A Timer');
  await setPlaylistTracks(db, cadenceList, [covered, coverless]);
  const cadenceAssignment = await assignPlaylist(db, DJ, cadenceList);
  await setAssignmentCadence(db, cadenceAssignment, {
    destGroupId: GROUP, intervalMinutes: 60, messageCount: null,
  });
  await db.query(`UPDATE cinderella_playlist_assignments SET created_at = $2 WHERE id = $1`,
    [cadenceAssignment, NOW]);

  calls.length = 0;
  clock = new Date(NOW.getTime() + 61 * 60_000);
  let report = await runMusicTick(deps);
  check('due by interval: one play went out', report.played === 1 && calls.length >= 1, JSON.stringify(report));
  const firstWasCovered = calls[0]?.kind === 'video';

  calls.length = 0;
  clock = new Date(clock.getTime() + 61 * 60_000);
  report = await runMusicTick(deps);
  check('shuffle without replacement: the SECOND tick plays the OTHER track',
    report.played === 1 &&
      (firstWasCovered
        ? calls.some((c) => c.caption === 'Bare Voice')
        : calls.some((c) => c.kind === 'video')),
    JSON.stringify(calls));

  // The gap binds before the daily cap: third slot due 61 min later is allowed
  // (gap 60), so spend the budget to its cap of 3 first...
  calls.length = 0;
  clock = new Date(clock.getTime() + 61 * 60_000);
  report = await runMusicTick(deps);
  check('third unbidden play spends the daily cap', report.played === 1);

  calls.length = 0;
  clock = new Date(clock.getTime() + 61 * 60_000);
  report = await runMusicTick(deps);
  const diag = musicDiagnostics();
  check('the FOURTH is refused: budget-spent, counted, nothing sent',
    report.played === 0 && calls.length === 0 && (report.skipped['budget-spent'] ?? 0) === 1,
    JSON.stringify(report));
  check('  and the skip reaches the diagnostics the console shows',
    diag.skips['budget-spent'] >= 1);

  // A REQUESTED play consumes no budget: still allowed right now.
  calls.length = 0;
  const requested = await playTrackToGroup(deps, DJ, GROUP, coveredTrack, { requested: true, assignmentId: null });
  check('a member asking is not the machine speaking: the requested play goes out over the spent budget',
    requested.sent);

  // SEPARATE BUDGETS: the music budget is spent; a spot still has its own.
  const spot = await insertTrack(db, {
    kind: 'spot', title: 'Visit The Bakery', artist: null, album: null, genre: null,
    durationSeconds: 20, filePath: '/x/4/track.mp3', fileSize: 500_000,
    mime: 'audio/mpeg', coverPath: null,
  });
  const spotList = await createPlaylist(db, 'Spots');
  await setPlaylistTracks(db, spotList, [spot]);
  const spotAssignment = await assignPlaylist(db, DJ, spotList);
  await setAssignmentCadence(db, spotAssignment, { destGroupId: GROUP, intervalMinutes: 30, messageCount: null });
  await db.query(`UPDATE cinderella_playlist_assignments SET created_at = $2 WHERE id = $1`,
    [spotAssignment, NOW]);
  calls.length = 0;
  clock = new Date(clock.getTime() + 61 * 60_000);
  report = await runMusicTick(deps);
  check("SEPARATE BUDGETS (the operator's decision): the spot plays although music is spent",
    calls.some((c) => c.caption === 'Visit The Bakery'), JSON.stringify(calls));
  check('  and the music assignment still skipped on ITS budget',
    (report.skipped['budget-spent'] ?? 0) >= 1);
  const spend = await unbiddenSpend(db, GROUP, true, clock);
  check('  the spot spend is counted in the spot class', spend.today === 1);

  // The GAP, on the spot budget: due again in 30 min but the gap is 60.
  calls.length = 0;
  clock = new Date(clock.getTime() + 31 * 60_000);
  report = await runMusicTick(deps);
  check('the minimum gap binds and says so', (report.skipped['gap-too-recent'] ?? 0) === 1 && calls.every((c) => c.caption !== 'Visit The Bakery'),
    JSON.stringify(report.skipped));

  // planCadence's pure branches, including the two orderings of whichever-first.
  const base = { mode: 'cadence' as const, intervalMinutes: 60, messageCount: 20, lastSentAt: null, createdAt: NOW };
  check('whichever comes first: the interval side',
    planCadence({ assignment: base, now: new Date(NOW.getTime() + 61 * 60_000), memberMessagesSinceLastSend: 0,
      budget: { today: 0, lastAt: null }, bounds: { dailyCap: 3, gapMinutes: 60 }, sendInFlight: false, playlistHasTracks: true }).send);
  check('whichever comes first: the count side',
    planCadence({ assignment: base, now: new Date(NOW.getTime() + 10 * 60_000), memberMessagesSinceLastSend: 20,
      budget: { today: 0, lastAt: null }, bounds: { dailyCap: 3, gapMinutes: 60 }, sendInFlight: false, playlistHasTracks: true }).send);
  check('a slot landing mid-transfer is skipped, not queued',
    planCadence({ assignment: base, now: new Date(NOW.getTime() + 61 * 60_000), memberMessagesSinceLastSend: 0,
      budget: { today: 0, lastAt: null }, bounds: { dailyCap: 3, gapMinutes: 60 }, sendInFlight: true, playlistHasTracks: true }).skip === 'send-in-flight');
  check('an empty playlist is a counted skip, not a crash',
    planCadence({ assignment: base, now: new Date(NOW.getTime() + 61 * 60_000), memberMessagesSinceLastSend: 0,
      budget: { today: 0, lastAt: null }, bounds: { dailyCap: 3, gapMinutes: 60 }, sendInFlight: false, playlistHasTracks: false }).skip === 'playlist-empty');

  /* ══ 5. The profile fence (D-217) ════════════════════════════════════════ */

  console.log('\n5. The profile fence');
  const memberIds = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM cinderella_track_plays WHERE member_id IS NOT NULL`,
  );
  check('EVERY play row has member_id NULL until the memory work lands',
    Number(memberIds.rows[0]?.n) === 0,
    `${String((await db.query<{ n: string }>(`SELECT count(*) AS n FROM cinderella_track_plays`)).rows[0]?.n)} plays, 0 attributed`);
  const registered = MEMBER_DATA_SOURCES.find((s) => s.table === 'cinderella_track_plays');
  check('the plays table is registered in the member-data registry',
    registered !== undefined && registered.class === 'profile' && registered.category === 'music');
  check('and "music" is a deletable category by the registry\'s own derivation',
    deletableCategories().includes('music'));
  const migration = readFileSync('migrations/063_music_library.sql', 'utf8');
  check('no per-member aggregate is stored: the migration carries no member counter column',
    !/member[a-z_]*count|count[a-z_]*member/i.test(migration));
  const dj2 = await libraryFacts(db, clock);
  check('the DJ sheet is derived per read: genres are the library\'s own GROUP BY',
    dj2.byGenre.every((g) => ['folk', 'rock'].includes(g.genre)),
    JSON.stringify(dj2.byGenre));

  /* ══ 6. Part 4b's refusals ═══════════════════════════════════════════════ */

  console.log("\n6. A member's upload: MP3 only, played and never kept");
  calls.length = 0;
  const preTracks = Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM cinderella_tracks`)).rows[0]?.n);
  const prePlays = Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM cinderella_track_plays`)).rows[0]?.n);
  const preMessages = Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM messages`)).rows[0]?.n);
  uploadsOn = false;
  let up = await playMemberUpload(deps, DJ, GROUP, { mediaPath: '/m/a.mp3', mime: 'audio/mpeg', size: 1000, name: 'a.mp3' });
  check('capability off: refused as off', !up.ok && up.refusal === 'capability-off');
  uploadsOn = true;
  up = await playMemberUpload(deps, DJ, GROUP, null);
  check('no file in sight: refused as no-file', !up.ok && up.refusal === 'no-file');
  up = await playMemberUpload(deps, DJ, GROUP, { mediaPath: '/m/a.exe', mime: 'application/x-msdownload', size: 1000, name: 'a.exe' });
  check('a binary: refused by the extension side of the allow-list', !up.ok && up.refusal === 'not-audio');
  up = await playMemberUpload(deps, DJ, GROUP, { mediaPath: '/m/a.m4a', mime: 'audio/mp4', size: 1000, name: 'a.m4a' });
  check('MP3 ONLY: an m4a, accepted before this activation, is refused now', !up.ok && up.refusal === 'not-audio');
  up = await playMemberUpload(deps, DJ, GROUP, { mediaPath: '/m/a.mp3', mime: 'audio/mpeg', size: musicSettings.memberUploadMaxBytes + 1, name: 'a.mp3' });
  check('too large: refused by the bound', !up.ok && up.refusal === 'too-large');

  // The allow-list's SECOND side: the extension is a claim, the bytes decide.
  // These fixtures are real files because the sniff runs on what was READ,
  // after the cheap refusals and before anything touches the workspace.
  const { readdir: readdirF } = await import('node:fs/promises');
  const fixDir = `${root}/.upload-fixtures`;
  await mkdirF(fixDir, { recursive: true });
  await writeF(`${fixDir}/renamed.mp3`, Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(60, 0x00)]));
  up = await playMemberUpload(deps, DJ, GROUP, { mediaPath: `${fixDir}/renamed.mp3`, mime: 'audio/mpeg', size: 64, name: 'renamed.mp3' });
  check('a renamed binary wearing .mp3: refused by the MAGIC BYTES', !up.ok && up.refusal === 'not-audio', JSON.stringify(up));
  check('every refusal above sent nothing', calls.length === 0, JSON.stringify(calls));

  // POSITIVE CONTROLS, one per door the sniff holds open: an ID3 opening and
  // a bare frame sync. Without these, a sniff that refused EVERYTHING would
  // pass every refusal check above.
  await writeF(`${fixDir}/tagged.mp3`, Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0, 0, 0, 0, 0]), Buffer.alloc(64, 0x55)]));
  up = await playMemberUpload(deps, DJ, GROUP, { mediaPath: `${fixDir}/tagged.mp3`, mime: 'audio/mpeg', size: 74, name: 'tagged.mp3' });
  check('an MP3 opening with an ID3 tag plays', up.ok && up.shape === 'voice', JSON.stringify(up));
  await writeF(`${fixDir}/plain.mp3`, Buffer.concat([Buffer.from([0xff, 0xfb]), Buffer.alloc(64, 0x55)]));
  up = await playMemberUpload(deps, DJ, GROUP, { mediaPath: `${fixDir}/plain.mp3`, mime: 'audio/mpeg', size: 66, name: 'plain.mp3' });
  check('an MP3 opening on a frame sync plays', up.ok && up.shape === 'voice', JSON.stringify(up));
  check('  both as the bare voice player, nothing else sent',
    calls.length === 2 && calls.every((c) => c.kind === 'voice'), JSON.stringify(calls));

  // Play only. NOTHING is stored, published or archived - which is WHY no
  // consent is needed - and the claim is counted, not asserted from memory.
  const postTracks = Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM cinderella_tracks`)).rows[0]?.n);
  const postPlays = Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM cinderella_track_plays`)).rows[0]?.n);
  const postMessages = Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM messages`)).rows[0]?.n);
  check('nothing entered the library: the track count did not move', postTracks === preTracks, `${String(preTracks)} -> ${String(postTracks)}`);
  check('nothing was recorded: no play row a future profile could ever read', postPlays === prePlays, `${String(prePlays)} -> ${String(postPlays)}`);
  check('nothing was archived: no message row, so nothing can ever publish', postMessages === preMessages, `${String(preMessages)} -> ${String(postMessages)}`);
  const leftovers = await readdirF(`${root}/.playback-tmp`).catch(() => [] as string[]);
  check('the playback workspace is swept after every send', leftovers.length === 0, JSON.stringify(leftovers));
  const uploadFn = readFileSync('src/plugins/music/service.ts', 'utf8')
    .split('export async function playMemberUpload')[1]
    ?.split('\nexport ')[0] ?? '';
  check('structurally: the upload path calls no store, no archive, no play recorder',
    uploadFn.length > 0 && !/archiveOwnSend|recordPlay|insertTrack|INSERT INTO/i.test(uploadFn));

  /* ══ 8. THE LIVE TEST'S OWN SENTENCES (D-220) ════════════════════════════
   *
   * The harness was green while three of these failed in production, because
   * it drove the phrasings the code was written for rather than the phrasings
   * a person uses. These are the operator's sentences, verbatim, and this
   * section exists so the next pattern change is measured against them.
   */

  console.log("\n8. The live test's own sentences, verbatim");
  const aurora = await insertTrack(db, {
    kind: 'music', title: 'Aurora Night', artist: 'Alusion', album: null, genre: 'Chillstep',
    durationSeconds: 210, filePath: '/x/aurora.mp3', fileSize: 5_000_000,
    mime: 'audio/mpeg', coverPath: null,
  });
  const deepW = await insertTrack(db, {
    kind: 'music', title: 'Deep Waters', artist: 'Alusion', album: null, genre: 'Chillstep',
    durationSeconds: 190, filePath: '/x/deepw.mp3', fileSize: 5_000_000,
    mime: 'audio/mpeg', coverPath: null,
  });
  const chillstepList = await createPlaylist(db, 'Chillstep');
  await setPlaylistTracks(db, chillstepList, [aurora, deepW]);
  await assignPlaylist(db, DJ, chillstepList);

  // "do you have Chillstep Music" reached NO lane in production: 'music' was
  // not a keyword, the model answered against no data, and a genre she holds
  // was denied. It must land in the music lane now, whose tail is the honest
  // locked overview naming that genre.
  replies.length = 0; calls.length = 0;
  clock = new Date(clock.getTime() + 61_000);
  await dj.handle(makeMsg('CIND3R3LLA do you have Chillstep Music'));
  check("'do you have Chillstep Music': the OVERVIEW answers, naming the genre she holds",
    replies.length === 1 && (replies[0] ?? '').includes('Chillstep'), replies[0] ?? '(none)');
  check('  and asking is not playing: nothing was sent', calls.length === 0, JSON.stringify(calls));

  replies.length = 0;
  clock = new Date(clock.getTime() + 61_000);
  await dj.handle(makeMsg('CIND3R3LLA what music do you have?'));
  check("'what music do you have?': the overview again, not silence",
    replies.length === 1 && (replies[0] ?? '').includes('Chillstep'), replies[0] ?? '(none)');

  // The second level: list the playlists, then ask in his words.
  replies.length = 0;
  clock = new Date(clock.getTime() + 61_000);
  await dj.handle(makeMsg('CIND3R3LLA which playlists do you have?'));
  const listedFirst = /1\. ([^,(]+)/.exec(replies[0] ?? '')?.[1]?.trim() ?? '';
  check('the playlist list numbers what she holds', listedFirst.length > 0, replies[0] ?? '(none)');
  replies.length = 0;
  clock = new Date(clock.getTime() + 61_000);
  await dj.handle(makeMsg('CIND3R3LLA Show me tracks from playlist 1'));
  check("'Show me tracks from playlist 1': the TRACKS of playlist 1, not the playlist list again",
    replies.length === 1 && (replies[0] ?? '').includes('On the playlist') && (replies[0] ?? '').includes(listedFirst),
    replies[0] ?? '(none)');

  // A number with NO live list resolves against the view's own order, because
  // the numbers she prints ARE that order (a fresh room, ten minutes later).
  const FRESH = 9911;
  replies.length = 0;
  clock = new Date(clock.getTime() + 61_000);
  await dj.handle(makeMsg("CIND3R3LLA what's on 1", FRESH));
  check("a numbered ask with no live list answers from the view's order, not 'unknown playlist'",
    replies.length === 1 && (replies[0] ?? '').includes('On the playlist'), replies[0] ?? '(none)');

  // "play Chillstep" named a playlist AND a genre she holds and was answered
  // "no track by that name". The ladder resolves it inside the boundary.
  replies.length = 0; calls.length = 0;
  clock = new Date(clock.getTime() + 61_000);
  await dj.handle(makeMsg('CIND3R3LLA play Chillstep'));
  check("'play Chillstep': something from the Chillstep playlist actually plays",
    calls.some((c) => c.kind === 'voice' || c.kind === 'video'), JSON.stringify(calls));
  check('  and no unknown-track line stands beside the send',
    !replies.some((r) => r.includes('no track by that name')), JSON.stringify(replies));

  // The exact title in a member's own words: title, dash, artist, courtesy.
  replies.length = 0; calls.length = 0;
  clock = new Date(clock.getTime() + 61_000);
  await dj.handle(makeMsg('CIND3R3LLA play Aurora Night - Alusion for us'));
  check("'play Aurora Night - Alusion for us': Aurora Night goes out",
    // The coverless title line composes 'Title - Artist'; the send is the claim.
    calls.some((c) => c.kind === 'text' && (c.caption ?? '').startsWith('Aurora Night')), JSON.stringify(calls));

  // NEGATIVE CONTROL: the ladder widened what resolves, not what she claims.
  replies.length = 0; calls.length = 0;
  clock = new Date(clock.getTime() + 61_000);
  await dj.handle(makeMsg('CIND3R3LLA play Vaporwave Dreams'));
  check('POSITIVE CONTROL of the honest miss: an unheld name still answers unknown, sends nothing',
    calls.length === 0 && replies.some((r) => r.includes('no track by that name')), JSON.stringify(replies));

  // BOUNDARY CONTROL: every new rung is assignment-scoped. The bot that was
  // never given Chillstep cannot reach it by playlist name or by genre.
  replies.length = 0; calls.length = 0;
  clock = new Date(clock.getTime() + 61_000);
  await rick.handle(makeMsg('CIND3R3LLA play Chillstep'));
  check('THE BOUNDARY HOLDS on the ladder: the other bot cannot play a playlist it was not given',
    calls.length === 0, JSON.stringify(calls));

  /* ══ 7. No model, structurally ═══════════════════════════════════════════ */

  console.log('\n7. No model on the play path');
  for (const f of ['service.ts', 'cadence.ts', 'store.ts', 'library.ts']) {
    const src = readFileSync(`src/plugins/music/${f}`, 'utf8');
    check(`plugins/music/${f} imports no reply generator and no personalize`,
      !/ollama-reply|generateOllamaReply|personalize/i.test(src));
  }

  await pg.close();
  console.log(
    failures === 0
      ? '\nAll music checks passed: the cover decides the shape, a playlist is a boundary, the budgets are separate, and every play is anonymous.'
      : `\n${String(failures)} CHECK(S) FAILED`,
  );
  if (failures > 0) process.exit(1);
}

async function findTrackAnyBot(db: Queryable, id: number): Promise<Track> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT * FROM cinderella_tracks WHERE id = $1`, [id],
  );
  const r = rows[0] as Record<string, never>;
  return {
    id: Number(r['id']),
    kind: r['kind'],
    title: r['title'],
    artist: r['artist'],
    genre: r['genre'],
    durationSeconds: r['duration_seconds'],
    filePath: r['file_path'],
    fileSize: Number(r['file_size']),
    mime: r['mime'],
    coverPath: r['cover_path'],
    encodedPath: r['encoded_path'],
    encodedAt: r['encoded_at'] === null ? null : new Date(r['encoded_at']),
    encodeVersion: r['encode_version'],
    uploadedAt: new Date(r['uploaded_at']),
  } as Track;
}

await main();
