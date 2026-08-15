/**
 * The outbound-file watcher (CCB-S5-044 follow-up, D-224).
 *
 * A file-bearing send whose command succeeded can still deliver a message
 * with nothing in it: the core stores the file and the upload never starts,
 * and NO event fires, because events report progress and a file stuck in
 * `new` makes none. 205 outbound files sat in that state before anyone
 * looked, found only by querying the core's SQLite by hand.
 *
 * So every file-bearing send books one of these: a few minutes later the
 * item's OWN fileStatus is read back out of the core, and a file that never
 * started uploading becomes a dashboard alarm and a journal row instead of a
 * hand query. Still transferring books ONE follow-up check; complete is
 * counted quietly.
 *
 * The check function is injected (`setFileWatchDeps`), because it must go
 * through the runtime's scheduler like every SimpleX command (D-171), and
 * this module must stay importable by the send paths without a cycle.
 */

import type { Queryable } from '../../db/pool.js';
import { enqueueJob } from '../store.js';
import type { JobHandler } from '../types.js';
import { log } from '../../log.js';
import { recordFileDelivery } from '../../bot/file-log.js';
import { status } from '../../web/status.js';

export const FILE_WATCH_JOB = 'files.watch';

/** First look: long enough for a healthy upload, short enough to matter. */
export const FILE_WATCH_DELAY_MS = 5 * 60_000;
/** The one follow-up for a file still mid-transfer at the first look. */
export const FILE_WATCH_RECHECK_MS = 15 * 60_000;

export type FileWatchStatus =
  | 'stored'
  | 'transfer'
  | 'complete'
  | 'cancelled'
  | 'error'
  | 'missing';

export interface FileWatchDeps {
  /** Reads the sent item's fileStatus back out of the core, as the owning bot. */
  check(botProfileId: number, groupId: number, itemId: number): Promise<FileWatchStatus>;
  now(): Date;
  /** The queue's own database - injected so a harness never reaches the real pool. */
  db: Queryable;
}

let deps: (() => FileWatchDeps | null) | null = null;

export function setFileWatchDeps(d: (() => FileWatchDeps | null) | null): void {
  deps = d;
}

export interface FileWatchPayload {
  botProfileId: number;
  groupId: number;
  itemId: number;
  /** The file's basename or the send's label - never member text. */
  label: string;
  /** 1 on the first look, 2 on the one follow-up. */
  attempt: number;
}

export async function enqueueFileWatch(
  db: Queryable,
  payload: Omit<FileWatchPayload, 'attempt'> & { attempt?: number },
  runAt: Date,
): Promise<void> {
  const attempt = payload.attempt ?? 1;
  await enqueueJob(db, FILE_WATCH_JOB, {
    idempotencyKey: `${FILE_WATCH_JOB}:${String(payload.botProfileId)}:${String(payload.groupId)}:${String(payload.itemId)}:${String(attempt)}`,
    lane: 'bulk',
    runAt,
    payload: { ...payload, attempt },
  });
}

export const fileWatchHandler: JobHandler = async (payload) => {
  const p = payload as Partial<FileWatchPayload>;
  const botProfileId = Number(p['botProfileId']);
  const groupId = Number(p['groupId']);
  const itemId = Number(p['itemId']);
  const label = typeof p['label'] === 'string' ? p['label'] : '(file)';
  const attempt = Number(p['attempt'] ?? 1);
  const resolved = deps?.() ?? null;
  if (resolved === null) {
    log.debug('files.watch: ran before the deps were registered; skipping.');
    return;
  }
  const at = resolved.now();

  let outcome: FileWatchStatus;
  try {
    outcome = await resolved.check(botProfileId, groupId, itemId);
  } catch (error) {
    // The CHECK failing is its own fault and must not read as a delivery
    // verdict either way (the two-predicates rule, D-201).
    log.error(`files.watch: could not read the status of item ${String(itemId)} in group ${String(groupId)}: ${String(error)}`);
    return;
  }

  switch (outcome) {
    case 'stored':
      // Never offered, never uploaded - the 205's state, now loud.
      recordFileDelivery({ botProfileId, groupId, itemId, label, outcome: 'stuck', detail: `still stored ${String(Math.round((attempt === 1 ? 5 : 20)))} minutes after the send` }, at);
      status.error(
        `A file she sent to group ${String(groupId)} never started uploading ("${label}", item ${String(itemId)}): the message arrived with nothing in it.`,
      );
      break;
    case 'transfer':
      if (attempt === 1) {
        recordFileDelivery({ botProfileId, groupId, itemId, label, outcome: 'transferring', detail: 'still mid-transfer at the first look; one follow-up booked' }, at);
        await enqueueFileWatch(
          resolved.db,
          { botProfileId, groupId, itemId, label, attempt: 2 },
          new Date(at.getTime() + FILE_WATCH_RECHECK_MS),
        );
      } else {
        recordFileDelivery({ botProfileId, groupId, itemId, label, outcome: 'stuck', detail: 'still mid-transfer twenty minutes after the send' }, at);
        status.error(
          `A file she sent to group ${String(groupId)} is still mid-transfer twenty minutes on ("${label}", item ${String(itemId)}).`,
        );
      }
      break;
    case 'complete':
      recordFileDelivery({ botProfileId, groupId, itemId, label, outcome: 'complete', detail: '' }, at);
      break;
    case 'cancelled':
      recordFileDelivery({ botProfileId, groupId, itemId, label, outcome: 'cancelled', detail: 'the transfer was cancelled' }, at);
      break;
    case 'error':
      recordFileDelivery({ botProfileId, groupId, itemId, label, outcome: 'send-error', detail: 'the core reports a send error' }, at);
      status.error(`A file she sent to group ${String(groupId)} failed in transfer ("${label}", item ${String(itemId)}).`);
      break;
    case 'missing':
      // The item is gone (deleted, or the window scrolled past) - recorded,
      // not alarmed: a deleted message's file is nobody's loss.
      recordFileDelivery({ botProfileId, groupId, itemId, label, outcome: 'missing', detail: 'the item is no longer readable' }, at);
      break;
  }
};
