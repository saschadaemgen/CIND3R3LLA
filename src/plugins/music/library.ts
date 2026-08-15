/**
 * The library's file side (CCB-S5-044, D-216): where a track's bytes live, what
 * the file already says about itself, and the cached encode.
 *
 * ── READ THE TAG, PRE-FILL, LET HIM CORRECT ──────────────────────────────────
 *
 * The operator's own track carries a 93 KB ID3v2 tag holding title, artist and
 * often the cover itself; making him retype what the file already says is work
 * nobody should do twice. `music-metadata` (pinned exact) reads the common
 * containers; whatever it finds pre-fills the form, whatever is wrong he
 * corrects, and a file with no tag pre-fills nothing rather than guessing.
 *
 * Duration comes from ffmpeg's own probe, not the tag: the tag's first frame
 * header on a VBR file is the Xing/LAME info frame, which is how a bitrate was
 * once misread as 64 kb/s (the 1c23e55 lesson) - the container measurement is
 * the honest one.
 *
 * ── THE TREE ─────────────────────────────────────────────────────────────────
 *
 * MUSIC_ROOT/<trackId>/track.<ext>    the original, byte-identical to upload
 * MUSIC_ROOT/<trackId>/cover.jpg     the cover, re-encoded through sharp
 * MUSIC_ROOT/<trackId>/video-v<N>.mp4  the cached encode, recipe version N
 *
 * Addressed by track id, never by client-supplied name (the admin-media rule).
 * Plaintext, for the bridge-media reason: this is the operator's own broadcast
 * content, not member media (security §16).
 */

import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { parseFile, type IAudioMetadata } from 'music-metadata';
import type { Queryable } from '../../db/pool.js';
import { ENCODE_VERSION, EncodeError, encodeMusicVideo, probeMedia } from '../../media/encode.js';
import { log } from '../../log.js';
import { getTrack, setTrackCover, setTrackEncoded, type Track } from './store.js';

/** What the tag pre-fills; every field correctable on the console. */
export interface ReadTags {
  title: string | null;
  artist: string | null;
  genre: string | null;
  durationSeconds: number | null;
  /** The embedded cover's bytes, when the tag carries one. */
  cover: Buffer | null;
}

export async function readTags(filePath: string): Promise<ReadTags> {
  let meta: IAudioMetadata | null = null;
  try {
    meta = await parseFile(filePath, { duration: false });
  } catch (error) {
    // A file the parser cannot read still enters the library - the tag is a
    // convenience, not a gate - and the operator types what it could not read.
    log.warn(
      `music: could not read tags from upload (${error instanceof Error ? error.message : String(error)}); fields start empty.`,
    );
  }
  const probe = await probeMedia(filePath);
  const picture = meta?.common.picture?.[0];
  return {
    title: meta?.common.title?.trim() || null,
    artist: meta?.common.artist?.trim() || null,
    genre: meta?.common.genre?.[0]?.trim() || null,
    durationSeconds:
      probe.durationSeconds === null ? null : Math.round(probe.durationSeconds),
    cover: picture === undefined ? null : Buffer.from(picture.data),
  };
}

function extensionOf(originalName: string): string {
  const m = /\.[A-Za-z0-9]{1,5}$/.exec(originalName);
  return m === null ? '.bin' : m[0].toLowerCase();
}

/** Moves an uploaded temp file into the track's directory; returns final paths. */
export async function storeTrackFile(
  musicRoot: string,
  trackId: number,
  tempPath: string,
  originalName: string,
): Promise<{ filePath: string }> {
  const dir = join(musicRoot, String(trackId));
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `track${extensionOf(originalName)}`);
  await rename(tempPath, filePath).catch(async (err: unknown) => {
    if ((err as { code?: string }).code !== 'EXDEV') throw err;
    const { copyFile, unlink } = await import('node:fs/promises');
    await copyFile(tempPath, filePath);
    await unlink(tempPath);
  });
  return { filePath };
}

/**
 * Stores a cover for a track, re-encoded through sharp exactly as the asset
 * store does (rotate, bound, jpeg): a tag-embedded picture is bytes a stranger
 * authored, and re-encoding is what keeps a crafted image from being served
 * back as-is.
 */
export async function storeTrackCover(
  db: Queryable,
  musicRoot: string,
  trackId: number,
  imageBytes: Buffer,
): Promise<string> {
  const dir = join(musicRoot, String(trackId));
  await mkdir(dir, { recursive: true });
  const coverPath = join(dir, 'cover.jpg');
  const out = await sharp(imageBytes)
    .rotate()
    .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  await writeFile(coverPath, out);
  await setTrackCover(db, trackId, coverPath);
  return coverPath;
}

export async function removeTrackFiles(musicRoot: string, trackId: number): Promise<void> {
  await rm(join(musicRoot, String(trackId)), { recursive: true, force: true });
}

/**
 * The cached encode, made if missing or stale (the operator's decision:
 * cached). Returns null for a coverless track - that is the two-message send
 * shape, not an error - and null on an encode FAULT, which is logged and
 * surfaced (CCB-S3-023) while the send degrades to the coverless shape rather
 * than losing the track.
 */
export async function ensureEncoded(
  db: Queryable,
  musicRoot: string,
  track: Track,
  onFault: (message: string) => void,
): Promise<string | null> {
  if (track.coverPath === null) return null;
  if (
    track.encodedPath !== null &&
    track.encodeVersion === ENCODE_VERSION &&
    (await stat(track.encodedPath).catch(() => null)) !== null
  ) {
    return track.encodedPath;
  }
  const outPath = join(musicRoot, String(track.id), `video-v${String(ENCODE_VERSION)}.mp4`);
  try {
    await encodeMusicVideo({ coverPath: track.coverPath, audioPath: track.filePath, outPath });
    await setTrackEncoded(db, track.id, outPath, ENCODE_VERSION);
    return outPath;
  } catch (error) {
    const message =
      error instanceof EncodeError ? error.message : `unexpected: ${String(error)}`;
    log.error(`music: encoding track ${String(track.id)} failed: ${message}`);
    onFault(`Music: encoding "${track.title}" failed: ${message}`);
    return null;
  }
}

/** Re-reads the row after an encode may have stamped it. */
export async function freshTrack(db: Queryable, id: number): Promise<Track | null> {
  return await getTrack(db, id);
}

/**
 * The real storage figures, for the console (ground rule 3: report real
 * figures, not estimates): originals+covers and cached encodes measured
 * separately, so the cached-encode cost the operator accepted is visible as
 * its own number.
 */
export async function libraryDiskUsage(
  musicRoot: string,
): Promise<{ originalsBytes: number; encodedBytes: number }> {
  const { readdir } = await import('node:fs/promises');
  let originals = 0;
  let encoded = 0;
  const dirs = await readdir(musicRoot, { withFileTypes: true }).catch(() => []);
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const files = await readdir(join(musicRoot, d.name), { withFileTypes: true }).catch(() => []);
    for (const f of files) {
      if (!f.isFile()) continue;
      const s = await stat(join(musicRoot, d.name, f.name)).catch(() => null);
      if (s === null) continue;
      if (f.name.startsWith('video-v')) encoded += s.size;
      else originals += s.size;
    }
  }
  return { originalsBytes: originals, encodedBytes: encoded };
}
