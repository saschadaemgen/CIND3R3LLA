/**
 * The encoder, against the REAL ffmpeg (CCB-S5-044, D-216): the Stage-0 recipe
 * re-derived as code, with its measured findings MEASURED again rather than
 * trusted - including the one the record contradicts itself on.
 *
 * ── THE 1318/1320 SETTLEMENT ─────────────────────────────────────────────────
 *
 * `1c23e55`'s message argues for cropping one row (odd height minus one) and
 * then reports the measured output as 720x1320, which is what PADDING produces.
 * One of those sentences is wrong. This harness feeds the encoder an odd-height
 * cover and asserts the output is the CROP's dimension - the recorded decision
 * ("no black pixels") - so whichever sentence was wrong, the shipped behaviour
 * is now the measured one and this file is the record of the measurement.
 *
 * Needs no Ollama and no core; it does need the pinned ffmpeg-static binary,
 * which ships in node_modules, so it runs in the offline set.
 *
 *   npx tsx scripts/verify-music-encode.ts
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import ffmpegPath from 'ffmpeg-static';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import type { Queryable } from '../src/db/pool.js';
import { loadMigrationFiles } from '../src/db/migrate.js';
import { createHash } from 'node:crypto';
import { ENCODE_RECIPE, ENCODE_VERSION, encodeMusicVideo, probeMedia } from '../src/media/encode.js';
import { ensureEncoded, readTags } from '../src/plugins/music/library.js';
import { getTrack, insertTrack } from '../src/plugins/music/store.js';
import { playMemberUpload, type MusicDeps } from '../src/plugins/music/service.js';
import type { MusicSendPort } from '../src/bot/music-port.js';
import { MUSIC_DEFAULTS } from '../src/plugins/music/settings.js';
import { setLogLevel } from '../src/log.js';

const run = promisify(execFile);

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? `: ${detail}` : ''}`);
}

const ROOT = './state/verify-music-encode';

/** A minimal ID3v2.3 tag: TIT2, TPE1, TCON, and an APIC carrying `jpeg`. */
function buildId3(title: string, artist: string, genre: string, jpeg: Buffer): Buffer {
  const textFrame = (id: string, value: string): Buffer => {
    const body = Buffer.concat([Buffer.from([0]), Buffer.from(value, 'latin1')]);
    const head = Buffer.alloc(10);
    head.write(id, 0, 'latin1');
    head.writeUInt32BE(body.length, 4);
    return Buffer.concat([head, body]);
  };
  const apicBody = Buffer.concat([
    Buffer.from([0]),
    Buffer.from('image/jpeg', 'latin1'),
    Buffer.from([0, 3, 0]), // mime NUL, picture type 3 (front cover), empty desc NUL
    jpeg,
  ]);
  const apicHead = Buffer.alloc(10);
  apicHead.write('APIC', 0, 'latin1');
  apicHead.writeUInt32BE(apicBody.length, 4);
  const frames = Buffer.concat([
    textFrame('TIT2', title),
    textFrame('TPE1', artist),
    textFrame('TCON', genre),
    apicHead,
    apicBody,
  ]);
  const header = Buffer.alloc(10);
  header.write('ID3', 0, 'latin1');
  header[3] = 3; // v2.3
  // Synchsafe size: 7 bits per byte.
  const size = frames.length;
  header[6] = (size >>> 21) & 0x7f;
  header[7] = (size >>> 14) & 0x7f;
  header[8] = (size >>> 7) & 0x7f;
  header[9] = size & 0x7f;
  return Buffer.concat([header, frames]);
}

async function ffmpegStderr(args: string[]): Promise<string> {
  try {
    await run(ffmpegPath as string, args, { timeout: 60_000, windowsHide: true });
    return '';
  } catch (error) {
    return (error as { stderr?: string }).stderr ?? '';
  }
}

async function main(): Promise<void> {
  setLogLevel('error');
  await rm(ROOT, { recursive: true, force: true });
  await mkdir(ROOT, { recursive: true });

  console.log('\n1. The fixtures are real: a sine MP3 and an odd-height cover');
  const sinePath = join(ROOT, 'sine.mp3');
  await run(
    ffmpegPath as string,
    ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'libmp3lame', '-q:a', '9', sinePath],
    { timeout: 60_000, windowsHide: true },
  );
  const sineProbe = await probeMedia(sinePath);
  check('the generated MP3 probes at ~2 seconds',
    sineProbe.durationSeconds !== null && Math.abs(sineProbe.durationSeconds - 2) < 0.5,
    String(sineProbe.durationSeconds));

  // 320x241: the odd height, in miniature, of the operator's 720x1319 sleeve.
  const coverPath = join(ROOT, 'cover.jpg');
  await writeFile(
    coverPath,
    await sharp({ create: { width: 320, height: 241, channels: 3, background: { r: 40, g: 80, b: 120 } } })
      .jpeg({ quality: 85 })
      .toBuffer(),
  );

  console.log('\n2. The recipe, measured (the 1318/1320 settlement in miniature)');
  const outPath = join(ROOT, 'video.mp4');
  await encodeMusicVideo({ coverPath, audioPath: sinePath, outPath });
  const probe = await probeMedia(outPath);
  check('the output exists and probes', (await stat(outPath)).size > 0 && probe.width !== null);
  check('H.264 got an even height', probe.height !== null && probe.height % 2 === 0, String(probe.height));
  check('and it is the CROP\'s dimension (241 -> 240), never the pad\'s (242)',
    probe.height === 240, `measured ${String(probe.width)}x${String(probe.height)}`);
  check('the width survived untouched', probe.width === 320);
  check('the video lasts as long as the audio (-shortest)',
    probe.durationSeconds !== null && Math.abs(probe.durationSeconds - 2) < 0.6,
    String(probe.durationSeconds));
  const streams = await ffmpegStderr(['-hide_banner', '-i', outPath]);
  check('the audio stream is BYTE-COPIED mp3, not re-encoded (the quality guarantee)',
    /Audio: mp3/.test(streams), /Audio: [a-z0-9]+/.exec(streams)?.[0] ?? 'no audio line');
  check('the container is faststart mp4 with H.264 stillimage video',
    /Video: h264/.test(streams));

  console.log('\n3. The tag read: what the file says, she does not retype');
  const jpegSmall = await sharp({ create: { width: 64, height: 97, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    .jpeg()
    .toBuffer();
  const taggedPath = join(ROOT, 'tagged.mp3');
  await writeFile(
    taggedPath,
    Buffer.concat([buildId3('Harbour Lights', 'The Quay', 'Folk', jpegSmall), await readFile(sinePath)]),
  );
  const tags = await readTags(taggedPath);
  check('title read from TIT2', tags.title === 'Harbour Lights', String(tags.title));
  check('artist read from TPE1', tags.artist === 'The Quay', String(tags.artist));
  check('genre read from TCON', tags.genre === 'Folk', String(tags.genre));
  check('the embedded cover came out of APIC', tags.cover !== null && tags.cover.length === jpegSmall.length);
  check('duration from the PROBE, not the tag (the VBR lesson)',
    tags.durationSeconds !== null && Math.abs(tags.durationSeconds - 2) < 1);

  console.log('\n4a. The recipe is PINNED to its version (D-222)');
  // Stage 0's uncommitted padding recipe ran on the host, stamped its encodes
  // v1, and the committed crop recipe - also v1 - could never tell them apart:
  // black bars on three sides, served forever. The pair below is the guard.
  // CHANGING THE RECIPE: bump ENCODE_VERSION in src/media/encode.ts and update
  // BOTH pinned values here in the same commit - that pair IS the review.
  const RECIPE_PIN = 'c0d13cb66ea07ef34edfb04b2a239a3235605280fc1b402a7c13cc5f369844c8';
  const VERSION_PIN = 2;
  const fingerprint = createHash('sha256').update(ENCODE_RECIPE.join(' ')).digest('hex');
  check('the recipe fingerprint matches the pin (a change here demands a version bump)',
    fingerprint === RECIPE_PIN, fingerprint);
  check('and ENCODE_VERSION matches the version pinned beside it',
    ENCODE_VERSION === VERSION_PIN, String(ENCODE_VERSION));

  console.log('\n4. The cache: encode once, serve from disk after');
  const pg = new PGlite({ extensions: { vector } });
  const db: Queryable = {
    async query(text, values) {
      const res = await pg.query(text, values ? [...values] : undefined);
      return { rows: res.rows as never[], rowCount: (res.affectedRows ?? res.rows.length) as number };
    },
  };
  for (const m of await loadMigrationFiles()) await pg.exec(m.sql);
  const trackId = await insertTrack(db, {
    kind: 'music', title: 'Cache Case', artist: null, album: null, genre: null,
    durationSeconds: 2, filePath: sinePath, fileSize: (await stat(sinePath)).size,
    mime: 'audio/mpeg', coverPath,
  });
  const faults: string[] = [];
  const track = await getTrack(db, trackId);
  const first = await ensureEncoded(db, ROOT, track as never, (m) => faults.push(m));
  check('the first call encodes and stamps the row',
    first !== null && (await getTrack(db, trackId))?.encodeVersion === ENCODE_VERSION);
  // D-222: a row stamped with an OLDER version is retired stock - ensureEncoded
  // must re-encode it, never serve it, whatever file its old path holds.
  await db.query(`UPDATE cinderella_tracks SET encode_version = 1 WHERE id = $1`, [trackId]);
  const reEncoded = await ensureEncoded(db, ROOT, (await getTrack(db, trackId)) as never, (m) => faults.push(m));
  check('a cached encode with an older version stamp is RE-ENCODED, not served (D-222)',
    reEncoded !== null && (await getTrack(db, trackId))?.encodeVersion === ENCODE_VERSION,
    `re-stamped: ${String((await getTrack(db, trackId))?.encodeVersion)}`);
  const mtime = first === null ? 0 : (await stat(first)).mtimeMs;
  const again = await ensureEncoded(db, ROOT, (await getTrack(db, trackId)) as never, (m) => faults.push(m));
  check('the second call serves the cache: same path, file untouched',
    again === first && (again === null ? 0 : (await stat(again)).mtimeMs) === mtime);
  check('no fault was raised on either', faults.length === 0, faults.join(' | '));

  console.log('\n5. A member\'s upload end to end, real bytes, fake port');
  const calls: { kind: string; caption?: string; duration?: number }[] = [];
  const fakePort: MusicSendPort = {
    async sendVideo(_g, _p, caption, _c, duration) {
      calls.push({ kind: 'video', caption, duration });
      return { itemId: 1, sharedMsgId: 's', raw: null };
    },
    async sendVoice(_g, _p, duration) {
      calls.push({ kind: 'voice', duration });
      return { itemId: 2, sharedMsgId: 's2', raw: null };
    },
    async sendText(_g, text) {
      calls.push({ kind: 'text', caption: text });
      return { itemId: 3, sharedMsgId: 's3', raw: null };
    },
  };
  const deps: MusicDeps = {
    db,
    port: () => fakePort,
    isEnabledFor: () => true,
    uploadsEnabledFor: () => true,
    langFor: () => 'en',
    musicRoot: ROOT,
    settings: () => ({ ...MUSIC_DEFAULTS }),
    onFault: (m) => faults.push(m),
  };
  // The "captured member file": at-rest passes plaintext through when no
  // MEDIA_SECRET is set, so the fixture is the tagged mp3 under a media path.
  const mediaPath = join(ROOT, 'member-upload.mp3');
  await writeFile(mediaPath, await readFile(taggedPath));
  const tracksBefore = (await db.query<{ n: string }>(`SELECT count(*) AS n FROM cinderella_tracks`)).rows[0]?.n;

  calls.length = 0;
  const withCover = await playMemberUpload(deps, 1, 77, {
    mediaPath, mime: 'audio/mpeg', size: (await stat(mediaPath)).size, name: 'member-upload.mp3',
  });
  check('an upload whose tag carries a cover comes back as the VIDEO shape',
    withCover.ok && withCover.shape === 'video' && calls.some((c) => c.kind === 'video'),
    JSON.stringify(calls));
  check('  captioned from its own tag', calls.find((c) => c.kind === 'video')?.caption === 'Harbour Lights');

  const plainPath = join(ROOT, 'member-plain.mp3');
  await writeFile(plainPath, await readFile(sinePath));
  calls.length = 0;
  const plain = await playMemberUpload(deps, 1, 77, {
    mediaPath: plainPath, mime: 'audio/mpeg', size: (await stat(plainPath)).size, name: 'member-plain.mp3',
  });
  check('a coverless upload comes back as the voice player', plain.ok && plain.shape === 'voice');

  check('PLAYED WITHOUT BEING STORED: the library gained nothing',
    (await db.query<{ n: string }>(`SELECT count(*) AS n FROM cinderella_tracks`)).rows[0]?.n === tracksBefore);
  const leftovers = await stat(join(ROOT, '.playback-tmp')).catch(() => null);
  const tmpEntries = leftovers === null ? [] : await (await import('node:fs/promises')).readdir(join(ROOT, '.playback-tmp'));
  // D-224 changed this contract deliberately: the core uploads AFTER the
  // send command returns, from the path it was given, so a SENT playback
  // keeps its bytes (the tick sweeps the spool after a day - proven in
  // verify:music). Gone-too-early was the very mechanism that stranded 205
  // outbound files in the core's 'new' state.
  check('and the SENT bytes outlive the command, for the async upload (D-224)',
    tmpEntries.length === 2, tmpEntries.join(', '));

  console.log('\n6. The upload route answers BEFORE the encode runs (the 504 lesson)');
  //
  // The first real upload died as a 504: the encode ran inside the request and
  // outran nginx's 60-second proxy_read_timeout. The design fix is measured
  // here: the route returns with the row stored and the encode QUEUED, and the
  // queue handler - not the request - produces the file. A regression that
  // moves the encode back into the request turns the encoded-path-still-NULL
  // assertion red.
  {
    const argon2 = await import('argon2');
    const { buildServer, registerNav } = await import('../src/web/server.js');
    const { registerAdminViews } = await import('../src/web/views/index.js');
    const { SettingsService } = await import('../src/settings/service.js');
    const { SecurityService } = await import('../src/security/settings.js');
    const { InteractionService } = await import('../src/interaction/settings.js');
    const { setMusicJobDeps, musicEncodeHandler, MUSIC_ENCODE_JOB } = await import('../src/queue/jobs/music.js');

    const OPERATOR = 'operator';
    const PASSWORD = 'a-long-enough-test-password-0123456789';
    const adminCfg = {
      adminPort: 8809,
      adminUsername: OPERATOR,
      adminPasswordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
      sessionSecret: 'music-encode-secret-0123456789abcdef000000',
      publicOrigin: 'https://admin.example.org',
      rpId: 'admin.example.org',
      webauthnOrigin: 'https://admin.example.org',
      rpName: 'Cinderella Admin',
    } as never;
    const cfg = {
      mediaRoot: './state/preview-media',
      assetRoot: './state/preview-assets',
      musicRoot: ROOT,
      backupStatusPath: './state/backup-status.json',
      backupRequestPath: './state/backup-request',
      backupProgressPath: './state/backup-progress.json',
      avatarPath: '',
      databaseUrl: 'postgres://placeholder@127.0.0.1:5432/x',
      logLevel: 'error',
    } as never;

    registerNav();
    const app = buildServer({
      db,
      adminCfg,
      mediaRoot: './state/preview-media',
      settings: await SettingsService.load(db, 'error'),
      security: await SecurityService.load(db),
      interaction: await InteractionService.load(db),
      cfg,
      registerViews: registerAdminViews,
    } as never);
    await app.ready();

    const loginPage = await app.inject({ method: 'GET', url: '/login' });
    const loginCookie = String(loginPage.headers['set-cookie'] ?? '');
    const loginToken = /name="_csrf" value="([^"]+)"/.exec(loginPage.body)?.[1] ?? '';
    const login = await app.inject({
      method: 'POST',
      url: '/login',
      headers: { cookie: loginCookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `username=${OPERATOR}&password=${encodeURIComponent(PASSWORD)}&_csrf=${encodeURIComponent(loginToken)}`,
    });
    const rawCookie = login.headers['set-cookie'];
    const cookie = (Array.isArray(rawCookie) ? rawCookie : [String(rawCookie ?? '')])
      .map((c) => c.split(';')[0])
      .join('; ');
    const musicPage = await app.inject({ method: 'GET', url: '/music', headers: { cookie } });
    const csrf = /name="_csrf" value="([^"]+)"/.exec(musicPage.body)?.[1] ?? '';

    // Give a bot profile so the page resolves, and stamp the queue deps.
    await db.query(
      `INSERT INTO cinderella_bot_profiles (slug, display_name, enabled)
       VALUES ('encoder', 'CIND3R3LLA', TRUE) ON CONFLICT DO NOTHING`,
    );
    setMusicJobDeps(() => ({
      db,
      port: () => null,
      isEnabledFor: () => true,
      uploadsEnabledFor: () => false,
      langFor: () => 'en',
      musicRoot: ROOT,
      settings: () => ({ ...MUSIC_DEFAULTS }),
      onFault: (m) => faults.push(m),
    }));

    const audioB64 = (await readFile(taggedPath)).toString('base64');
    const body = new URLSearchParams();
    body.set('_csrf', csrf);
    body.set('ajax', '1');
    body.set('imageData', audioB64);
    body.set('fileName', 'route-upload.mp3');
    // The TYPED values win over the tag (the first-use fix): the tag says
    // Folk / The Quay; the operator types Shanty and leaves artist blank.
    body.set('title', '');
    body.set('artist', '');
    body.set('genre', 'Shanty');
    body.set('kind', 'music');
    body.set('coverData', '');
    const uploaded = await app.inject({
      method: 'POST',
      url: '/music/tracks/upload',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: body.toString(),
    });
    let json: { ok: boolean; trackId: number; title: string; hadCover: boolean };
    try {
      json = JSON.parse(uploaded.body) as typeof json;
    } catch {
      json = { ok: false, trackId: 0, title: '', hadCover: false };
    }
    check('the route answered ok, as JSON for the multi-uploader',
      uploaded.statusCode === 200 && json.ok,
      `${String(uploaded.statusCode)} ${uploaded.body.slice(0, 160)}`);
    check('  the TAG filled what was left blank (title)', json.title === 'Harbour Lights');
    const row = await db.query<{ genre: string | null; artist: string | null; encoded_path: string | null; cover_path: string | null }>(
      `SELECT genre, artist, encoded_path, cover_path FROM cinderella_tracks WHERE id = $1`,
      [json.trackId],
    );
    check('  and the TYPED genre won over the tag', row.rows[0]?.genre === 'Shanty', String(row.rows[0]?.genre));
    check('  the tag cover was stored', row.rows[0]?.cover_path !== null);
    check('THE 504 FIX: the request returned with the encode NOT yet done',
      row.rows[0]?.encoded_path === null);
    const job = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM jobs WHERE type = $1 AND state = 'queued'`,
      [MUSIC_ENCODE_JOB],
    );
    check('  and a music.encode job is queued instead', Number(job.rows[0]?.n) >= 1, String(job.rows[0]?.n));

    await musicEncodeHandler({ trackId: json.trackId }, {} as never);
    const after = await db.query<{ encoded_path: string | null }>(
      `SELECT encoded_path FROM cinderella_tracks WHERE id = $1`,
      [json.trackId],
    );
    check('POSITIVE CONTROL: the queue handler produced the encode', after.rows[0]?.encoded_path !== null);
    check('  and the file is real',
      after.rows[0]?.encoded_path !== null && (await stat(after.rows[0].encoded_path)).size > 0);
    setMusicJobDeps(null);
    await app.close();
  }

  await pg.close();
  console.log(
    failures === 0
      ? '\nAll encode checks passed, and the odd-height question is settled by measurement: the recipe CROPS.'
      : `\n${String(failures)} CHECK(S) FAILED`,
  );
  if (failures > 0) process.exit(1);
}

await main();
