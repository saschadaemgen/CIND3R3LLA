/**
 * Per-member archive counts, for the STATUS answer (CCB-S3-002 §5).
 *
 * A member asking "what do you have on me" gets a count of their OWN messages
 * and how many of those are public. Both figures are scoped to the asking
 * member's stable member id by the query itself, so this cannot be turned into
 * a way to ask about somebody else — and the published figure comes from
 * `published_messages`, the same consent-gated projection the public archive
 * reads, so it can never overstate what is visible.
 */

import type { Queryable } from './pool.js';

export interface MemberArchiveCounts {
  /** Everything of theirs Cinderella holds, published or not. */
  total: number;
  /** The subset currently on the public archive. */
  published: number;
}

export async function memberArchiveCounts(
  db: Queryable,
  memberId: string,
): Promise<MemberArchiveCounts> {
  const { rows } = await db.query<{ total: string; published: string }>(
    // `content_swept_at IS NULL` is the CCB-S3-031 guarantee pointing the other way
    // (CCB-S5-054, D-241). That rule says consent copy must never claim destruction over
    // content that was retained; this is the mirror, and it is the one that could actually
    // be said: the STATUS line is "I keep {total} of your messages ... the rest rest quietly
    // here with me", and counting tombstones made her promise custody of content retention
    // had removed. A member who has never touched consent can ask STATUS - asking is not a
    // consent action - so this is reachable for exactly the people whose rows are swept.
    `SELECT
       (SELECT count(*) FROM messages
         WHERE sender_member_id = $1 AND content_swept_at IS NULL) AS total,
       (SELECT count(*) FROM published_messages WHERE sender_member_id = $1) AS published`,
    [memberId],
  );
  const r = rows[0];
  return { total: Number(r?.total ?? 0), published: Number(r?.published ?? 0) };
}
