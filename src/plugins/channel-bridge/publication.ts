/**
 * Whether a channel's announcements are public, and whether it is named
 * (CCB-S5-043, D-215).
 *
 * ── WHY THIS IS NOT A COLUMN ON THE CHANNEL RECORD ───────────────────────────
 *
 * `cinderella_bridge_channels` is operational: one row per (bot, local group id),
 * created when a post arrives or the core is asked, removed when the Capture page
 * clears the group record, and REPLACED with a new group id by a rejoin (D-204,
 * D-205). A publication decision on that row would therefore be unpublished by a
 * rejoin, silently, and the operator would have to take it again every time.
 *
 * So it hangs off `channelKey`, which is derived from the channel's link and is
 * the same before and after a rejoin, the same after a rename, and the same for
 * two bots subscribed to one channel. One decision per channel, which is also
 * what an operator means when he says "this channel is public".
 *
 * ── TWO IDENTITIES, ON PURPOSE ───────────────────────────────────────────────
 *
 * `channelKey` is `link:<sha256 of the join link>`. For a channel the operator
 * bridges, that link is public, so anybody holding it can recompute the key and
 * confirm which channel a post came from. Publishing the key would therefore make
 * "publish without naming the channel" false for exactly the audience most likely
 * to check. `publicId` is random, stable, and the only channel identifier that
 * ever reaches a visitor or an embed URL.
 *
 * ── WHAT THE SWITCHES MEAN, PRECISELY ────────────────────────────────────────
 *
 *   publish    this channel's archived announcements are public. DERIVED on every
 *              read through `message_publish_state`, so switching it off removes
 *              what was already published, on the next request, with no sweep.
 *   anonymise  published, but the channel is not named: the column is withheld
 *              AND the name is replaced inside the announcement text, because the
 *              application's own attribution line carries it (migration 062).
 */

import { randomBytes } from 'node:crypto';
import type { Queryable } from '../../db/pool.js';

export interface ChannelPublication {
  channelKey: string;
  /** The identifier the public surfaces expose. Random, never derived from the link. */
  publicId: string;
  /** The name as last seen, so a switch can say what it acts on after the record is gone. */
  channelName: string;
  publish: boolean;
  anonymise: boolean;
  updatedAt: Date;
  updatedBy: string | null;
}

/** One row for the console: the switches, what they act on, and what they have done. */
export interface ChannelPublicationView extends ChannelPublication {
  /** Archived announcements carrying this channel's origin. */
  archived: number;
  /** How many of those are public right now, read through `published_messages`. */
  published: number;
  /**
   * No live channel record holds this key any more: the group record was cleared, or a
   * rejoin moved the channel to a new local id and a new key. The row is kept (see the
   * header) and said to be orphaned rather than removed, because its posts are still
   * public if the switch is on.
   */
  orphaned: boolean;
}

/**
 * A fresh public id: 12 random bytes, base64url, 16 characters.
 *
 * Not a hash of anything, which is the point (see the header). 96 bits is far past guessing
 * for a value that is not a secret anyway - it appears in embed URLs - and the alphabet is
 * the one migration 062's CHECK allows, so a value this function did not produce is refused
 * by the database rather than accepted into a URL.
 */
export function mintChannelPublicId(): string {
  return randomBytes(12).toString('base64url');
}

interface Row {
  channel_key: string;
  public_id: string;
  channel_name: string;
  publish: boolean;
  anonymise: boolean;
  updated_at: string | Date;
  updated_by: string | null;
}

function map(r: Row): ChannelPublication {
  return {
    channelKey: r.channel_key,
    publicId: r.public_id,
    channelName: r.channel_name,
    publish: r.publish,
    anonymise: r.anonymise,
    updatedAt: new Date(r.updated_at),
    updatedBy: r.updated_by,
  };
}

/**
 * The row for a channel, created OFF if it did not exist.
 *
 * Called from `upsertBridgeChannel`, which is the one choke point for "this bot now knows
 * about a channel", so a row always exists before that channel's first announcement is
 * archived and the console never has to render a switch with nothing behind it.
 *
 * The name updates on every call and the switches are never touched: this function's job is
 * to make the row exist and keep its label current, and a function that could also flip
 * `publish` would be a publication path with no operator at the end of it.
 */
export async function ensureChannelPublication(
  db: Queryable,
  channelKey: string,
  channelName: string,
): Promise<ChannelPublication> {
  const { rows } = await db.query<Row>(
    `INSERT INTO cinderella_bridge_channel_publication (channel_key, public_id, channel_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (channel_key) DO UPDATE SET channel_name = EXCLUDED.channel_name
     RETURNING *`,
    [channelKey, mintChannelPublicId(), channelName],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('ensureChannelPublication: no row returned');
  return map(row);
}

export async function getChannelPublication(
  db: Queryable,
  channelKey: string,
): Promise<ChannelPublication | null> {
  const { rows } = await db.query<Row>(
    `SELECT * FROM cinderella_bridge_channel_publication WHERE channel_key = $1`,
    [channelKey],
  );
  return rows[0] === undefined ? null : map(rows[0]);
}

/** By the identifier a visitor or an embed URL carries. */
export async function getChannelPublicationByPublicId(
  db: Queryable,
  publicId: string,
): Promise<ChannelPublication | null> {
  const { rows } = await db.query<Row>(
    `SELECT * FROM cinderella_bridge_channel_publication WHERE public_id = $1`,
    [publicId],
  );
  return rows[0] === undefined ? null : map(rows[0]);
}

/**
 * Sets one or both switches. Returns the row as it now stands, or null when there is no
 * such channel - a caller that reported success for a key nothing holds would be the
 * "successful action, accurate refusal" pair D-205 warns about.
 */
export async function setChannelPublication(
  db: Queryable,
  channelKey: string,
  change: { publish?: boolean; anonymise?: boolean },
  actor: string,
): Promise<ChannelPublication | null> {
  const { rows } = await db.query<Row>(
    `UPDATE cinderella_bridge_channel_publication
        SET publish   = COALESCE($2, publish),
            anonymise = COALESCE($3, anonymise),
            updated_at = now(),
            updated_by = $4
      WHERE channel_key = $1
      RETURNING *`,
    [channelKey, change.publish ?? null, change.anonymise ?? null, actor],
  );
  return rows[0] === undefined ? null : map(rows[0]);
}

/**
 * Every publication row with what it has actually done.
 *
 * `published` is counted through `published_messages`, never recomputed here: the count an
 * operator reads on the page has to be the count a visitor can reach, and the only way to
 * guarantee that is to ask the same view. A count derived from the switch alone would say
 * "3 published" for three announcements the quarantine had withheld.
 */
export async function listChannelPublications(
  db: Queryable,
): Promise<ChannelPublicationView[]> {
  const { rows } = await db.query<
    Row & { archived: string | number; published: string | number; live: string | number }
  >(
    `SELECT p.*,
            (SELECT count(*) FROM messages m
              WHERE m.bridge_channel_key = p.channel_key) AS archived,
            (SELECT count(*) FROM published_messages pm
              WHERE pm.bridge_channel_public_id = p.public_id) AS published,
            (SELECT count(*) FROM cinderella_bridge_channels c
              WHERE c.channel_key = p.channel_key) AS live
       FROM cinderella_bridge_channel_publication p
      ORDER BY p.channel_name, p.channel_key`,
  );
  return rows.map((r) => ({
    ...map(r),
    archived: Number(r.archived),
    published: Number(r.published),
    orphaned: Number(r.live) === 0,
  }));
}

/**
 * How many archived announcements can never be attributed, and therefore can never be
 * published (CCB-S5-043, ground rule: report what could not be recovered).
 *
 * The migration's backfill could only read `cinderella_bridge_forwards.origin`, and that
 * table is cascaded by `deleteBridgeChannel` and by deleting a mapping. Where the forward
 * row was already gone, the origin is gone with it and cannot be reconstructed: the only
 * remaining starting point would be the local group id, which is exactly the value that
 * does not survive a rejoin.
 *
 * DERIVED rather than a number the migration stored, for two reasons: a stored count goes
 * stale the moment anything else changes, and a `RAISE NOTICE` in the migration would have
 * scrolled past in a deploy log and been gone. This is the report, and the Bridge console
 * prints it every time it is opened.
 *
 * It counts only rows that existed BEFORE migration 062 by construction: every announcement
 * archived from here carries its origin in the same INSERT as the message, so a growing
 * number would mean the insert path had broken - which `verify:bridge` asserts it has not.
 */
export async function countBridgeMessagesWithoutOrigin(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM messages
      WHERE is_bot AND bot_category = 'bridge' AND bridge_channel_key IS NULL`,
  );
  return Number(rows[0]?.n ?? 0);
}
