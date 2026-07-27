/**
 * Physical segregation of quarantined media (CCB-S3-013 §4).
 *
 * THE GAP THIS CLOSES. Escalation and hash-match quarantine were enforced only in
 * the database: the `BEFORE DELETE` trigger stopped anyone destroying the row, and
 * the publish views stopped it being served publicly. But the admin console mounts
 * the WHOLE media tree by path, so a quarantined item's bytes stayed readable to
 * any authenticated admin session. Deletion was blocked; access was not. That does
 * not meet "accessible to nobody in normal operation", and a database state cannot
 * make it true, because the filesystem is what actually hands out the bytes.
 *
 * So the bytes MOVE. Quarantining a message relocates every file it owns into
 * `QUARANTINE_ROOT`, which lives outside `MEDIA_ROOT` and is served by nothing.
 * Anything that reads the media tree - the admin mount, a future thumbnailer, a
 * backup of MEDIA_ROOT, an operator with a shell - now finds the file simply
 * absent, because it is.
 *
 * WHAT QUARANTINE IS, precisely, and how it differs from an ordinary hold:
 *
 *   report hold  -> defers DESTRUCTION only. Publication is untouched, hiding
 *                   stays instant. Reporting must never be a way to unpublish.
 *   quarantine   -> a hash match, or an operator escalation for a legal process.
 *                   Nothing serves it, to anyone, until an operator decides
 *                   otherwise. Continued publication of that is indefensible.
 *
 * Both still defer destruction; only quarantine also withdraws access.
 *
 * The move is REVERSIBLE, because a hash match can be a false positive. Releasing
 * puts the files back where the database already says they are, so nothing else
 * needs to know this ever happened.
 */

import { mkdir, rename, copyFile, unlink, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

import type { Queryable } from '../db/pool.js';
import { log } from '../log.js';
import { status } from '../web/status.js';
import { filesOwnedBy, withinRoot } from './owned-files.js';

export interface QuarantineResult {
  moved: number;
  /** Files that were already on the other side: a converged retry, not a failure. */
  alreadyThere: number;
}

/**
 * Moves one file between roots, preserving its path relative to the root it is
 * leaving. Falls back to copy+unlink across filesystems (the same `EXDEV` case
 * capture already handles when moving XFTP receipts into the media store).
 */
async function moveAcross(from: string, fromRoot: string, toRoot: string): Promise<boolean> {
  const rel = relative(resolve(fromRoot), resolve(from));
  const dest = resolve(toRoot, rel);
  if (!withinRoot(toRoot, dest)) {
    throw new Error(`quarantine: refusing to move outside the destination root (${rel}).`);
  }
  await mkdir(dirname(dest), { recursive: true });
  try {
    await rename(from, dest);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return false;
    if (code !== 'EXDEV') throw err;
    // Cross-device: copy then unlink. The copy lands first, so a crash between
    // the two leaves the file in BOTH places rather than neither. For quarantine
    // that is the wrong way round, so the unlink is not optional - a failure here
    // must surface rather than leaving a readable copy behind.
    await copyFile(from, dest);
    await unlink(from);
    return true;
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Moves every file a message owns out of the served media tree.
 *
 * Idempotent: a file already in quarantine is counted and skipped, so a retry
 * after a partial move converges instead of failing.
 *
 * Throws on a real move failure. The caller must treat that as a fault and NOT
 * report the item as quarantined, because bytes that did not move are bytes that
 * are still being served.
 */
export async function quarantineMedia(
  db: Queryable,
  mediaRoot: string,
  quarantineRoot: string,
  messageId: number,
): Promise<QuarantineResult> {
  const owned = await filesOwnedBy(db, mediaRoot, messageId);
  let moved = 0;
  let alreadyThere = 0;

  for (const abs of owned.paths) {
    if (await moveAcross(abs, mediaRoot, quarantineRoot)) moved += 1;
    else alreadyThere += 1;
  }

  // Verify rather than assume. The whole guarantee is "nothing under MEDIA_ROOT",
  // so it is worth one more pass to say so truthfully.
  const leftBehind = await filesOwnedBy(db, mediaRoot, messageId);
  if (leftBehind.paths.length > 0) {
    status.error(
      `Quarantine of message ${messageId} left ${leftBehind.paths.length} file(s) inside the media ` +
        `store. Those bytes are still readable through the admin console.`,
    );
    throw new Error(
      `quarantine: ${leftBehind.paths.length} file(s) for message ${messageId} remain under the media root.`,
    );
  }

  log.info(
    `Quarantine: message ${messageId} segregated (${moved} file(s) moved, ${alreadyThere} already there).`,
  );
  return { moved, alreadyThere };
}

/**
 * Puts a quarantined message's files back into the media store.
 *
 * Used when a hash match turns out to be a false positive. The database already
 * records where the files belong, so restoring the bytes to those paths is all
 * that is needed; nothing downstream has to know they were ever elsewhere.
 */
export async function releaseQuarantinedMedia(
  db: Queryable,
  mediaRoot: string,
  quarantineRoot: string,
  messageId: number,
): Promise<QuarantineResult> {
  // Enumerated against the QUARANTINE root, because that is where the files are.
  const owned = await filesOwnedBy(db, quarantineRoot, messageId);
  let moved = 0;
  let alreadyThere = 0;
  for (const abs of owned.paths) {
    if (await moveAcross(abs, quarantineRoot, mediaRoot)) moved += 1;
    else alreadyThere += 1;
  }
  log.info(
    `Quarantine: message ${messageId} released back into the media store ` +
      `(${moved} file(s) moved, ${alreadyThere} already there).`,
  );
  return { moved, alreadyThere };
}

/**
 * Resolves a stored relative media path to the file that actually holds those
 * bytes, or null when they are quarantined (or simply gone).
 *
 * Checks the media store ONLY. A quarantined file is deliberately unreachable
 * through this, so every serving path that goes through it fails closed without
 * needing to know what quarantine is.
 */
export async function servableMediaPath(
  mediaRoot: string,
  relPath: string,
): Promise<string | null> {
  const abs = resolve(mediaRoot, relPath);
  if (!withinRoot(mediaRoot, abs)) return null;
  return (await exists(abs)) ? abs : null;
}

/** True when this message's bytes have been moved out of the served tree. */
export async function isMediaQuarantined(
  db: Queryable,
  quarantineRoot: string,
  messageId: number,
): Promise<boolean> {
  const owned = await filesOwnedBy(db, quarantineRoot, messageId);
  return owned.paths.length > 0;
}

/** Every file a message owns, across BOTH roots. Used by the destruction path. */
export async function allOwnedFiles(
  db: Queryable,
  mediaRoot: string,
  quarantineRoot: string,
  messageId: number,
): Promise<string[]> {
  const inMedia = await filesOwnedBy(db, mediaRoot, messageId);
  const inQuarantine = await filesOwnedBy(db, quarantineRoot, messageId);
  if (inMedia.rejected.length > 0 || inQuarantine.rejected.length > 0) {
    throw new Error(
      `quarantine: message ${messageId} has stored media path(s) outside their root; refusing to ` +
        'act while bytes could be left behind.',
    );
  }
  return [...new Set([...inMedia.paths, ...inQuarantine.paths])].sort();
}

/**
 * Places a hash-match quarantine and segregates the bytes (CCB-S3-013 §4).
 *
 * THE HOOK the screening track attaches to. It is written and tested now, with no
 * producer, so that when screening lands it does not have to invent the hard part:
 * the ordering below is the whole point.
 *
 * The FILES MOVE FIRST, and the hold is only placed if that succeeded. The other
 * order would mark an item quarantined while its bytes were still in the served
 * tree, which is the exact failure this section exists to prevent. A quarantine
 * that fails is therefore visibly absent rather than quietly untrue.
 *
 * A quarantine never expires: `expiresAt` is null, so nothing can time it out and
 * only an explicit operator decision releases it.
 */
export async function quarantineOnHashMatch(
  db: Queryable,
  mediaRoot: string,
  quarantineRoot: string,
  messageId: number,
  placeHold: (
    db: Queryable,
    messageId: number,
    source: 'csam',
    expiresAt: null,
  ) => Promise<unknown>,
): Promise<void> {
  await quarantineMedia(db, mediaRoot, quarantineRoot, messageId);
  await placeHold(db, messageId, 'csam', null);
  log.warn(`Quarantine: message ${messageId} quarantined on a hash match and withheld everywhere.`);
}

/** The path a quarantined file would occupy, for diagnostics only. */
export function quarantinePathFor(quarantineRoot: string, relPath: string): string {
  return join(resolve(quarantineRoot), relPath.split('/').join(sep));
}
