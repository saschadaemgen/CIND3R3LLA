/**
 * The bridge's tables (CCB-S5-032, D-187): channels a bot knows, the mappings,
 * the posts, the forward log and the suppression record.
 *
 * Plain readers and writers over migration 057. The DECISIONS live elsewhere:
 * cadence.ts plans a tick, loop.ts refuses a mapping, service.ts orchestrates.
 * Nothing here consults the SDK, so every function is answerable in PGlite.
 */

import type { Queryable } from '../../db/pool.js';
import { channelKeyFor, type BridgeOrigin } from './origin.js';
import { ensureChannelPublication } from './publication.js';
import type { PendingPost, PostResolution } from './cadence.js';

export interface BridgeChannel {
  botProfileId: number;
  sourceGroupId: number;
  channelName: string;
  link: string | null;
  /**
   * The stable identity of the channel this record is a record OF (CCB-S5-043).
   *
   * Derived from the link by `channelKeyFor`, which stays the single authority, and stored
   * so the console can get from a channel a bot knows to that channel's publication row.
   * Two bots subscribed to one channel hold two records with the SAME key, which is
   * exactly why publication is keyed on the key rather than on either record.
   */
  channelKey: string;
  firstSeenAt: Date;
  lastPostAt: Date | null;
}

export interface BridgeMapping {
  id: number;
  botProfileId: number;
  sourceGroupId: number;
  destGroupId: number;
  enabled: boolean;
  intervalMinutes: number | null;
  messageCount: number | null;
  maxAgeHours: number;
  maxRepeats: number;
  lastSentAt: Date | null;
  createdAt: Date;
}

// 'swept' is the retention tombstone (CCB-S5-064, migration 077): the file is gone, the
// fact that one was held is not - mime and size stay as the record.
export type BridgeMediaState = 'none' | 'pending' | 'stored' | 'failed' | 'too-large' | 'swept';

/** A post row in full, for the console; the planner's PendingPost is a subset. */
export interface BridgePostRow extends PendingPost {
  botProfileId: number;
  sourceGroupId: number;
  itemId: number;
  deletedAt: Date | null;
  firstSeenAt: Date;
  resolution: PostResolution | 'loop-refused' | null;
  mediaPath: string | null;
  mediaMime: string | null;
  mediaSize: number | null;
  mediaState: BridgeMediaState;
  mediaError: string | null;
}

export type ForwardKind = 'featured' | 'summarized' | 'edit' | 'withdrawal';

export interface BridgeForward {
  id: number;
  mappingId: number;
  postId: number;
  kind: ForwardKind;
  sentAt: Date;
  sentItemId: number | null;
  sentSharedMsgId: string | null;
  origin: BridgeOrigin;
  messageId: number | null;
}

export type SuppressionReason = 'aged-out' | 'dismissed' | 'loop-refused';

/* ── channels ─────────────────────────────────────────────────────────────── */

/**
 * Records that this bot's group `sourceGroupId` behaves as a channel.
 *
 * The name always updates (a rename should show its current name); the link
 * only fills in, never clears, because the core reports it inconsistently and
 * a known link is what keeps the origin's channelKey portable.
 *
 * ── THE KEY IS RE-DERIVED ON EVERY UPSERT, AND THAT IS THE POINT (CCB-S5-043) ─
 *
 * `channel_key` is recomputed from the link the row will HOLD after this
 * statement, not from the link it holds now. The core reports `viaGroupLinkUri`
 * inconsistently, so a channel is often first recorded with no link and gets one
 * later; the key moves from `local:` to `link:` at that moment, and the row has
 * to move with it or the console would go on offering a switch for an identity
 * nothing publishes under any more.
 *
 * Existing archived announcements keep the key they were stamped with, which is
 * correct: they are a record of what was true when they were sent. The console
 * lists a publication row with no live channel as orphaned for exactly this
 * reason, so a key that has been superseded is visible rather than silent.
 */
export async function upsertBridgeChannel(
  db: Queryable,
  ch: { botProfileId: number; sourceGroupId: number; channelName: string; link: string | null },
): Promise<void> {
  const { rows } = await db.query<{ link: string | null }>(
    `SELECT link FROM cinderella_bridge_channels
      WHERE bot_profile_id = $1 AND source_group_id = $2`,
    [ch.botProfileId, ch.sourceGroupId],
  );
  const effectiveLink = rows[0]?.link ?? ch.link;
  const channelKey = channelKeyFor(effectiveLink, ch.botProfileId, ch.sourceGroupId);
  await db.query(
    `INSERT INTO cinderella_bridge_channels
       (bot_profile_id, source_group_id, channel_name, link, channel_key)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (bot_profile_id, source_group_id) DO UPDATE
       SET channel_name = EXCLUDED.channel_name,
           link = COALESCE(cinderella_bridge_channels.link, EXCLUDED.link),
           channel_key = EXCLUDED.channel_key`,
    [ch.botProfileId, ch.sourceGroupId, ch.channelName, ch.link, channelKey],
  );
  // The publication row exists from the moment a channel is known, switched OFF, so the
  // console never renders a switch with nothing behind it and the first announcement is
  // archived against a row that is already there. It never flips a switch.
  await ensureChannelPublication(db, channelKey, ch.channelName);
}

export async function touchChannelPostAt(
  db: Queryable,
  botProfileId: number,
  sourceGroupId: number,
  at: Date,
): Promise<void> {
  await db.query(
    `UPDATE cinderella_bridge_channels SET last_post_at = $3
      WHERE bot_profile_id = $1 AND source_group_id = $2`,
    [botProfileId, sourceGroupId, at],
  );
}

interface ChannelRow {
  bot_profile_id: string | number;
  source_group_id: string | number;
  channel_name: string;
  link: string | null;
  channel_key: string;
  first_seen_at: string | Date;
  last_post_at: string | Date | null;
}

export async function listBridgeChannels(
  db: Queryable,
  botProfileId?: number,
): Promise<BridgeChannel[]> {
  const { rows } = await db.query<ChannelRow>(
    `SELECT * FROM cinderella_bridge_channels
      ${botProfileId === undefined ? '' : 'WHERE bot_profile_id = $1'}
      ORDER BY channel_name`,
    botProfileId === undefined ? [] : [botProfileId],
  );
  return rows.map((r) => ({
    botProfileId: Number(r.bot_profile_id),
    sourceGroupId: Number(r.source_group_id),
    channelName: r.channel_name,
    link: r.link,
    channelKey: r.channel_key,
    firstSeenAt: new Date(r.first_seen_at),
    lastPostAt: r.last_post_at === null ? null : new Date(r.last_post_at),
  }));
}

/**
 * Forget a channel, because the record it was read from is gone (CCB-S5-040, D-204).
 *
 * Called when the Capture page clears an ended group record. Without it the core forgets the
 * group and this table does not, so the bridge went on OFFERING a channel whose group no
 * longer existed - and the operator picked it as a mapping source and waited for posts that
 * could never arrive, because the live subscription was a different `source_group_id`.
 *
 * The CASCADE takes the mappings and the pending posts with it. That is correct rather than
 * merely convenient: a mapping whose source group is gone can never fire again, and the
 * pending posts are announcement state, not the archive. Her announcements are already in
 * `messages` under the 'bridge' category and are untouched by this.
 *
 * Returns what it removed so the caller can say so rather than delete in silence.
 *
 * ── THE PUBLICATION ROW IS DELIBERATELY NOT TOUCHED (CCB-S5-043, D-215) ──────
 *
 * `cinderella_bridge_channel_publication` has no foreign key here and is not
 * cleared, because the operator's decision to publish a channel is a decision
 * about the CHANNEL rather than about this record. Deleting it would silently
 * unpublish a live public block, and a rejoin - which is the main reason this
 * function is ever called - would then need the decision taken again. The console
 * lists such a row as orphaned so it is visible rather than forgotten.
 */
export async function deleteBridgeChannel(
  db: Queryable,
  botProfileId: number,
  sourceGroupId: number,
): Promise<{ channels: number; mappings: number; posts: number }> {
  const counts = await db.query<{ mappings: string; posts: string }>(
    `SELECT
       (SELECT COUNT(*) FROM cinderella_bridge_mappings
         WHERE bot_profile_id = $1 AND source_group_id = $2) AS mappings,
       (SELECT COUNT(*) FROM cinderella_bridge_posts
         WHERE bot_profile_id = $1 AND source_group_id = $2) AS posts`,
    [botProfileId, sourceGroupId],
  );
  const { rowCount } = await db.query(
    `DELETE FROM cinderella_bridge_channels WHERE bot_profile_id = $1 AND source_group_id = $2`,
    [botProfileId, sourceGroupId],
  );
  const row = counts.rows[0];
  return {
    channels: rowCount ?? 0,
    mappings: Number(row?.mappings ?? 0),
    posts: Number(row?.posts ?? 0),
  };
}

/* ── mappings ─────────────────────────────────────────────────────────────── */

interface MappingRow {
  id: string | number;
  bot_profile_id: string | number;
  source_group_id: string | number;
  dest_group_id: string | number;
  enabled: boolean;
  interval_minutes: number | null;
  message_count: number | null;
  max_age_hours: number;
  max_repeats: number;
  last_sent_at: string | Date | null;
  created_at: string | Date;
}

function mapMapping(r: MappingRow): BridgeMapping {
  return {
    id: Number(r.id),
    botProfileId: Number(r.bot_profile_id),
    sourceGroupId: Number(r.source_group_id),
    destGroupId: Number(r.dest_group_id),
    enabled: r.enabled,
    intervalMinutes: r.interval_minutes,
    messageCount: r.message_count,
    maxAgeHours: r.max_age_hours,
    maxRepeats: r.max_repeats,
    lastSentAt: r.last_sent_at === null ? null : new Date(r.last_sent_at),
    createdAt: new Date(r.created_at),
  };
}

export interface NewMapping {
  botProfileId: number;
  sourceGroupId: number;
  destGroupId: number;
  intervalMinutes: number | null;
  messageCount: number | null;
  maxAgeHours: number;
  maxRepeats: number;
}

/**
 * Inserts a mapping. The LOOP REFUSALS run in the service before this, over
 * `refuseMapping`; what the database still holds on its own is the channel FK
 * (a source must be a known channel), the trigger CHECK (at least one cadence
 * trigger), the bounds, and uniqueness.
 */
export async function insertBridgeMapping(db: Queryable, m: NewMapping): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO cinderella_bridge_mappings
       (bot_profile_id, source_group_id, dest_group_id,
        interval_minutes, message_count, max_age_hours, max_repeats)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      m.botProfileId,
      m.sourceGroupId,
      m.destGroupId,
      m.intervalMinutes,
      m.messageCount,
      m.maxAgeHours,
      m.maxRepeats,
    ],
  );
  return Number(rows[0]?.id);
}

export async function listBridgeMappings(
  db: Queryable,
  botProfileId?: number,
): Promise<BridgeMapping[]> {
  const { rows } = await db.query<MappingRow>(
    `SELECT * FROM cinderella_bridge_mappings
      ${botProfileId === undefined ? '' : 'WHERE bot_profile_id = $1'}
      ORDER BY id`,
    botProfileId === undefined ? [] : [botProfileId],
  );
  return rows.map(mapMapping);
}

export async function getBridgeMapping(db: Queryable, id: number): Promise<BridgeMapping | null> {
  const { rows } = await db.query<MappingRow>(
    `SELECT * FROM cinderella_bridge_mappings WHERE id = $1`,
    [id],
  );
  return rows[0] === undefined ? null : mapMapping(rows[0]);
}

/** Switchable without deletion, per the briefing. */
export async function setBridgeMappingEnabled(
  db: Queryable,
  id: number,
  enabled: boolean,
): Promise<boolean> {
  const result = await db.query(
    `UPDATE cinderella_bridge_mappings SET enabled = $2, updated_at = now() WHERE id = $1`,
    [id, enabled],
  );
  return result.rowCount === 1;
}

export async function updateBridgeMappingCadence(
  db: Queryable,
  id: number,
  c: {
    intervalMinutes: number | null;
    messageCount: number | null;
    maxAgeHours: number;
    maxRepeats: number;
  },
): Promise<boolean> {
  const result = await db.query(
    `UPDATE cinderella_bridge_mappings
        SET interval_minutes = $2, message_count = $3, max_age_hours = $4, max_repeats = $5,
            updated_at = now()
      WHERE id = $1`,
    [id, c.intervalMinutes, c.messageCount, c.maxAgeHours, c.maxRepeats],
  );
  return result.rowCount === 1;
}

export async function deleteBridgeMapping(db: Queryable, id: number): Promise<boolean> {
  const result = await db.query(`DELETE FROM cinderella_bridge_mappings WHERE id = $1`, [id]);
  return result.rowCount === 1;
}

export async function setMappingLastSent(db: Queryable, id: number, at: Date): Promise<void> {
  await db.query(
    `UPDATE cinderella_bridge_mappings SET last_sent_at = $2, updated_at = now() WHERE id = $1`,
    [id, at],
  );
}

/* ── posts ────────────────────────────────────────────────────────────────── */

interface PostRow {
  id: string | number;
  bot_profile_id: string | number;
  source_group_id: string | number;
  shared_msg_id: string | null;
  item_id: string | number;
  text_body: string;
  posted_at: string | Date;
  first_seen_at: string | Date;
  edited_at: string | Date | null;
  deleted_at: string | Date | null;
  repeats_done: number;
  dismissed_at: string | Date | null;
  resolution: string | null;
  media_path: string | null;
  media_mime: string | null;
  media_size: string | number | null;
  media_state: string;
  media_error: string | null;
}

function mapPost(r: PostRow): BridgePostRow {
  return {
    id: Number(r.id),
    botProfileId: Number(r.bot_profile_id),
    sourceGroupId: Number(r.source_group_id),
    sharedMsgId: r.shared_msg_id ?? `item:${String(r.item_id)}`,
    itemId: Number(r.item_id),
    text: r.text_body,
    postedAt: new Date(r.posted_at),
    firstSeenAt: new Date(r.first_seen_at),
    editedAt: r.edited_at === null ? null : new Date(r.edited_at),
    deletedAt: r.deleted_at === null ? null : new Date(r.deleted_at),
    repeatsDone: r.repeats_done,
    dismissedAt: r.dismissed_at === null ? null : new Date(r.dismissed_at),
    resolution: (r.resolution ?? null) as BridgePostRow['resolution'],
    mediaPath: r.media_path,
    mediaMime: r.media_mime,
    mediaSize: r.media_size === null ? null : Number(r.media_size),
    mediaState: r.media_state as BridgeMediaState,
    mediaError: r.media_error,
  };
}

export interface NewBridgePost {
  botProfileId: number;
  sourceGroupId: number;
  sharedMsgId: string | null;
  itemId: number;
  text: string;
  postedAt: Date;
}

/**
 * Records an arriving channel post, idempotently on the core's item id: the
 * event stream is at-least-once, so a re-delivered item must land on its own
 * row rather than a duplicate. A re-delivery updates nothing (the EDIT path is
 * {@link applyPostEdit}, which is deliberate: `edited_at` is a statement that
 * the SOURCE changed, not that an event arrived twice).
 */
export async function insertBridgePost(
  db: Queryable,
  p: NewBridgePost,
): Promise<{ id: number; created: boolean }> {
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO cinderella_bridge_posts
       (bot_profile_id, source_group_id, shared_msg_id, item_id, text_body, posted_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT ON CONSTRAINT cinderella_bridge_posts_item_unique DO NOTHING
     RETURNING id`,
    [p.botProfileId, p.sourceGroupId, p.sharedMsgId, p.itemId, p.text, p.postedAt],
  );
  if (inserted.rows[0] !== undefined) return { id: Number(inserted.rows[0].id), created: true };
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM cinderella_bridge_posts
      WHERE bot_profile_id = $1 AND source_group_id = $2 AND item_id = $3`,
    [p.botProfileId, p.sourceGroupId, p.itemId],
  );
  return { id: Number(existing.rows[0]?.id), created: false };
}

/** The source post was edited: the current text replaces the old everywhere. */
export async function applyPostEdit(
  db: Queryable,
  botProfileId: number,
  sourceGroupId: number,
  itemId: number,
  text: string,
  at: Date,
): Promise<number | null> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE cinderella_bridge_posts SET text_body = $4, edited_at = $5
      WHERE bot_profile_id = $1 AND source_group_id = $2 AND item_id = $3
      RETURNING id`,
    [botProfileId, sourceGroupId, itemId, text, at],
  );
  return rows[0] === undefined ? null : Number(rows[0].id);
}

/** The source post was deleted (soft mark is the trigger, per the briefing). */
export async function markPostsDeleted(
  db: Queryable,
  botProfileId: number,
  sourceGroupId: number,
  itemIds: readonly number[],
  at: Date,
): Promise<number[]> {
  if (itemIds.length === 0) return [];
  const { rows } = await db.query<{ id: string }>(
    `UPDATE cinderella_bridge_posts SET deleted_at = $4
      WHERE bot_profile_id = $1 AND source_group_id = $2 AND item_id = ANY($3::bigint[])
        AND deleted_at IS NULL
      RETURNING id`,
    [botProfileId, sourceGroupId, [...itemIds], at],
  );
  return rows.map((r) => Number(r.id));
}

/** Unresolved posts for one source, the planner's input. */
export async function pendingBridgePosts(
  db: Queryable,
  botProfileId: number,
  sourceGroupId: number,
): Promise<BridgePostRow[]> {
  const { rows } = await db.query<PostRow>(
    `SELECT * FROM cinderella_bridge_posts
      WHERE bot_profile_id = $1 AND source_group_id = $2
        AND resolution IS NULL AND deleted_at IS NULL
      ORDER BY posted_at DESC`,
    [botProfileId, sourceGroupId],
  );
  return rows.map(mapPost);
}

export async function getBridgePost(db: Queryable, id: number): Promise<BridgePostRow | null> {
  const { rows } = await db.query<PostRow>(
    `SELECT * FROM cinderella_bridge_posts WHERE id = $1`,
    [id],
  );
  return rows[0] === undefined ? null : mapPost(rows[0]);
}

/**
 * Resolves a post, and when resolving it is a SUPPRESSION - the post stops
 * having never been announced - writes the record in the same breath. The two
 * writes belong together: a suppression without its record is the exact thing
 * `verify:bridge` exists to make impossible.
 */
export async function resolveBridgePost(
  db: Queryable,
  postId: number,
  resolution: PostResolution | 'loop-refused',
  suppressed: boolean,
  mappingId: number | null,
): Promise<void> {
  await db.query(
    `UPDATE cinderella_bridge_posts SET resolution = $2, resolved_at = now()
      WHERE id = $1 AND resolution IS NULL`,
    [postId, resolution],
  );
  if (suppressed) {
    await db.query(
      `INSERT INTO cinderella_bridge_suppressions (mapping_id, post_id, reason)
       VALUES ($1, $2, $3)`,
      [mappingId, postId, resolution],
    );
  }
}

export async function dismissBridgePost(db: Queryable, postId: number): Promise<boolean> {
  const result = await db.query(
    `UPDATE cinderella_bridge_posts SET dismissed_at = now()
      WHERE id = $1 AND dismissed_at IS NULL AND resolution IS NULL`,
    [postId],
  );
  return result.rowCount === 1;
}

/** What one announcement cost each post it showed. */
export async function applyAnnouncementOutcome(
  db: Queryable,
  outcomes: readonly { postId: number; repeatsDone: number; completed: boolean }[],
): Promise<void> {
  for (const o of outcomes) {
    await db.query(
      `UPDATE cinderella_bridge_posts
          SET repeats_done = $2,
              resolution = CASE WHEN $3 THEN 'completed' ELSE resolution END,
              resolved_at = CASE WHEN $3 THEN now() ELSE resolved_at END
        WHERE id = $1`,
      [o.postId, o.repeatsDone, o.completed],
    );
  }
}

export async function setPostMedia(
  db: Queryable,
  postId: number,
  media: {
    state: BridgeMediaState;
    path?: string | null;
    mime?: string | null;
    size?: number | null;
    error?: string | null;
  },
): Promise<void> {
  await db.query(
    `UPDATE cinderella_bridge_posts
        SET media_state = $2, media_path = $3, media_mime = $4, media_size = $5, media_error = $6
      WHERE id = $1`,
    [postId, media.state, media.path ?? null, media.mime ?? null, media.size ?? null, media.error ?? null],
  );
}

/* ── forwards and suppressions ────────────────────────────────────────────── */

export async function recordBridgeForward(
  db: Queryable,
  f: {
    mappingId: number;
    postId: number;
    kind: ForwardKind;
    sentItemId: number | null;
    sentSharedMsgId: string | null;
    origin: BridgeOrigin;
    messageId: number | null;
  },
): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO cinderella_bridge_forwards
       (mapping_id, post_id, kind, sent_item_id, sent_shared_msg_id, origin, message_id)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     RETURNING id`,
    [
      f.mappingId,
      f.postId,
      f.kind,
      f.sentItemId,
      f.sentSharedMsgId,
      JSON.stringify(f.origin),
      f.messageId,
    ],
  );
  return Number(rows[0]?.id);
}

interface ForwardRow {
  id: string | number;
  mapping_id: string | number;
  post_id: string | number;
  kind: string;
  sent_at: string | Date;
  sent_item_id: string | number | null;
  sent_shared_msg_id: string | null;
  origin: unknown;
  message_id: string | number | null;
}

function mapForward(r: ForwardRow): BridgeForward {
  return {
    id: Number(r.id),
    mappingId: Number(r.mapping_id),
    postId: Number(r.post_id),
    kind: r.kind as ForwardKind,
    sentAt: new Date(r.sent_at),
    sentItemId: r.sent_item_id === null ? null : Number(r.sent_item_id),
    sentSharedMsgId: r.sent_shared_msg_id,
    origin: (typeof r.origin === 'string' ? JSON.parse(r.origin) : r.origin) as BridgeOrigin,
    messageId: r.message_id === null ? null : Number(r.message_id),
  };
}

/**
 * THE LOOP READBACK. An arriving channel post whose shared message id matches a
 * message this bot's bridge sent is the bridge's own product coming back, and
 * is never re-bridged (loop.ts states the whole model and the stated limit).
 */
export async function isOwnBridgeSend(
  db: Queryable,
  botProfileId: number,
  sharedMsgId: string,
): Promise<boolean> {
  const { rows } = await db.query<{ one: number }>(
    `SELECT 1 AS one
       FROM cinderella_bridge_forwards f
       JOIN cinderella_bridge_mappings m ON m.id = f.mapping_id
      WHERE m.bot_profile_id = $1 AND f.sent_shared_msg_id = $2
      LIMIT 1`,
    [botProfileId, sharedMsgId],
  );
  return rows.length > 0;
}

/**
 * The announcements a post is currently standing in, for edit and withdrawal
 * propagation: the newest forward per sent message that has not itself been
 * withdrawn. 'edit' rows share the original's sent_item_id, so grouping by the
 * sent message keeps one entry per live copy.
 */
export async function liveForwardsForPost(
  db: Queryable,
  postId: number,
): Promise<BridgeForward[]> {
  const { rows } = await db.query<ForwardRow>(
    `SELECT DISTINCT ON (f.mapping_id, f.sent_item_id) f.*
       FROM cinderella_bridge_forwards f
      WHERE f.post_id = $1 AND f.sent_item_id IS NOT NULL
        AND f.kind IN ('featured', 'summarized')
        AND NOT EXISTS (
          SELECT 1 FROM cinderella_bridge_forwards w
           WHERE w.kind = 'withdrawal' AND w.sent_item_id = f.sent_item_id
             AND w.mapping_id = f.mapping_id
        )
      ORDER BY f.mapping_id, f.sent_item_id, f.sent_at DESC`,
    [postId],
  );
  return rows.map(mapForward);
}

/** Every post standing in one sent message, for recomposition. */
export async function postsInSentMessage(
  db: Queryable,
  mappingId: number,
  sentItemId: number,
): Promise<BridgePostRow[]> {
  const { rows } = await db.query<PostRow>(
    `SELECT DISTINCT p.* FROM cinderella_bridge_posts p
       JOIN cinderella_bridge_forwards f ON f.post_id = p.id
      WHERE f.mapping_id = $1 AND f.sent_item_id = $2
        AND f.kind IN ('featured', 'summarized')
      ORDER BY p.posted_at DESC`,
    [mappingId, sentItemId],
  );
  return rows.map(mapPost);
}

export interface ForwardLogFilter {
  channelKey?: string;
  destGroupId?: number;
  since?: Date;
  until?: Date;
  limit?: number;
}

/**
 * The forward log, filterable by channel, destination and time - the console
 * question that is also the activity stream's question, which is why the
 * channel filter reads the STRUCTURED origin field: filtering by it here is
 * the proof the field is fit before the site depends on it.
 */
export async function bridgeForwardLog(
  db: Queryable,
  filter: ForwardLogFilter = {},
): Promise<(BridgeForward & { destGroupId: number; postText: string })[]> {
  const conds: string[] = [];
  const params: unknown[] = [];
  const add = (cond: string, value: unknown): void => {
    params.push(value);
    conds.push(cond.replace('?', `$${String(params.length)}`));
  };
  if (filter.channelKey !== undefined) add(`f.origin ->> 'channelKey' = ?`, filter.channelKey);
  if (filter.destGroupId !== undefined) add(`m.dest_group_id = ?`, filter.destGroupId);
  if (filter.since !== undefined) add(`f.sent_at >= ?`, filter.since);
  if (filter.until !== undefined) add(`f.sent_at <= ?`, filter.until);
  params.push(Math.min(filter.limit ?? 100, 500));
  const { rows } = await db.query<ForwardRow & { dest_group_id: string | number; post_text: string }>(
    `SELECT f.*, m.dest_group_id, p.text_body AS post_text
       FROM cinderella_bridge_forwards f
       JOIN cinderella_bridge_mappings m ON m.id = f.mapping_id
       JOIN cinderella_bridge_posts p ON p.id = f.post_id
      ${conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : ''}
      ORDER BY f.sent_at DESC
      LIMIT $${String(params.length)}`,
    params,
  );
  return rows.map((r) => ({
    ...mapForward(r),
    destGroupId: Number(r.dest_group_id),
    postText: r.post_text,
  }));
}

export async function listBridgeSuppressions(
  db: Queryable,
  limit = 50,
): Promise<{ id: number; mappingId: number | null; postId: number; reason: SuppressionReason; at: Date; postText: string }[]> {
  const { rows } = await db.query<{
    id: string | number;
    mapping_id: string | number | null;
    post_id: string | number;
    reason: string;
    at: string | Date;
    post_text: string;
  }>(
    `SELECT s.id, s.mapping_id, s.post_id, s.reason, s.at, p.text_body AS post_text
       FROM cinderella_bridge_suppressions s
       JOIN cinderella_bridge_posts p ON p.id = s.post_id
      ORDER BY s.at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    mappingId: r.mapping_id === null ? null : Number(r.mapping_id),
    postId: Number(r.post_id),
    reason: r.reason as SuppressionReason,
    at: new Date(r.at),
    postText: r.post_text,
  }));
}

/* ── cadence inputs ───────────────────────────────────────────────────────── */

/**
 * How many MEMBER messages the destination has seen since the mapping last
 * spoke. Derived from the capture table rather than kept as a counter, so it
 * cannot drift, and excluding her own rows on purpose: the bridge's own
 * announcement counting toward the next announcement would be a feedback loop
 * ticking on its own output.
 */
export async function memberMessagesSince(
  db: Queryable,
  destGroupId: number,
  since: Date | null,
): Promise<number> {
  const { rows } = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM messages
      WHERE group_id = $1 AND is_bot = FALSE
        ${since === null ? '' : 'AND captured_at > $2'}`,
    since === null ? [destGroupId] : [destGroupId, since],
  );
  return Number(rows[0]?.n ?? 0);
}
