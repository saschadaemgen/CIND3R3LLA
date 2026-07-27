/**
 * Sweeping abandoned receipt placeholders out of the files folder (CCB-S3-027 §4).
 *
 * WHAT THEY ARE. The core creates the destination file when a receipt STARTS, and
 * `storeMedia` renames it into `MEDIA_ROOT` when the receipt completes. Production
 * bears this out exactly: of 109 core file rows, 100 are gone from the files
 * folder (moved) and 9 remain, and those 9 are precisely the receipts that never
 * completed (eight `connected`, one `cancelled`). So a placeholder is created on
 * EVERY receipt and only survives a failed one. It recurs; it is not a one-off.
 *
 * WHY THEY MATTER. Zero bytes means no content, but the NAME is the member's own
 * device filename, and a name of the form `IMG_<date>_<time>.jpg` encodes when they took the
 * photograph. That is member metadata surviving an erasure request, the same class
 * of leak CCB-S3-011 addressed inside image files. A member who asked us to destroy
 * their content would not expect the filename to remain.
 *
 * WHY A SWEEP RATHER THAN A PER-MESSAGE UNLINK. For a DESTROYED message nothing
 * here is needed: `internal` core deletion runs `deleteFilesLocally`, which removes
 * the placeholder along with the row. The gap is everything else, and it is not
 * addressable per message: mapping one of our rows to its placeholder would mean
 * reading the core's own SQLite behind the SDK's back, and for a failed receipt we
 * never learned the stored name at all. A sweep needs none of that, and a
 * zero-byte file is unambiguous.
 *
 * THE AGE BOUND IS THE SAFETY PROPERTY. A receipt in flight legitimately has a
 * zero-byte file for as long as the transfer takes. Deleting that would abort a
 * live download. The bound is far beyond both the per-file receive timeout and the
 * ~48h XFTP relay expiry, so anything this removes is provably dead.
 */

import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { log } from '../log.js';

/**
 * Comfortably past the ~48h XFTP relay expiry: after this, a zero-byte placeholder
 * can never become a real file.
 */
export const STUB_MIN_AGE_MS = 72 * 60 * 60 * 1000;

export interface StubSweep {
  removed: number;
  /** Zero-byte files still too young to judge. */
  skippedInFlight: number;
}

/**
 * Removes abandoned zero-byte placeholders from the files folder.
 *
 * Only zero-byte files are touched, and only aged ones. A real received file is
 * never zero bytes, so this cannot remove content.
 */
export async function sweepFileStubs(
  filesFolder: string,
  now = Date.now(),
  minAgeMs = STUB_MIN_AGE_MS,
): Promise<StubSweep> {
  let removed = 0;
  let skippedInFlight = 0;

  let entries;
  try {
    entries = await readdir(filesFolder, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { removed, skippedInFlight };
    throw err;
  }

  for (const e of entries) {
    if (!e.isFile()) continue;
    const abs = join(filesFolder, e.name);
    let info;
    try {
      info = await stat(abs);
    } catch {
      continue;
    }
    if (info.size !== 0) continue;
    if (now - info.mtimeMs < minAgeMs) {
      skippedInFlight += 1;
      continue;
    }
    try {
      await unlink(abs);
      removed += 1;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') continue;
      // Not fatal, but not silent either: a placeholder we cannot remove is a
      // member filename we cannot remove.
      log.warn(
        `File stubs: could not remove an abandoned receipt placeholder (${code ?? 'unknown'}).`,
      );
    }
  }

  if (removed > 0) {
    // The COUNT only. The names are the member data this exists to delete.
    log.info(`File stubs: removed ${removed} abandoned receipt placeholder(s).`);
  }
  return { removed, skippedInFlight };
}
