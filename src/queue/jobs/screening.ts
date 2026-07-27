/**
 * Hash screening as a durable job (CCB-S3-012 §3).
 *
 * WHY IT IS A JOB AND NOT AN INLINE CALL. The briefing's constraint is that
 * screening "must be asynchronous and must not block capture. A slow or
 * unavailable provider degrades to 'not screened' and queues for retry; it never
 * drops the message." An inline call in the capture path would couple a member's
 * message landing to a third party's latency, and a throw there would lose the
 * event, because the SDK delivers each event exactly once and never re-sends it
 * (CCB-S3-024).
 *
 * So capture stores the file and enqueues; the worker screens. A provider outage
 * becomes a retry, then a dead letter an operator can see, and never a lost
 * message or a stalled receipt.
 *
 * SCREENING IS INDEPENDENT OF CONSENT. Every image is screened at receipt whether
 * or not the member ever opted in. A file that will never be published is still a
 * file the platform received and holds. The enqueue therefore sits with the media
 * write, not with anything that consults publication state.
 */

import { loadConfig } from '../../config.js';
import { getPool } from '../../db/pool.js';
import { log } from '../../log.js';
import { screenMessage } from '../../screening/service.js';
import { PermanentJobError, type JobHandler } from '../types.js';

/** The stable job type. */
export const SCREENING_SCAN_JOB = 'screening.scan';

export function screeningScanKey(messageId: number): string {
  return `screening.scan:${messageId}`;
}

/**
 * Screens one message's stored original.
 *
 * Idempotent: a message whose media is already quarantined has been screened and
 * acted on, and a message whose row or media is gone has nothing to screen. Both
 * return without work rather than failing, so a retry after a crash converges.
 *
 * The payload carries the message id ONLY. `jobs.payload` and `jobs.last_error`
 * are never pruned, so a filename or a hash placed here would outlive the content
 * it describes.
 */
export const screeningScanHandler: JobHandler = async (payload) => {
  const messageId = Number(payload['messageId']);
  if (!Number.isFinite(messageId)) {
    throw new PermanentJobError(
      `screening.scan: invalid payload (messageId ${String(payload['messageId'])}).`,
    );
  }
  const db = getPool();
  const cfg = loadConfig();

  const { rows } = await db.query<{ media_path: string | null; media_mime: string | null }>(
    'SELECT media_path, media_mime FROM messages WHERE id = $1',
    [messageId],
  );
  const row = rows[0];
  if (!row?.media_path) {
    // Destroyed, or never had media. Nothing to screen, and not a failure.
    return;
  }

  const { rows: held } = await db.query(
    `SELECT 1 FROM evidence_holds
     WHERE message_id = $1 AND source = 'csam' AND state IN ('active', 'escalated')`,
    [messageId],
  );
  if (held.length > 0) {
    // Already matched and quarantined by an earlier run. Re-screening would mean
    // decrypting quarantined material to reach a conclusion already reached.
    return;
  }

  const outcome = await screenMessage(
    db,
    { mediaRoot: cfg.mediaRoot, quarantineRoot: cfg.quarantineRoot },
    { id: messageId, mediaPath: row.media_path, mime: row.media_mime },
  );
  if (outcome.result.verdict === 'not-screened') {
    // The shipped default. Silent on purpose: no provider is configured, which is
    // a choice, and logging it per image would drown the log.
    return;
  }
  log.info(
    `Queue: screened message ${messageId} via '${outcome.result.provider}' (${outcome.result.verdict}).`,
  );
};
