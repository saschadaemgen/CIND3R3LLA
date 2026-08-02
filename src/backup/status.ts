/**
 * What the admin console can honestly know about backups (CCB-S4-014, D-120).
 *
 * THE CONSTRAINT THAT SHAPES THIS FILE: the web process CANNOT SEE THE BACKUPS.
 * `cinderella.service` runs as the unprivileged `cinderella` user with
 * `ProtectSystem=strict`, `NoNewPrivileges=true` and an EMPTY `CapabilityBoundingSet`,
 * while `/var/backups/cinderella` is `0700 root` by design. There is no reading the
 * directory, no `systemctl list-timers`, and no journal. A page that listed archives
 * from those sources would be a display that lies, which the standing rules forbid.
 *
 * So nothing here inspects a backup. It reads ONE artifact that the privileged side
 * leaves behind: a JSON status file written by `backup.sh` on every exit path, success
 * and failure alike, into `/var/lib/cinderella`, the one directory this process can
 * read. Every fact the page renders comes from that file or is marked as unknown.
 *
 * The file is UNTRUSTED INPUT in the ordinary sense: it is parsed defensively and a
 * malformed or absent file degrades to "unknown" rather than throwing, because a
 * console that 500s when a backup has never run is worse than one that says so.
 */

import { readFile, writeFile } from 'node:fs/promises';

import { log } from '../log.js';

export interface BackupArchive {
  kind: string;
  newest: string;
  bytes: number;
  generations: number;
}

export interface BackupStatus {
  stamp: string;
  finishedAt: string;
  result: 'ok' | 'failed';
  exitCode: number;
  /** How far the run got. Meaningful mainly when `result` is `failed`. */
  stage: string;
  backupDir: string;
  retain: number;
  archives: BackupArchive[];
  warnings: string[];
}

/** Why there is nothing to show, kept distinct so the page can say which. */
export type BackupStatusProblem = 'never-run' | 'unreadable' | 'malformed';

export interface BackupStatusResult {
  status: BackupStatus | null;
  problem: BackupStatusProblem | null;
  /** The path consulted, shown to the operator so the finding is actionable. */
  path: string;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function parseArchives(v: unknown): BackupArchive[] {
  if (!Array.isArray(v)) return [];
  return v.filter((a): a is Record<string, unknown> => !!a && typeof a === 'object').map((a) => ({
    kind: str(a['kind'], 'unknown'),
    newest: str(a['newest']),
    bytes: num(a['bytes']),
    generations: num(a['generations']),
  }));
}

/**
 * Reads the status file. Never throws: the three failure modes are distinguished
 * because they mean different things to an operator. `never-run` is a backup that has
 * not happened yet; `unreadable` is a permission or path problem worth fixing;
 * `malformed` means something wrote nonsense and the page should not pretend otherwise.
 */
export async function readBackupStatus(path: string): Promise<BackupStatusResult> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { status: null, problem: 'never-run', path };
    log.warn(`Backup status: cannot read ${path} (${code ?? String(err)}).`);
    return { status: null, problem: 'unreadable', path };
  }

  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const result = j['result'] === 'failed' ? 'failed' : 'ok';
    return {
      status: {
        stamp: str(j['stamp']),
        finishedAt: str(j['finishedAt']),
        result,
        exitCode: num(j['exitCode']),
        stage: str(j['stage'], 'unknown'),
        backupDir: str(j['backupDir']),
        retain: num(j['retain']),
        archives: parseArchives(j['archives']),
        warnings: Array.isArray(j['warnings'])
          ? j['warnings'].filter((w): w is string => typeof w === 'string')
          : [],
      },
      problem: null,
      path,
    };
  } catch {
    log.warn(`Backup status: ${path} is not valid JSON.`);
    return { status: null, problem: 'malformed', path };
  }
}

/**
 * Asks for a backup run, WITHOUT gaining any privilege.
 *
 * The app cannot start a systemd unit and cannot `sudo`: `NoNewPrivileges=true` makes
 * that impossible by construction rather than merely discouraged. So the boundary runs
 * the other way. This writes a marker file inside `/var/lib/cinderella`, which the app
 * already owns, and a root-side `cinderella-backup-request.path` unit watches for it and
 * starts the backup. The app hands over a request; it never gains a capability.
 *
 * The consequence to be honest about on the page: writing the marker proves the REQUEST
 * was made, never that a backup ran. Only the status file can say that.
 */
export async function requestBackupRun(path: string, requestedBy: string): Promise<void> {
  const body = `requested-at=${new Date().toISOString()}\nrequested-by=${requestedBy}\n`;
  await writeFile(path, body, { encoding: 'utf8', mode: 0o644 });
}

/**
 * Is a previously written request still sitting unclaimed?
 *
 * This is what stops the button from lying. If the `.path` unit is not installed, the
 * marker is never consumed, and after a grace period the page can say the request was
 * not picked up instead of implying a run is in progress forever.
 */
export async function pendingRequestAgeMs(path: string, now: number): Promise<number | null> {
  try {
    const raw = await readFile(path, 'utf8');
    const m = /requested-at=(.+)/.exec(raw);
    const at = m?.[1] ? Date.parse(m[1].trim()) : Number.NaN;
    return Number.isFinite(at) ? Math.max(0, now - at) : 0;
  } catch {
    return null;
  }
}
