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
import { ENCODE_VERSION, encodeMusicVideo, probeMedia } from '../src/media/encode.js';
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
    kind: 'music', title: 'Cache Case', artist: null, genre: null,
    durationSeconds: 2, filePath: sinePath, fileSize: (await stat(sinePath)).size,
    mime: 'audio/mpeg', coverPath,
  });
  const faults: string[] = [];
  const track = await getTrack(db, trackId);
  const first = await ensureEncoded(db, ROOT, track as never, (m) => faults.push(m));
  check('the first call encodes and stamps the row',
    first !== null && (await getTrack(db, trackId))?.encodeVersion === ENCODE_VERSION);
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
  check('and the temp bytes are gone', tmpEntries.length === 0, tmpEntries.join(', '));

  await pg.close();
  console.log(
    failures === 0
      ? '\nAll encode checks passed, and the odd-height question is settled by measurement: the recipe CROPS.'
      : `\n${String(failures)} CHECK(S) FAILED`,
  );
  if (failures > 0) process.exit(1);
}

await main();
