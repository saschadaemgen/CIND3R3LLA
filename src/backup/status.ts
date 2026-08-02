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

export interface BackupProgress {
  state: string;
  stamp: string;
  startedAt: string;
  updatedAt: string;
  stages: string[];
  done: string[];
  current: string;
  /** The archive being written right now, so the operator sees real work. */
  currentFile: string;
  currentBytes: number;
  /**
   * Expected size of the current archive, or 0 when it is NOT KNOWABLE.
   *
   * 0 is not a missing value to paper over: `pg_dump` has no predictable output size, so
   * the console must render an indeterminate bar with a climbing byte count. Inventing a
   * percentage there would be a number the run cannot support (D-123).
   */
  currentTotal: number;
  /** `archiving` or `encrypting`, so the encryption pass does not look like a freeze. */
  substate: string;
}

/**
 * Is a backup RUNNING right now, and how far along?
 *
 * THIS IS THE SIGNAL THE PAGE POLLS ON, and the reason it exists is a race the request
 * marker could not avoid (CCB-S4-017, D-122). `cinderella-backup-request.service` deletes
 * the marker in `ExecStartPre`, before it starts the backup, so the marker means "a run
 * was started" and is gone within milliseconds while the backup still has half a minute
 * to go. Polling on the marker therefore stopped 8 seconds in, every time, and the
 * finished run never appeared without a manual reload.
 *
 * The progress file lives exactly as long as the run does, which is the property the
 * marker never had. `backup.sh` removes it on every exit path, success or failure, so its
 * absence means "no run in progress" and never "the run is stuck".
 */
export async function readBackupProgress(
  path: string,
  now: number,
  staleMs: number,
): Promise<BackupProgress | null> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return null;
  }
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const arr = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    const updatedAt = typeof j['updatedAt'] === 'string' ? j['updatedAt'] : '';
    // A progress file nothing has touched for a long time means the run died in a way
    // that skipped the trap (a kill -9, a reboot). Treating it as live would poll for
    // ever, so it is treated as gone.
    const at = Date.parse(updatedAt);
    if (Number.isFinite(at) && now - at > staleMs) return null;
    return {
      state: typeof j['state'] === 'string' ? j['state'] : 'running',
      stamp: typeof j['stamp'] === 'string' ? j['stamp'] : '',
      startedAt: typeof j['startedAt'] === 'string' ? j['startedAt'] : '',
      updatedAt,
      stages: arr(j['stages']),
      done: arr(j['done']),
      current: typeof j['current'] === 'string' ? j['current'] : '',
      currentFile: typeof j['currentFile'] === 'string' ? j['currentFile'] : '',
      currentBytes: typeof j['currentBytes'] === 'number' ? j['currentBytes'] : 0,
      currentTotal: typeof j['currentTotal'] === 'number' ? j['currentTotal'] : 0,
      substate: typeof j['substate'] === 'string' ? j['substate'] : '',
    };
  } catch {
    log.warn(`Backup progress: ${path} is not valid JSON.`);
    return null;
  }
}
