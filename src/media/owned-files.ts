/**
 * Every file on disk that one message owns (CCB-S3-013).
 *
 * A deletion that leaves bytes behind is a failed deletion, so this module's job
 * is completeness. Two sources are combined, because NEITHER IS SUFFICIENT ALONE:
 *
 *  1. **The database row.** The original upload is named
 *     `<simplexFileId>-<sanitized member filename>` (`capture/media.ts`), so its
 *     name contains nothing derived from the message id. It is findable ONLY via
 *     `messages.media_path`. No filesystem scan can ever locate it.
 *
 *  2. **A filesystem sweep for id-named artifacts.** Derivatives
 *     (`derived/<bucket>/<messageId><ext>`) and video-link thumbnails
 *     (`<bucket>/thumb-<messageId><ext>`) ARE named after the message, and there
 *     are four ways they end up on disk with no column pointing at them:
 *
 *       - `updateMedia` and `stripAndRecord` overwrite `media_path` /
 *         `media_derived_path` unconditionally, orphaning the previous file.
 *       - the bucket is computed from `sent_at`, which `upsertMessage` refreshes
 *         on conflict, so an edited message can write into a DIFFERENT `YYYY/MM`
 *         than the first pass and strand the earlier pair.
 *       - the derivative extension follows the original's, so a changed source
 *         extension leaves `<id>.jpg` behind next to a live `<id>.png`.
 *       - both derivative writers stage through a `<target>.tmp` sidecar whose
 *         catch blocks only log, so a crash mid-write leaves a partial file that
 *         no column ever referenced. Those contain real member pixels.
 *
 * The id match is exact on the filename stem, so message 9 never matches `91.jpg`.
 *
 * What this CANNOT reach, stated plainly rather than papered over: files that
 * never had a row at all (`persist.ts` logs "Orphaned media (no row)"), the
 * SimpleX core's own SQLite copy under `state/`, the XFTP staging directory, and
 * every backup generation. Only a whole-tree reconciler could address the first;
 * the rest are out of this application's reach entirely, which is why the
 * member-facing copy promises removal from the live archive rather than erasure
 * from the universe.
 */

import { readdir, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

import type { Queryable } from '../db/pool.js';
import { log } from '../log.js';

/** How deep the media tree can nest: `derived/<YYYY>/<MM>/<file>`. */
const MAX_DEPTH = 4;

/**
 * Refuses any path that escapes the media root.
 *
 * `media_path` is built from a member-supplied filename, so it is untrusted input
 * on a code path that unlinks files. Same containment test the public media route
 * uses before serving bytes.
 */
export function withinRoot(mediaRoot: string, absPath: string): boolean {
  const root = resolve(mediaRoot);
  const p = resolve(absPath);
  return p !== root && p.startsWith(root + sep);
}

/** Files whose basename identifies them as belonging to this message. */
function isIdNamed(fileName: string, messageId: number, inDerived: boolean): boolean {
  // Expressed through `idNamedBy` since CCB-S5-054 so the single-message and batch forms
  // cannot drift: one rule about which names belong to which id, asked in two directions.
  //
  // The rule itself is unchanged. `<bucket>/thumb-<id><ext>` is a video-link thumbnail and
  // matches anywhere in the tree; `derived/<bucket>/<id><ext>` is a stripped derivative and
  // matches ONLY under `derived/`, because a bare `<id>.jpg` elsewhere would be an original
  // whose name merely happened to be numeric, and originals are found through the DB
  // column. A trailing `.tmp` is stripped first so a partial write matches its target, and
  // the match is on the whole stem, so message 9 never matches `91.jpg`.
  return idNamedBy(fileName, inDerived) === String(messageId);
}

async function walk(
  dir: string,
  depth: number,
  inDerived: boolean,
  visit: (absPath: string, fileName: string, inDerived: boolean) => void,
): Promise<void> {
  if (depth > MAX_DEPTH) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // A missing tree is nothing to sweep. Anything else is a real read fault and
    // must not be mistaken for "no files here" (CCB-S3-023).
    if (code === 'ENOENT') return;
    throw err;
  }
  for (const e of entries) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(abs, depth + 1, inDerived || e.name === 'derived', visit);
    } else if (e.isFile()) {
      visit(abs, e.name, inDerived);
    }
  }
}

export interface OwnedFiles {
  /** Absolute paths, deduplicated, all verified to sit inside the media root. */
  paths: string[];
  /**
   * Paths named in the DB row that failed the containment check. A non-empty list
   * is a fault: it means a stored `media_path` points outside the media root.
   */
  rejected: string[];
}

/**
 * Enumerates every file this message owns.
 *
 * Call this BEFORE deleting the row: `media_path` and `media_derived_path` live
 * only on the row being destroyed, and once it is gone those bytes are
 * unreachable by any enumeration.
 */
/**
 * The same enumeration for MANY messages, walking the tree ONCE (CCB-S5-054, D-241).
 *
 * `filesOwnedBy` is written for one message and does a full recursive walk of the media
 * tree on every call, which is right for a destruction (one member, a handful of items)
 * and catastrophic for a retention sweep: the first pass on the production archive would
 * be roughly 3,300 whole-tree walks and 3,300 round trips, inside one transaction holding
 * locks on every row it is clearing. Nothing would have failed - it would simply have sat
 * there, which is the worst way for this to go wrong, because a sweep that hangs looks
 * exactly like a sweep that is working.
 *
 * One query for the stored paths, one walk for the id-named artifacts. Same containment
 * test, same `.tmp` sidecars, same "only keep what exists" rule, so what it enumerates for
 * a given id is identical to what the single-message form would.
 */
export async function filesOwnedByMany(
  db: Queryable,
  mediaRoot: string,
  messageIds: readonly number[],
): Promise<OwnedFiles> {
  const root = resolve(mediaRoot);
  const paths = new Set<string>();
  const rejected: string[] = [];
  if (messageIds.length === 0) return { paths: [], rejected: [] };

  const { rows } = await db.query<{
    id: string;
    media_path: string | null;
    media_derived_path: string | null;
  }>(
    'SELECT id, media_path, media_derived_path FROM messages WHERE id = ANY($1::bigint[])',
    [[...messageIds]],
  );
  for (const row of rows) {
    for (const rel of [row.media_path, row.media_derived_path]) {
      if (!rel) continue;
      const abs = resolve(root, rel);
      if (!withinRoot(root, abs)) {
        rejected.push(rel);
        continue;
      }
      paths.add(abs);
      paths.add(`${abs}.tmp`);
    }
  }

  // ONE walk for the whole set. A Set membership test per file replaces one walk per id.
  const wanted = new Set(messageIds.map((n) => String(n)));
  await walk(root, 0, false, (abs, fileName, inDerived) => {
    const id = idNamedBy(fileName, inDerived);
    if (id !== null && wanted.has(id) && withinRoot(root, abs)) paths.add(abs);
  });

  const existing: string[] = [];
  for (const p of paths) {
    try {
      const s = await stat(p);
      if (s.isFile()) existing.push(p);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') continue;
      throw err;
    }
  }
  if (rejected.length > 0) {
    log.error(
      `Media: ${rejected.length} stored media path(s) in a batch lie outside the media root; ` +
        `they were NOT enumerated for deletion.`,
    );
  }
  return { paths: existing.sort(), rejected };
}

/**
 * Which message id a filename is named after, or null.
 *
 * The inverse of {@link isIdNamed}, so the batch form can ask "whose is this?" once per
 * file instead of asking "is this yours?" once per file per id. The two must agree, and
 * `isIdNamed` is now expressed in terms of this one so they cannot drift.
 */
function idNamedBy(fileName: string, inDerived: boolean): string | null {
  const name = fileName.endsWith('.tmp') ? fileName.slice(0, -'.tmp'.length) : fileName;
  const dot = name.indexOf('.');
  const stem = dot === -1 ? name : name.slice(0, dot);
  if (stem.startsWith('thumb-')) {
    const rest = stem.slice('thumb-'.length);
    return /^\d+$/.test(rest) ? rest : null;
  }
  if (inDerived && /^\d+$/.test(stem)) return stem;
  return null;
}

export async function filesOwnedBy(
  db: Queryable,
  mediaRoot: string,
  messageId: number,
): Promise<OwnedFiles> {
  const root = resolve(mediaRoot);
  const paths = new Set<string>();
  const rejected: string[] = [];

  const { rows } = await db.query<{
    media_path: string | null;
    media_derived_path: string | null;
  }>('SELECT media_path, media_derived_path FROM messages WHERE id = $1', [messageId]);

  for (const rel of [rows[0]?.media_path, rows[0]?.media_derived_path]) {
    if (!rel) continue;
    const abs = resolve(root, rel);
    if (!withinRoot(root, abs)) {
      rejected.push(rel);
      continue;
    }
    paths.add(abs);
    // A `.tmp` sidecar next to a recorded target is a partial write of that file.
    paths.add(`${abs}.tmp`);
  }

  await walk(root, 0, false, (abs, fileName, inDerived) => {
    if (isIdNamed(fileName, messageId, inDerived) && withinRoot(root, abs)) paths.add(abs);
  });

  // Only keep paths that actually exist, so the caller's count is the truth about
  // what was erased rather than about what was guessed at.
  const existing: string[] = [];
  for (const p of paths) {
    try {
      const s = await stat(p);
      if (s.isFile()) existing.push(p);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') continue;
      // A path we cannot even stat is a fault, not an absence.
      throw err;
    }
  }

  if (rejected.length > 0) {
    log.error(
      `Media: message ${messageId} has ${rejected.length} stored media path(s) outside the media root; ` +
        `they were NOT enumerated for deletion.`,
    );
  }
  return { paths: existing.sort(), rejected };
}
