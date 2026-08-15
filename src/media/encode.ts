/**
 * The music-video encoder (CCB-S5-044, D-216): a track with cover art becomes
 * one message with a working player, as `MsgContent.Video` carrying a
 * static-image MP4.
 *
 * ── THE RECIPE IS THE STAGE-0 PROOF, AS CODE ─────────────────────────────────
 *
 * Stage 0 of the audio work proved the shape on the host, with the operator
 * looking: a static-image MP4 fits one message with cover, title and player;
 * the audio stream is BYTE-COPIED (`-c:a copy`) so full quality survives; no
 * size or duration ceiling was found up to 7.4 MB and 5:34. What Stage 0 did
 * NOT leave behind is the command line - only its measured findings survive in
 * `1c23e55`'s message - so this file re-derives it, and the harness MEASURES
 * the properties the findings claim rather than trusting the prose. One of
 * those findings carries an internal tension worth naming: the message argues
 * for cropping one row (1319 -> 1318) and then reports the measured output as
 * 720x1320, which is what padding produces. This encoder CROPS - `crop one row
 * rather than pad one: no black pixels` is the recorded decision - and
 * `verify:music-encode` asserts the output dimension is the crop's, so
 * whichever sentence was wrong, the shipped behaviour is measured.
 *
 * ── WHY ffmpeg-static, AND WHY SPAWNED ──────────────────────────────────────
 *
 * `ffmpeg-static` is pinned in the lockfile (5.3.0, CCB-S5-042): the host is a
 * shared production box, the deploy rules say be additive, and a host upgrade
 * must not silently change what she encodes. It ships one binary and no
 * ffprobe, so measurement parses `ffmpeg -i`'s own stream lines.
 *
 * ── THE CACHE (the operator's decision) ─────────────────────────────────────
 *
 * Encodes are CACHED beside the track: storage is cheap and the first press
 * already starts a transfer he cannot speed up. `ENCODE_VERSION` is stamped on
 * the cached row so a recipe change re-encodes instead of serving stale; the
 * cache is derivable from the originals and can always be rebuilt.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const run = promisify(execFile);

/** Bump when the recipe changes; cached encodes with an older stamp re-encode. */
export const ENCODE_VERSION = 1;

/** A minute of still-image H.264 is small; the audio dominates. Bound the child anyway. */
const ENCODE_TIMEOUT_MS = 5 * 60_000;

export class EncodeError extends Error {}

function binary(): string {
  // ffmpeg-static types its export as `string`, but a broken install resolves
  // null at runtime; widen before checking rather than trusting the annotation.
  const resolved: unknown = ffmpegPath;
  if (typeof resolved !== 'string' || resolved.length === 0) {
    // A fault, not a choice (CCB-S3-023): the dependency is pinned, so its
    // absence means a broken install, and the send falls back to the coverless
    // shape rather than silently losing the track.
    throw new EncodeError('ffmpeg-static resolved no binary; the install is broken.');
  }
  return resolved;
}

/**
 * Encodes cover + audio into the one-message video shape.
 *
 * The recipe, argument by argument:
 *   -loop 1 -i cover        the still, repeated for the track's whole length
 *   -i audio                the track
 *   -map 0:v -map 1:a       exactly those two streams, nothing the tag smuggles
 *   -c:a copy               BYTE-COPIED audio - the Stage 0 quality guarantee
 *   -c:v libx264 -tune stillimage
 *   -pix_fmt yuv420p        the compatibility baseline every client decodes
 *   -vf crop=...            H.264 refuses an odd dimension; CROP one row/column
 *                           rather than pad one (no black pixels, the recorded
 *                           decision). trunc(x/2)*2 is the largest even number
 *                           not exceeding x, so at most one row and one column
 *                           are lost and none are invented.
 *   -r 2                    two frames a second of an unchanging picture keeps
 *                           the video stream near-free without confusing players
 *                           that dislike ultra-low rates.
 *   -shortest               the video ends when the audio does
 *   -movflags +faststart    the moov atom up front, so a client can start
 *                           playing before the file finishes arriving
 */
export async function encodeMusicVideo(input: {
  coverPath: string;
  audioPath: string;
  outPath: string;
}): Promise<void> {
  await mkdir(dirname(input.outPath), { recursive: true });
  try {
    await run(
      binary(),
      [
        '-y',
        '-loop', '1',
        '-i', input.coverPath,
        '-i', input.audioPath,
        '-map', '0:v',
        '-map', '1:a',
        '-c:a', 'copy',
        '-c:v', 'libx264',
        '-tune', 'stillimage',
        '-pix_fmt', 'yuv420p',
        '-vf', 'crop=trunc(iw/2)*2:trunc(ih/2)*2',
        '-r', '2',
        '-shortest',
        '-movflags', '+faststart',
        input.outPath,
      ],
      { timeout: ENCODE_TIMEOUT_MS, windowsHide: true },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new EncodeError(`ffmpeg failed: ${detail.slice(0, 500)}`);
  }
}

export interface ProbedMedia {
  /** Container duration in seconds, or null when ffmpeg printed none. */
  durationSeconds: number | null;
  /** First video stream's dimensions, or null for pure audio. */
  width: number | null;
  height: number | null;
}

/**
 * Measures a file with the one binary we ship: `ffmpeg -i` exits non-zero
 * ("At least one output file must be specified") but prints the stream table
 * to stderr, and that table is what the harness asserts the recipe against.
 * A parser this small earns its keep twice: the odd-height guarantee is
 * MEASURED, and the upload path reads a real duration instead of trusting a
 * tag that VBR files get wrong (the 64 kb/s lesson in 1c23e55).
 */
export async function probeMedia(path: string): Promise<ProbedMedia> {
  let stderr = '';
  try {
    await run(binary(), ['-hide_banner', '-i', path], {
      timeout: 30_000,
      windowsHide: true,
    });
  } catch (error) {
    stderr = (error as { stderr?: string }).stderr ?? '';
  }
  const duration = /Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(stderr);
  const durationSeconds =
    duration === null
      ? null
      : Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
  const video = /Stream #.*Video:.* (\d{2,5})x(\d{2,5})/.exec(stderr);
  return {
    durationSeconds,
    width: video === null ? null : Number(video[1]),
    height: video === null ? null : Number(video[2]),
  };
}
