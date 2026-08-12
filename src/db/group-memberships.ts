/**
 * The membership history (CCB-S5-033, D-190, migration 059).
 *
 * One row per change, never updated. `recordMembershipChange` is deliberately not an
 * upsert: a bot that joins, is removed and re-joins is three facts, and a table that kept
 * only the current state would answer "is it in this room" while the question the operator
 * asked was "when did it get in, and how".
 */

import type { Queryable } from './pool.js';

export type MembershipChange = 'joined' | 'left';
/** How it happened. `observed` means noticed between two reads, with no event to explain it. */
export type MembershipHow = 'invitation' | 'link' | 'console' | 'observed';

export interface MembershipEvent {
  botProfileId: number;
  simplexUserId: number;
  groupId: number;
  groupName: string;
  change: MembershipChange;
  how: MembershipHow;
  at: Date;
}

export async function recordMembershipChange(
  db: Queryable,
  ev: Omit<MembershipEvent, 'at'>,
): Promise<void> {
  await db.query(
    `INSERT INTO cinderella_bot_group_memberships
       (bot_profile_id, simplex_user_id, group_id, group_name, change, how)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [ev.botProfileId, ev.simplexUserId, ev.groupId, ev.groupName, ev.change, ev.how],
  );
}

/**
 * Has this membership already been recorded as current?
 *
 * The runtime reconciles at boot, so without this every restart would append a "joined" row
 * for every room and the history would be a log of restarts rather than of memberships.
 */
export async function membershipIsRecorded(
  db: Queryable,
  botProfileId: number,
  groupId: number,
): Promise<boolean> {
  const r = await db.query<{ change: string }>(
    `SELECT change FROM cinderella_bot_group_memberships
      WHERE bot_profile_id = $1 AND group_id = $2
      ORDER BY at DESC, id DESC LIMIT 1`,
    [botProfileId, groupId],
  );
  return r.rows[0]?.change === 'joined';
}

export async function listMembershipChanges(
  db: Queryable,
  limit = 50,
): Promise<MembershipEvent[]> {
  const r = await db.query<{
    bot_profile_id: string | number;
    simplex_user_id: string | number;
    group_id: string | number;
    group_name: string;
    change: MembershipChange;
    how: MembershipHow;
    at: Date;
  }>(
    `SELECT bot_profile_id, simplex_user_id, group_id, group_name, change, how, at
       FROM cinderella_bot_group_memberships
      ORDER BY at DESC, id DESC
      LIMIT $1`,
    [limit],
  );
  return r.rows.map((row) => ({
    botProfileId: Number(row.bot_profile_id),
    simplexUserId: Number(row.simplex_user_id),
    groupId: Number(row.group_id),
    groupName: row.group_name,
    change: row.change,
    how: row.how,
    at: row.at,
  }));
}
