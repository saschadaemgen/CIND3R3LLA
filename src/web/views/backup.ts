/**
 * The backup console (CCB-S4-014 Stage 1, D-120). READ PLUS TRIGGER ONLY.
 *
 * THE HARD RULE OF THIS PAGE: it renders nothing it cannot actually observe. The web
 * process runs as the unprivileged `cinderella` user and cannot read
 * `/var/backups/cinderella` (0700 root), cannot read the journal, and cannot run
 * `systemctl list-timers`. Every figure below therefore comes from ONE artifact, the
 * JSON status file `backup.sh` writes on every exit path into the app's own state
 * directory. Where a fact is not in that file it is shown as unknown or as owned by the
 * unit, never invented.
 *
 * There is deliberately NO schedule or retention editor here. Editing those means a web
 * request rewriting a root-owned systemd unit, which is a privilege boundary that has to
 * be designed rather than improvised, and it is Stage 2's job. A control this page cannot
 * honestly back is not shipped as a disabled placeholder either: the page states the fact
 * in a sentence instead, which is the placeholder-free way to represent a missing control.
 */

import type { FastifyInstance } from 'fastify';

import {
  pendingRequestAgeMs,
  readBackupStatus,
  requestBackupRun,
  type BackupStatusResult,
} from '../../backup/status.js';
import { writeAudit } from '../../db/audit.js';
import { log } from '../../log.js';
import { html, page, type SafeHtml } from '../html.js';
import type { ViewContext } from '../server.js';
import { badge, card, pageHeader } from './ui.js';

/** A request older than this that is still on disk was never picked up. */
const REQUEST_STALE_MS = 120_000;

const KIND_LABELS: Record<string, string> = {
  db: 'Archive database',
  media: 'Media store',
  quarantine: 'Quarantine',
  core: 'Messaging core',
  env: 'Environment file',
};

function bytes(n: number): string {
  if (n <= 0) return '-';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || i === 0 ? Math.round(v).toString() : v.toFixed(1)} ${u[i] ?? 'B'}`;
}

function lastRunCard(res: BackupStatusResult): SafeHtml {
  if (!res.status) {
    const explain =
      res.problem === 'never-run'
        ? 'No backup has recorded a result yet. This is what a host shows before the timer has ever fired, and also what it shows if the timer is not enabled.'
        : res.problem === 'unreadable'
          ? 'The status file exists but could not be read. That is a permissions or path problem on the host worth fixing, not an empty state.'
          : 'The status file is not valid JSON. Something wrote it that should not have.';
    return card(
      'Last run',
      html`<div class="flex items-center gap-3">
          ${badge('unknown', 'slate')}
          <span class="text-sm text-slate-300">no result recorded</span>
        </div>
        <p class="mt-3 text-sm text-slate-400">${explain}</p>
        <p class="mt-2 text-xs text-slate-500">Looked in <code>${res.path}</code></p>`,
    );
  }

  const s = res.status;
  const okay = s.result === 'ok';
  return card(
    'Last run',
    html`<div class="flex flex-wrap items-center gap-3">
        ${badge(okay ? 'success' : 'FAILED', okay ? 'green' : 'red')}
        <span class="text-sm text-slate-300">${s.finishedAt || s.stamp}</span>
        ${okay
          ? null
          : html`<span class="text-sm text-red-300"
              >stopped at stage <strong>${s.stage}</strong>, exit ${String(s.exitCode)}</span
            >`}
      </div>
      ${s.warnings.length > 0
        ? html`<ul class="mt-3 space-y-1">
            ${s.warnings.map(
              (w) => html`<li class="text-sm text-amber-300">${w}</li>`,
            )}
          </ul>`
        : null}
      <p class="mt-3 text-xs text-slate-500">
        Written by <code>backup.sh</code> into <code>${res.path}</code> on every run,
        successful or not.
      </p>`,
  );
}

function archivesCard(res: BackupStatusResult): SafeHtml {
  if (!res.status) {
    return card(
      'Archives',
      html`<p class="text-sm text-slate-400">
        Nothing to list until a run records a result. The console cannot read
        <code>/var/backups/cinderella</code> directly: it is <code>0700 root</code> and this
        process is unprivileged, which is deliberate.
      </p>`,
    );
  }
  const s = res.status;
  return card(
    'Archives',
    html`<table class="w-full text-sm">
        <thead>
          <tr class="text-left text-slate-400">
            <th class="pb-2">Kind</th>
            <th class="pb-2">Newest</th>
            <th class="pb-2 text-right">Size</th>
            <th class="pb-2 text-right">Generations</th>
          </tr>
        </thead>
        <tbody>
          ${s.archives.map(
            (a) => html`<tr class="border-t border-slate-800">
              <td class="py-2">${KIND_LABELS[a.kind] ?? a.kind}</td>
              <td class="py-2 font-mono text-xs text-slate-400">
                ${a.newest || html`<span class="text-slate-600">none yet</span>`}
              </td>
              <td class="py-2 text-right">${bytes(a.bytes)}</td>
              <td class="py-2 text-right">
                ${String(a.generations)}${a.generations === 0
                  ? null
                  : html` / ${String(s.retain)}`}
              </td>
            </tr>`,
          )}
        </tbody>
      </table>
      <p class="mt-3 text-xs text-slate-500">
        Counted in <code>${s.backupDir}</code> at the end of that run. A kind with no
        archive is not necessarily a fault: the quarantine and the messaging core are
        absent until there is something to capture.
      </p>`,
  );
}

function scheduleCard(): SafeHtml {
  return card(
    'Schedule and retention',
    html`<p class="text-sm text-slate-300">
        Daily at <strong>03:30</strong>, with a randomised delay of up to 15 minutes, and a
        missed run fires on the next boot. Retention is <strong>14 generations</strong> of
        each kind.
      </p>
      <p class="mt-3 text-sm text-amber-300">
        These are set in the systemd unit, not here. This page cannot read the timer, so
        the values above are what the shipped unit declares rather than what the host is
        confirmed to be running; check with
        <code>systemctl list-timers cinderella-backup.timer</code>.
      </p>
      <p class="mt-2 text-sm text-slate-400">
        Editing them from the console means a web request rewriting a root-owned unit.
        That boundary is designed in a later stage rather than improvised here, which is
        why there is no editor on this page instead of a disabled one.
      </p>`,
  );
}

/**
 * The run-now control, using the console's OWN button system rather than utilities.
 *
 * BOTH classes are required, and getting that wrong is what broke it (CCB-S4-015).
 * `setup-button` carries the shape: inline-flex, 40px min-height, 10px radius, 16px
 * padding, the transitions. `setup-button-quiet` carries only the colours. This is
 * verbatim what "Reset workflow" uses in `ai-onboarding.ts`.
 *
 * As shipped it read `bg-cinder-600`, and there is no `cinder` colour anywhere in this
 * project: Tailwind v4 is CSS-first here with no config file, and `assets/app.css`
 * defines no such token. Tailwind emits nothing for a class it cannot resolve, so the
 * control had no fill, no padding and no height, and rendered as bare text in an empty
 * frame. Quiet is the right weight: running a backup by hand is deliberate, but it is
 * not what this page is for.
 */
function runNowCard(csrf: string, pendingMs: number | null): SafeHtml {
  const stale = pendingMs !== null && pendingMs > REQUEST_STALE_MS;
  return card(
    'Run now',
    html`<form method="post" action="/backup/run" class="flex items-center gap-3">
        <input type="hidden" name="_csrf" value="${csrf}" />
        <button type="submit" class="setup-button setup-button-quiet">
          Request a backup now
        </button>
        ${pendingMs === null
          ? null
          : stale
            ? badge('not picked up', 'red')
            : badge('requested', 'amber')}
      </form>
      ${stale
        ? html`<p class="mt-3 text-sm text-red-300">
            A request has been waiting ${String(Math.round(pendingMs / 1000))}s and nothing
            has taken it. That points at
            <code>cinderella-backup-request.path</code> not being installed or not being
            enabled on the host. See <code>deploy/BACKUP.md</code>.
          </p>`
        : null}
      <p class="mt-3 text-sm text-slate-400">
        This does not run the backup. The console has no privilege to and cannot acquire
        any: it writes a request that the root-side path unit picks up. The result appears
        under Last run when the backup finishes, which is the only place that can honestly
        report it.
      </p>`,
  );
}

/**
 * The self-refreshing region, and the reason it stops on its own.
 *
 * A request takes as long as a backup takes, so the operator should not have to reload
 * to find out how it went. htmx polls this fragment back, and the STOPPING CONDITION is
 * the fragment itself: the polling attributes are only emitted while a request is
 * genuinely outstanding. When the root side consumes the marker the next render omits
 * them and the polling ends, and it ends the same way once a request goes stale. There
 * is no timer that runs forever and nothing that keeps asking after the answer arrived.
 *
 * It reports nothing it has not read. The completed run appears because the status file
 * changed, never because a request was made.
 */
function statusRegion(
  res: BackupStatusResult,
  pending: number | null,
  csrf: string,
): SafeHtml {
  const inner = html`${lastRunCard(res)} ${archivesCard(res)} ${runNowCard(csrf, pending)}`;
  const outstanding = pending !== null && pending <= REQUEST_STALE_MS;
  // Two literal shapes rather than an interpolated attribute, so the polling attributes
  // are either present in the markup or absent from it, with nothing in between.
  return outstanding
    ? html`<div
        id="backup-status"
        class="grid gap-4"
        hx-get="/backup/fragment"
        hx-trigger="every 8s"
        hx-swap="outerHTML"
      >
        ${inner}
      </div>`
    : html`<div id="backup-status" class="grid gap-4">${inner}</div>`;
}

export function registerBackup(app: FastifyInstance, ctx: ViewContext): void {
  async function regionFor(csrf: string): Promise<SafeHtml> {
    const res = await readBackupStatus(ctx.cfg.backupStatusPath);
    const pending = await pendingRequestAgeMs(ctx.cfg.backupRequestPath, Date.now());
    return statusRegion(res, pending, csrf);
  }

  app.get('/backup', async (req, reply) => {
    const csrf = req.session?.csrfToken ?? '';
    return reply.type('text/html').send(
      page({
        title: 'Backups',
        active: 'backups',
        csrfToken: csrf,
        body: html`${pageHeader(
          'Backups',
          'What the last run actually recorded. Read from the run record, not from the backup directory, which this process cannot see.',
        )}
        <div class="grid gap-4">${await regionFor(csrf)} ${scheduleCard()}</div>`,
      }),
    );
  });

  // The polled fragment. Same source, same renderer, so the live view and the full page
  // can never disagree about what the run record says.
  app.get('/backup/fragment', async (req, reply) => {
    const csrf = req.session?.csrfToken ?? '';
    return reply.type('text/html').send((await regionFor(csrf)).value);
  });

  app.post('/backup/run', async (req, reply) => {
    const actor = req.session?.username ?? 'unknown';
    try {
      await requestBackupRun(ctx.cfg.backupRequestPath, actor);
      await writeAudit(ctx.db, actor, 'backup.run.request', 'backup', {
        path: ctx.cfg.backupRequestPath,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Backup: could not write the run request: ${message}`);
      await writeAudit(ctx.db, actor, 'backup.run.request.failed', 'backup', { message });
    }
    return reply.redirect('/backup');
  });
}
