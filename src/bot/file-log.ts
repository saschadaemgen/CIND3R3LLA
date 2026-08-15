/**
 * The outbound-file delivery record (CCB-S5-044 follow-up, D-224).
 *
 * The fifth live test's lesson, one layer below D-223: `apiSendMessages`
 * returned fine, the message arrived, and the FILE never left the core's
 * `new` state - 205 of them, discovered by querying the core's SQLite by
 * hand. Two halves close that observation gap, and this module is where both
 * report:
 *
 *   * the ROUTED snd-file events (complete / error / warning), which fire
 *     only when the agent gets far enough to say anything, and
 *   * the ACTIVE watcher (`files.watch`), which checks a sent item's
 *     fileStatus a few minutes after the send, because a file stuck in `new`
 *     fires NO event at all - the absence is the signal, and only a check
 *     can see an absence (the D-184 rule: a dead detector and a clean
 *     repository look exactly the same).
 *
 * Content-free by the conversation-log's standard: group id, item id, the
 * file's basename and the outcome. Never the member, never message text.
 */

export type FileDeliveryOutcome =
  | 'complete'
  | 'stuck'
  | 'transferring'
  | 'send-error'
  | 'send-warning'
  | 'cancelled'
  | 'missing';

export interface FileDeliveryEntry {
  at: string;
  botProfileId: number | null;
  groupId: number | null;
  itemId: number | null;
  /** The file's basename or the send's label - never a member's text. */
  label: string;
  outcome: FileDeliveryOutcome;
  detail: string;
}

interface FileDeliveryCounts {
  watched: number;
  complete: number;
  stuck: number;
  sendError: number;
  sendWarning: number;
}

const MAX_ENTRIES = 50;

let entries: FileDeliveryEntry[] = [];
let counts: FileDeliveryCounts = {
  watched: 0,
  complete: 0,
  stuck: 0,
  sendError: 0,
  sendWarning: 0,
};

export function noteFileWatch(): void {
  counts.watched += 1;
}

export function recordFileDelivery(entry: Omit<FileDeliveryEntry, 'at'>, at: Date): void {
  entries.unshift({ ...entry, at: at.toISOString() });
  if (entries.length > MAX_ENTRIES) entries = entries.slice(0, MAX_ENTRIES);
  if (entry.outcome === 'complete') counts.complete += 1;
  if (entry.outcome === 'stuck') counts.stuck += 1;
  if (entry.outcome === 'send-error') counts.sendError += 1;
  if (entry.outcome === 'send-warning') counts.sendWarning += 1;
}

export function fileDeliverySnapshot(): {
  counts: FileDeliveryCounts;
  entries: FileDeliveryEntry[];
} {
  return { counts: { ...counts }, entries: [...entries] };
}

/** Harness reset - the log is process state, and checks must not share it. */
export function resetFileLog(): void {
  entries = [];
  counts = { watched: 0, complete: 0, stuck: 0, sendError: 0, sendWarning: 0 };
}
