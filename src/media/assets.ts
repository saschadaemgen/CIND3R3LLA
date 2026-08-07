/**
 * Operator-supplied chapter images (CCB-S4-047, D-149).
 *
 * ── WHY AN UPLOAD IS RE-ENCODED AND NEVER STORED AS SENT ─────────────────────
 *
 * The admin console is hostile-facing. Bytes arriving there are bytes somebody chose, and an
 * image file is a container that can carry a great deal that is not an image: EXIF with the
 * operator's home coordinates, a payload appended after the end marker, a polyglot that is a
 * valid PNG and a valid script.
 *
 * So nothing is stored as uploaded. Every file is decoded and RE-ENCODED by `sharp`, which
 * produces a new file from the decoded pixels: metadata is gone because it is not carried
 * over, trailing data is gone because it was never pixels, and a file `sharp` cannot decode
 * is rejected rather than saved. That is the same treatment member media already gets in
 * `strip.ts`, for the same reason, and it means the stored file is one this process wrote.
 *
 * The name is derived from the content hash rather than from the upload, because an
 * attacker-chosen filename is the other half of this class of problem and a hash cannot
 * traverse, collide with a system name, or carry an extension the operator did not intend.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';
import sharp from 'sharp';
import { log } from '../log.js';

/** Beyond this an upload is refused rather than resized: it is not a chapter illustration. */
export const ASSET_MAX_BYTES = 8 * 1024 * 1024;

/** What a stored chapter image is bounded to. Large enough to look composed, small enough to send. */
const ASSET_MAX_EDGE = 1280;
const ASSET_QUALITY = 82;

/**
 * The inline preview SimpleX carries beside the file.
 *
 * Kept well under the message envelope. The real bytes travel over XFTP; this is what a
 * client shows before the transfer completes, so it is a thumbnail and not a copy.
 */
const PREVIEW_EDGE = 320;
const PREVIEW_MAX_CHARS = 12000;

export class AssetError extends Error {}

/**
 * Resolves a stored asset's relative path against the asset root, refusing anything that
 * escapes it.
 *
 * The paths here are ones this module wrote, and the column has a CHECK that rejects absolute
 * and dot-dot values. This is the third layer, and it is here because it is the one that runs
 * at the moment the bytes are actually read.
 */
export function resolveAssetPath(assetRoot: string, relative: string): string {
  if (isAbsolute(relative) || normalize(relative).startsWith('..')) {
    throw new AssetError(`Asset path "${relative}" is not inside the asset root.`);
  }
  const root = resolve(assetRoot);
  const full = resolve(root, relative);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new AssetError(`Asset path "${relative}" resolves outside the asset root.`);
  }
  return full;
}

/**
 * Stores an uploaded image and returns its path relative to the asset root.
 *
 * Throws on anything `sharp` cannot decode as an image, which is the point: a rejected upload
 * is an operator seeing an error, and an accepted one is a file this process encoded.
 */
export async function storeChapterImage(
  assetRoot: string,
  upload: Buffer,
): Promise<{ relativePath: string; bytes: number; width: number; height: number }> {
  if (upload.length === 0) throw new AssetError('The uploaded file was empty.');
  if (upload.length > ASSET_MAX_BYTES) {
    throw new AssetError(
      `The uploaded file is ${String(Math.round(upload.length / 1024))} kB, over the ${String(
        ASSET_MAX_BYTES / 1024 / 1024,
      )} MB limit.`,
    );
  }

  let encoded: Buffer;
  let width = 0;
  let height = 0;
  try {
    const pipeline = sharp(upload, { failOn: 'error' })
      .rotate()
      .resize(ASSET_MAX_EDGE, ASSET_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: ASSET_QUALITY });
    const result = await pipeline.toBuffer({ resolveWithObject: true });
    encoded = result.data;
    width = result.info.width;
    height = result.info.height;
  } catch (err) {
    // Not swallowed into a generic failure: an operator needs to know their file was not an
    // image this process could read, rather than that "something went wrong".
    throw new AssetError(
      `That file could not be read as an image: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const name = `chapter-${createHash('sha256').update(encoded).digest('hex').slice(0, 16)}.jpg`;
  const root = resolve(assetRoot);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, name), encoded);
  log.info(`Stored chapter image ${name} (${String(encoded.length)} bytes, ${String(width)}x${String(height)}).`);
  return { relativePath: name, bytes: encoded.length, width, height };
}

/**
 * The inline preview for a stored asset, as SimpleX wants it.
 *
 * Returns `null` rather than throwing when the file is missing or unreadable. A chapter whose
 * image has gone is a chapter that ships as text, which the briefing is explicit about: a
 * missing image never blocks a chapter. It is logged, because a configured-but-failing image
 * is a fault and not a choice.
 */
export async function chapterImagePreview(
  assetRoot: string,
  relativePath: string,
): Promise<string | null> {
  try {
    const source = await readFile(resolveAssetPath(assetRoot, relativePath));
    for (const quality of [70, 60, 50, 40, 30]) {
      const buf = await sharp(source)
        .resize(PREVIEW_EDGE, PREVIEW_EDGE, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer();
      const uri = `data:image/jpg;base64,${buf.toString('base64')}`;
      if (uri.length <= PREVIEW_MAX_CHARS) return uri;
    }
    log.warn(`Chapter image ${relativePath} would not fit the preview budget; sending without one.`);
    return null;
  } catch (err) {
    log.warn(
      `Chapter image ${relativePath} could not be read (${
        err instanceof Error ? err.message : String(err)
      }); the chapter will ship as text.`,
    );
    return null;
  }
}
