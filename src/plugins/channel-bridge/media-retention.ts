/**
 * The retention bound on re-hosted bridge media (CCB-S5-064, D-262).
 *
 * ── THE RULE, AND WHY IT SIMPLIFIED ──────────────────────────────────────────
 *
 * The operator's rule: an unpublished channel file is deleted after 30 days; a published
 * one is kept. Thirty days because the relays expire their own copies in ~48 hours, so
 * everything past that is a copy kept for convenience rather than delivery.
 *
 * Established before building: NO bridge file is ever published. The archived
 * announcement is hardcoded text-only (`insertBotMessage` writes no media column), no
 * public route serves a bridge file, and serving one would bypass the metadata-stripping
 * pipeline every published image goes through. So the published-file exception is
 * structurally EMPTY today, and this module deliberately has no branch for it - but the
 * reasoning is RECORDED, here and in migration 077, because it is the load-bearing half
 * the day bridge media does publish: a published announcement's file must never disappear
 * because a timer ran out; a picture vanishing from a live public page is worse than a
 * full disk. If a route ever starts serving bridge media, {@link sweepableWhere} MUST
 * gain the publication exception before the first published file ages past the bound.
 *
 * ── THE EXCEPTION THAT IS OPERATIVE: IN-CHAT DELIVERY ────────────────────────
 *
 * A repeat or digest send reads the stored file at SEND time, so the sweep never touches
 * a file whose post can still send. Sweepable means: media stored, AND the post is
 * terminally resolved or source-deleted, AND it was posted before the bound. A standing
 * announcement mid-lifecycle keeps its bytes however old it is; the cadence's own age
 * window resolves every post eventually, so nothing is kept forever by accident.
 *
 * ── ORPHANS ──────────────────────────────────────────────────────────────────
 *
 * Until this briefing, every row-deletion path (Capture's Clear record, a mapping
 * delete, a bot delete) cascaded away `cinderella_bridge_posts` - the only table holding
 * `media_path` - while nothing unlinked the file, so BRIDGE_MEDIA_ROOT accumulated bytes
 * nothing could ever find again. The sweep ends that: a file under the root that no post
 * row references, whose mtime is past the bound, is deleted. Age by mtime because an
 * orphan, by definition, has no row left to date it.
 *
 * ── WHAT A SWEPT ROW BECOMES ─────────────────────────────────────────────────
 *
 * The D-240 tombstone shape: `media_state = 'swept'`, path NULL, mime and size kept as
 * the record of what was held. The 077 CHECK makes a swept row still holding a path
 * unrepresentable. The file is unlinked FIRST and the row updated after, so a crash
 * between the two leaves a row pointing at nothing - which the next sweep repairs by
 * tombstoning the row whose file is already gone - rather than a tombstone hiding bytes.
 */

import { readdir, realpath, stat, unlink } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { Queryable } from '../../db/pool.js';
import { getSetting, setSetting } from '../../db/settings.js';
import { log } from '../../log.js';
import { status } from '../../web/status.js';

export interface BridgeMediaRetention {
  enabled: boolean;
  days: number;
}

/** One WHERE, shared by the count and the sweep, so the number the operator read is the
 * number the sweep acts on. */
const sweepableWhere =
  `media_state = 'stored' AND media_path IS NOT NULL ` +
  `AND (resolved_at IS NOT NULL OR deleted_at IS NOT NULL) AND posted_at < $1`;

export interface SweepableCount {
  /** Post rows whose file is past the bound and can never send again. */
  rows: number;
  /** Their bytes, from the recorded sizes. */
  bytes: number;
}

export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/** The count the page shows FIRST, before any switch is touched. */
export async function countSweepableBridgeMedia(
  db: Queryable,
  cutoff: Date,
): Promise<SweepableCount> {
  const { rows } = await db.query<{ n: string; bytes: string | null }>(
    `SELECT count(*) AS n, COALESCE(sum(media_size), 0)::text AS bytes
       FROM cinderella_bridge_posts WHERE ${sweepableWhere}`,
    [cutoff],
  );
  return { rows: Number(rows[0]?.n ?? 0), bytes: Number(rows[0]?.bytes ?? 0) };
}

/**
 * One canonical spelling for path comparison: realpath when the file exists (so a
 * symlinked, remounted or re-spelled root still names the same bytes), resolve when it
 * does not, and case-folded on win32 because NTFS answers the same file for every
 * casing while string comparison does not. Lexical `resolve` alone was the reviewed
 * defect: any re-spelling of the root that still denoted the SAME directory turned every
 * referenced file into an "orphan" while sends kept working, and an orphan sweep that
 * eats referenced files is the one failure this module must not have.
 */
async function canonical(p: string): Promise<string> {
  let out: string;
  try {
    out = await realpath(p);
  } catch {
    out = resolve(p);
  }
  return process.platform === 'win32' ? out.toLowerCase() : out;
}

/** Every stored file any post row still references, canonicalised for comparison. */
async function referencedPaths(db: Queryable): Promise<Set<string>> {
  const { rows } = await db.query<{ media_path: string }>(
    `SELECT media_path FROM cinderella_bridge_posts WHERE media_path IS NOT NULL`,
  );
  const out = new Set<string>();
  for (const r of rows) out.add(await canonical(r.media_path));
  return out;
}

/**
 * Whether a file under the root is SHAPED like a bridge file: exactly one directory
 * level (the numeric bot id) and a name opening with the numeric post id and a dash -
 * the shape `bridgeMediaStore` writes and nothing else writes. The orphan pass deletes
 * ONLY this shape. Deletion-by-exclusion over an arbitrary tree was the reviewed
 * hazard: a bridge root configured above another data tree would have made that tree's
 * every aged file an "orphan". Anything foreign is left alone and surfaced instead.
 */
export function isBridgeFileShaped(root: string, filePath: string): boolean {
  const rel = relative(root, filePath);
  if (rel.startsWith('..')) return false;
  const parts = rel.split(sep);
  return parts.length === 2 && /^\d+$/.test(parts[0] ?? '') && /^\d+-/.test(parts[1] ?? '');
}

export interface OrphanFile {
  path: string;
  size: number;
  mtimeMs: number;
  /** True when the file is shaped like a bridge file; only these may ever be deleted. */
  bridgeShaped: boolean;
}

export interface OrphanWalk {
  /** Files no post row references, canonical-compared. */
  orphans: OrphanFile[];
  /** How many walked files WERE referenced - the tripwire's evidence that the root
   * spelling and the rows agree. */
  matchedReferenced: number;
}

/**
 * Files under the root that no post row references.
 *
 * The walk is the whole tree; containment is by construction (we only ever see what is
 * under the root). Subdirectories are walked, not deleted: empty directories are cheap
 * and a directory sweep is a different hazard. Comparison is canonical (realpath,
 * case-folded on win32), never lexical.
 */
export async function listOrphanBridgeFiles(
  root: string,
  referenced: ReadonlySet<string>,
): Promise<OrphanWalk> {
  const out: OrphanWalk = { orphans: [], matchedReferenced: 0 };
  const rootCanonical = await canonical(root);
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // A root that does not exist yet holds no orphans.
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (referenced.has(await canonical(abs))) {
        out.matchedReferenced += 1;
        continue;
      }
      try {
        const s = await stat(abs);
        out.orphans.push({
          path: abs,
          size: s.size,
          mtimeMs: s.mtimeMs,
          bridgeShaped: isBridgeFileShaped(rootCanonical, await canonical(abs)),
        });
      } catch {
        // Raced away between readdir and stat: not an orphan any more.
      }
    }
  };
  await walk(root);
  return out;
}

export interface BridgeSweepReport {
  /** Post rows tombstoned, their files unlinked (or already gone). */
  sweptRows: number;
  /** Orphaned files past the bound, unlinked. */
  sweptOrphans: number;
  /** Bytes freed, from recorded sizes and orphan stats. */
  bytesFreed: number;
  /** Rows or files that could not be swept; each already logged and surfaced. */
  failures: number;
}

/**
 * The sweep. Row files first (unlink, then tombstone the row), then aged orphans.
 *
 * Every path is CONTAINED under the root before anything touches it: a stored path that
 * escapes the root is a fault, counted and surfaced, never followed (the owned-files
 * rule). ENOENT on unlink is not a failure - the bytes being already gone is the goal
 * state, and the row is tombstoned so it stops being counted forever.
 */
export async function sweepBridgeMedia(deps: {
  db: Queryable;
  root: string;
  now: Date;
  days: number;
}): Promise<BridgeSweepReport> {
  const cutoff = retentionCutoff(deps.now, deps.days);
  const report: BridgeSweepReport = { sweptRows: 0, sweptOrphans: 0, bytesFreed: 0, failures: 0 };
  const rootResolved = resolve(deps.root);
  const contained = (p: string): boolean => {
    const abs = resolve(p);
    return abs === rootResolved || abs.startsWith(rootResolved + sep);
  };

  const { rows: candidates } = await deps.db.query<{
    id: string | number;
    media_path: string;
    media_size: string | number | null;
  }>(
    `SELECT id, media_path, media_size FROM cinderella_bridge_posts WHERE ${sweepableWhere}`,
    [cutoff],
  );

  for (const row of candidates) {
    if (!contained(row.media_path)) {
      // Never follow a path outside the root, and never go quiet about one (CCB-S3-023).
      report.failures += 1;
      log.error(
        `bridge retention: post ${String(row.id)} stores a media path outside the bridge ` +
          `media root; not swept, not followed.`,
      );
      status.error(
        `Bridge retention: one stored media path lies outside the bridge media root and ` +
          `was not touched. See post ${String(row.id)} on the Bridge pages.`,
      );
      continue;
    }
    try {
      try {
        await unlink(row.media_path);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
      await deps.db.query(
        `UPDATE cinderella_bridge_posts
            SET media_state = 'swept', media_path = NULL, media_error = NULL
          WHERE id = $1`,
        [row.id],
      );
      report.sweptRows += 1;
      report.bytesFreed += Number(row.media_size ?? 0);
    } catch (err) {
      report.failures += 1;
      log.error(
        `bridge retention: sweeping post ${String(row.id)}'s file failed (${
          err instanceof Error ? err.message : String(err)
        }); it stays counted and the next sweep retries.`,
      );
    }
  }

  const referenced = await referencedPaths(deps.db);
  const walk = await listOrphanBridgeFiles(rootResolved, referenced);

  // ── THE TRIPWIRE ──────────────────────────────────────────────────────────
  //
  // If rows reference files but the walk matched NONE of them while still finding
  // candidates, the root's spelling and the rows disagree (a moved mount, an exotic
  // respelling canonicalisation could not bridge) - and under that disagreement every
  // referenced file LOOKS orphaned. Fail toward keeping: skip the orphan half entirely
  // and say so, because deleting a standing announcement's file is the one failure this
  // module must not have.
  const aged = walk.orphans.filter((o) => o.mtimeMs < cutoff.getTime());
  if (referenced.size > 0 && walk.matchedReferenced === 0 && aged.length > 0) {
    report.failures += 1;
    log.error(
      `bridge retention: ${String(referenced.size)} stored path(s) exist in the rows but ` +
        `none was found under the configured root; the orphan pass is skipped, because ` +
        `under that disagreement every referenced file would look orphaned.`,
    );
    status.error(
      'The bridge media sweep skipped its orphan pass: the stored paths and the configured ' +
        'root do not agree, and sweeping under that disagreement could delete files ' +
        'standing announcements still need.',
    );
    return report;
  }

  // Foreign files - anything not shaped like a bridge file - are NEVER deleted, and are
  // surfaced once per sweep rather than silently skipped: a tree that is not the
  // bridge's sitting under the bridge's root is a configuration to fix, not data to eat.
  const foreign = aged.filter((o) => !o.bridgeShaped);
  if (foreign.length > 0) {
    log.warn(
      `bridge retention: ${String(foreign.length)} aged file(s) under the bridge media ` +
        `root are not shaped like bridge files and were left alone.`,
    );
    status.error(
      `The bridge media root holds ${String(foreign.length)} aged file(s) that are not ` +
        `bridge files; the sweep will never touch them. If another tree lives under ` +
        `BRIDGE_MEDIA_ROOT, move one of the two.`,
    );
  }

  for (const orphan of aged) {
    if (!orphan.bridgeShaped) continue;
    try {
      await unlink(orphan.path);
      report.sweptOrphans += 1;
      report.bytesFreed += orphan.size;
    } catch (err) {
      // Already gone is the goal state, not a failure (the row half's own rule).
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      report.failures += 1;
      log.error(
        `bridge retention: deleting an orphaned bridge file failed (${
          err instanceof Error ? err.message : String(err)
        }).`,
      );
    }
  }

  if (report.sweptRows > 0 || report.sweptOrphans > 0 || report.failures > 0) {
    log.info(
      `bridge retention: swept ${String(report.sweptRows)} post file(s) and ` +
        `${String(report.sweptOrphans)} orphan(s), freed ${String(report.bytesFreed)} bytes` +
        `${report.failures > 0 ? `, ${String(report.failures)} failure(s)` : ''}.`,
    );
  }
  if (report.failures > 0) {
    status.error(
      `The bridge media sweep could not delete ${String(report.failures)} item(s); they ` +
        `stay counted and the next sweep retries.`,
    );
  }
  return report;
}

/** The settings-table marker holding the last LOCAL day a sweep completed. */
export const BRIDGE_RETENTION_MARKER_KEY = 'bridge-media-retention-last-sweep-day';

/** The local calendar day, the retention pass's own clock (D-240 sweeps at local midnight). */
export function localDay(now: Date): string {
  const y = String(now.getFullYear()).padStart(4, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * The once-a-day gate the tick calls: sweeps at most once per local day, only while the
 * operator has switched retention on, and only when a root exists to sweep. The marker is
 * written AFTER the sweep, so a sweep that threw is retried on the next tick rather than
 * silently skipped for a day; per-item failures do not throw (they are counted and
 * surfaced), so a day with failures still marks done and retries the next day.
 */
export async function maybeSweepBridgeMedia(deps: {
  db: Queryable;
  root: string | null;
  retention: BridgeMediaRetention;
  now: Date;
}): Promise<BridgeSweepReport | null> {
  if (!deps.retention.enabled || deps.root === null) return null;
  const day = localDay(deps.now);
  const last = await getSetting(deps.db, BRIDGE_RETENTION_MARKER_KEY);
  if (last === day) return null;
  const report = await sweepBridgeMedia({
    db: deps.db,
    root: deps.root,
    now: deps.now,
    days: deps.retention.days,
  });
  await setSetting(deps.db, BRIDGE_RETENTION_MARKER_KEY, day);
  return report;
}

/**
 * The orphan half of the count card: total orphans, and how many are past the bound.
 * Bridge-shaped files only, because the count must be what a sweep would act on - a
 * foreign file under the root is surfaced by the sweep, never counted as deletable.
 */
export async function countOrphanBridgeMedia(
  db: Queryable,
  root: string,
  cutoff: Date,
): Promise<{ files: number; bytes: number; pastBound: number; pastBoundBytes: number }> {
  const walk = await listOrphanBridgeFiles(resolve(root), await referencedPaths(db));
  const shaped = walk.orphans.filter((o) => o.bridgeShaped);
  const past = shaped.filter((o) => o.mtimeMs < cutoff.getTime());
  return {
    files: shaped.length,
    bytes: shaped.reduce((n, o) => n + o.size, 0),
    pastBound: past.length,
    pastBoundBytes: past.reduce((n, o) => n + o.size, 0),
  };
}
