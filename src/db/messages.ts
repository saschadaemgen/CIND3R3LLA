/**
 * Write operations for the `messages` and `links` tables. All functions take a
 * `Queryable` so they run against the pool, a transaction client, or a test
 * engine interchangeably.
 */

import type { Queryable } from './pool.js';
import type { CapturedType } from '../capture/message.js';

export interface MessageRow {
  groupId: number;
  groupMsgId: number;
  sharedMsgId: string | null;
  senderMemberId: string;
  senderDisplayName: string;
  /** ISO 8601 timestamp. */
  sentAt: string;
  type: CapturedType;
  textBody: string | null;
  linksText: string | null;
  rawJson: unknown;
}

export interface LinkInput {
  url: string;
  title: string | null;
  description: string | null;
}

export interface MediaInput {
  mediaPath: string;
  mediaMime: string;
  mediaSize: number;
}

/**
 * Inserts (or updates on re-delivery) a captured message. Idempotent on
 * (group_id, group_msg_id). Returns the message row id.
 *
 * Media columns are intentionally left untouched here — the file is downloaded
 * asynchronously and set later via {@link updateMedia}.
 */
export async function upsertMessage(db: Queryable, row: MessageRow): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO messages
       (group_id, group_msg_id, shared_msg_id, sender_member_id, sender_display_name,
        sent_at, type, text_body, links_text, raw_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     ON CONFLICT (group_id, group_msg_id) DO UPDATE SET
       shared_msg_id       = EXCLUDED.shared_msg_id,
       sender_member_id    = EXCLUDED.sender_member_id,
       sender_display_name = EXCLUDED.sender_display_name,
       sent_at             = EXCLUDED.sent_at,
       type                = EXCLUDED.type,
       text_body           = EXCLUDED.text_body,
       links_text          = EXCLUDED.links_text,
       raw_json            = EXCLUDED.raw_json,
       -- A RE-CAPTURE UN-TOMBSTONES THE ROW (CCB-S5-054, D-241). The row is the same chat
       -- item, so (group_id, group_msg_id) conflicts and this UPDATE runs; without
       -- clearing the mark it would write content onto a row still stamped as swept, which
       -- the 070 CHECK refuses - turning an edit or a re-delivery into an exception on the
       -- CAPTURE path, where D-190 says we fail TOWARDS capturing.
       -- Reviving it is also the honest answer rather than a workaround: the content is
       -- genuinely here again, and tonight's pass takes it again on the same terms, because
       -- sent_at is unchanged and the sender still consented to nothing.
       content_swept_at    = NULL
     RETURNING id`,
    [
      row.groupId,
      row.groupMsgId,
      row.sharedMsgId,
      row.senderMemberId,
      row.senderDisplayName,
      row.sentAt,
      row.type,
      row.textBody,
      row.linksText,
      JSON.stringify(row.rawJson),
    ],
  );
  const first = rows[0];
  if (!first) throw new Error('upsertMessage: no id returned');
  return Number(first.id);
}

/**
 * Records what kind of instruction a member's message was (CCB-S3-009).
 * Separate from the insert because classification happens after the dialogue has
 * run, and the row must exist before she can answer it.
 */
export async function setMemberCategory(
  db: Queryable,
  groupId: number,
  groupMsgId: number,
  category: string | null,
): Promise<void> {
  await db.query(
    'UPDATE messages SET member_category = $3 WHERE group_id = $1 AND group_msg_id = $2',
    [groupId, groupMsgId, category],
  );
}

/** Replaces the links for a message (delete-then-insert). */
export async function replaceLinks(
  db: Queryable,
  messageId: number,
  links: readonly LinkInput[],
): Promise<void> {
  await db.query('DELETE FROM links WHERE message_id = $1', [messageId]);
  for (const link of links) {
    await db.query(
      `INSERT INTO links (message_id, url, title, preview_description)
       VALUES ($1, $2, $3, $4)`,
      [messageId, link.url, link.title, link.description],
    );
  }
}

/**
 * Marks messages deleted IN-GROUP (a SimpleX deletion event). Sets the
 * `group_deleted` flag, which the admin console can never clear — so a member's
 * in-group deletion can never be undone into publication (briefing §5/§10).
 * Idempotent. Returns the number of rows flipped.
 */
export async function markDeleted(
  db: Queryable,
  groupId: number,
  groupMsgIds: readonly number[],
): Promise<number> {
  if (groupMsgIds.length === 0) return 0;
  const { rowCount } = await db.query(
    `UPDATE messages
       SET group_deleted = TRUE
     WHERE group_id = $1 AND group_msg_id = ANY($2::bigint[])`,
    [groupId, [...groupMsgIds]],
  );
  return rowCount ?? 0;
}

/**
 * Records the media path/mime/size once a file has been received and stored.
 * Returns the number of rows updated (0 => the message row is missing, i.e. the
 * stored media would be orphaned).
 */
export async function updateMedia(
  db: Queryable,
  groupId: number,
  groupMsgId: number,
  media: MediaInput,
): Promise<number> {
  const { rowCount } = await db.query(
    // THE SAME REVIVAL AS THE CAPTURE WRITE (CCB-S5-054, D-241). The bytes are downloaded
    // and encrypted into MEDIA_ROOT before this runs, so a file that lands after its row was
    // swept would otherwise write a path onto a tombstone and be refused by the 070 CHECK -
    // leaving the bytes on disk with nothing pointing at them, which is the one media state
    // that cannot be repaired by retrying. Clearing the mark makes the row own its file
    // again, and tonight's pass removes both together.
    `UPDATE messages
       SET media_path = $3, media_mime = $4, media_size = $5, media_error = NULL,
           content_swept_at = NULL
     WHERE group_id = $1 AND group_msg_id = $2`,
    [groupId, groupMsgId, media.mediaPath, media.mediaMime, media.mediaSize],
  );
  return rowCount ?? 0;
}

/**
 * On startup, flags media-type messages whose file was never received (no path,
 * no recorded error) as interrupted, so the dashboard surfaces them. Any receipt
 * in-flight when the process last stopped is gone; XFTP relays may still have the
 * file (~48h), but the operator needs to know it wasn't captured. Returns the
 * number of rows flagged.
 */
export async function markInterruptedMediaReceipts(db: Queryable): Promise<number> {
  const { rowCount } = await db.query(
    // A TOMBSTONE IS NOT AN INTERRUPTED RECEIPT (CCB-S5-054, D-241). This reads "no path and
    // no error" as "the file never arrived", which is exactly what a retention sweep leaves
    // behind on purpose. Without this clause every restart stamped a fabricated fault across
    // the whole swept archive, and the fault then rode into the dashboard's failed-receipts
    // count. The sweep changed what these rows ARE; the things that describe them have to be
    // told (D-205).
    `UPDATE messages
       SET media_error = 'receipt interrupted (process restart) — not captured'
     WHERE type IN ('image', 'video', 'voice', 'file')
       AND media_path IS NULL
       AND media_error IS NULL
       AND content_swept_at IS NULL
       AND deleted = FALSE
       AND group_deleted = FALSE`,
  );
  return rowCount ?? 0;
}

/** Records a failed file receipt so the dashboard can surface it (§10.2). */
export async function recordMediaError(
  db: Queryable,
  groupId: number,
  groupMsgId: number,
  error: string,
): Promise<void> {
  await db.query(
    `UPDATE messages SET media_error = $3
     WHERE group_id = $1 AND group_msg_id = $2 AND media_path IS NULL`,
    [groupId, groupMsgId, error.slice(0, 500)],
  );
}

export type ModerationState = 'none' | 'pending' | 'approved' | 'rejected';

/**
 * Manual moderation (admin takedown/restore). 'rejected' removes the message
 * from the published set via the publish views. Returns true only if the value
 * ACTUALLY changed — the `IS DISTINCT FROM` guard means an idempotent re-apply
 * (double-submit, stale page) reports no change, so the caller neither writes a
 * spurious audit row nor shows a success banner. (A plain UPDATE ... WHERE id
 * matches the row and returns rowCount=1 even when the value is unchanged.)
 */
export async function setModerationState(
  db: Queryable,
  messageId: number,
  state: ModerationState,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE messages SET moderation_state = $2::moderation_state
     WHERE id = $1 AND moderation_state IS DISTINCT FROM $2::moderation_state`,
    [messageId, state],
  );
  return (rowCount ?? 0) > 0;
}

/** Admin "mark deleted" by message row id. Returns true only if it changed. */
export async function setDeletedById(
  db: Queryable,
  messageId: number,
  deleted: boolean,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE messages SET deleted = $2 WHERE id = $1 AND deleted IS DISTINCT FROM $2`,
    [messageId, deleted],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * The recent group thread, for her conversational memory (CCB-S4-044, D-147).
 *
 * ── WHAT IS EXCLUDED, AND WHY EACH ONE ───────────────────────────────────────
 *
 * DESTROYED messages need no clause at all, and that is worth stating rather than leaving
 * to be noticed: destruction is a physical `DELETE FROM messages` (`src/archive/destroy.ts`),
 * so a destroyed message cannot be selected because the row is gone. The clause that IS
 * needed is `pending_destructions`: when an evidence hold defers a destruction the row is
 * still here with its text, and the member has already asked to be erased. The hold defers
 * the erasure, never the intent.
 *
 * DELETED, both kinds. `group_deleted` means the member removed it from the room and every
 * other client dropped it; putting it back in her context is a deletion that did not happen.
 * `deleted` is the operator's mark and is honoured for the same reason.
 *
 * REJECTED by moderation. Not published, and not fed to the model either.
 *
 * REVOKED members, which is the one that was a judgement call rather than an obvious
 * exclusion. See the console copy: a revocation is the strongest signal a member can send
 * about their own words, and honouring it in one place and not another is how a "no" stops
 * meaning anything. The cost is real and is stated: she can still see that member's CURRENT
 * message, because that is not history, so she can answer them; she cannot recall their
 * earlier lines.
 *
 * HER OWN replies are INCLUDED (`is_bot`), because following her own thread is half of what
 * this is for.
 *
 * ── WHY THE TEXT COMES FROM TWO COLUMNS ──────────────────────────────────────
 *
 * Her rows carry their text in `search_body` and members' rows in `text_body`, a split
 * migration 013 introduced so a bot row indexes only what it is allowed to. A single
 * `text_body` read would have returned her side of every conversation as blank.
 *
 * Oldest first, because that is a transcript. The LIMIT applies to the newest, which is why
 * the ordering is reversed in the subquery and restored outside it.
 */
export interface GroupHistoryRow {
  memberId: string;
  displayName: string;
  fromBot: boolean;
  sentAt: string;
  text: string;
}

export async function listGroupHistory(
  db: Queryable,
  groupId: number,
  opts: { limit: number; sinceIso: string; beforeMessageId?: number },
): Promise<GroupHistoryRow[]> {
  if (opts.limit <= 0) return [];

  const { rows } = await db.query<{
    sender_member_id: string;
    sender_display_name: string;
    is_bot: boolean;
    sent_at: string;
    body: string | null;
  }>(
    `SELECT * FROM (
       SELECT m.sender_member_id, m.sender_display_name, m.is_bot, m.sent_at,
              CASE WHEN m.is_bot THEN m.search_body ELSE m.text_body END AS body
         FROM messages m
        WHERE m.group_id = $1
          AND m.sent_at >= $2
          AND ($3::BIGINT IS NULL OR m.id < $3::BIGINT)
          AND m.deleted = FALSE
          AND m.group_deleted = FALSE
          AND m.moderation_state <> 'rejected'
          AND NOT EXISTS (
                SELECT 1 FROM pending_destructions pd WHERE pd.message_id = m.id
              )
          AND NOT EXISTS (
                SELECT 1 FROM consent c
                 WHERE c.member_id = m.sender_member_id
                   AND c.revoked_at IS NOT NULL
              )
        ORDER BY m.sent_at DESC, m.id DESC
        LIMIT $4
     ) recent
     ORDER BY recent.sent_at ASC`,
    [groupId, opts.sinceIso, opts.beforeMessageId ?? null, opts.limit],
  );

  return rows
    .filter((row) => (row.body ?? '').trim() !== '')
    .map((row) => ({
      memberId: row.sender_member_id,
      displayName: row.sender_display_name,
      fromBot: row.is_bot,
      sentAt: new Date(row.sent_at).toISOString(),
      text: (row.body ?? '').trim(),
    }));
}
