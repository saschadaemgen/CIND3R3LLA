/**
 * The greeting record, and the claim that makes it happen once (CCB-S5-041, D-206).
 *
 * ── THE ONCE-RULE IS THE INSERT, NOT A CHECK BEFORE ONE ─────────────────────
 *
 * There is no "have we greeted them?" read followed by a write. That shape has a window
 * between the two, and this is precisely the case that fills it: several bots in one room
 * receive the same membership event at the same moment, from the same core, in the same
 * process. A read-then-write would have all of them read "no" and all of them greet.
 *
 * So the claim IS the insert. `ON CONFLICT DO NOTHING` over `UNIQUE (member_id)` means
 * exactly one caller gets a row back and every other gets nothing, decided by Postgres rather
 * than by ordering luck. Whoever wins sends; the rest record nothing and do nothing.
 *
 * ── AND WHY THAT NEEDS NO ELECTION ──────────────────────────────────────────
 *
 * Capture needed one bot per room and had to ELECT it, with a conflict to report when nobody
 * had chosen. The bridge needs a duplicate-pairing refusal it cannot yet write correctly,
 * because the ids it would key on are local to one profile.
 *
 * This needs neither, and the reason is not cleverness: a member's wire id is SCOPED TO THE
 * ROOM (D-190), assigned by SimpleX, identical across every bot that can see that member. So
 * two bots racing to greet one person are racing for ONE key. The strongest guarantee of the
 * three, and it comes from the protocol's own construction rather than from anything imposed
 * here. Do not add an election: it would be strictly weaker than the constraint already is.
 */

import type { Queryable } from '../../db/pool.js';
import type { SuppressionReason } from './greeting.js';

export interface GreetingRecord {
  memberId: string;
  botProfileId: number;
  /** A per-profile handle, recorded for a human reading diagnostics. Nothing keys on it. */
  groupId: number;
  groupName: string;
  memberName: string;
  isReturning: boolean;
  /** `group` / `support` / `direct` when something was sent; `suppressed` when not. */
  route: 'group' | 'support' | 'direct' | 'suppressed';
  /** Required when suppressed, forbidden otherwise. The schema CHECK enforces both. */
  reason: SuppressionReason | null;
}

/**
 * Claim the right to greet this member, and record what happened.
 *
 * Returns TRUE when this caller won the claim and FALSE when somebody already held it - a
 * second bot, a rejoin, a reconnect, or a resync replaying connections. A `false` is not an
 * error and is not logged as one: it is the guarantee working.
 *
 * The row is written in the SAME statement that claims, so a crash between claiming and
 * recording cannot leave a member greeted with no record, or claimed with no greeting.
 */
export async function claimGreeting(db: Queryable, rec: GreetingRecord): Promise<boolean> {
  const { rowCount } = await db.query(
    `INSERT INTO cinderella_welcome_greetings
       (member_id, bot_profile_id, group_id, group_name, member_name, is_returning, route, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (member_id) DO NOTHING`,
    [
      rec.memberId,
      rec.botProfileId,
      rec.groupId,
      rec.groupName,
      rec.memberName,
      rec.isReturning,
      rec.route,
      rec.reason,
    ],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Is this member RETURNING? (CCB-S5-041, D-206)
 *
 * True when the archive already holds messages from this member id and they have never been
 * greeted: somebody who was in the room before the plugin was switched on, left, and came
 * back. `messages.sender_member_id` is indexed, so this is one indexed existence check.
 *
 * ── WHY IT IS THIS AND NOT "A REJOIN" ───────────────────────────────────────
 *
 * The briefing asked for both "a rejoin must never re-greet" and "a member who left and came
 * back gets a different line", which are the same event with opposite outcomes; taken
 * literally the returning text is unreachable and becomes a second dead field, which is the
 * defect this whole briefing exists to end. The operator settled it: the once-rule stays
 * ABSOLUTE and `returning` means prior presence in the archive with no greeting on record.
 *
 * It rests on a fact rather than an inference, and it degrades correctly: on a fresh
 * deployment nobody has history, so everyone is a newcomer.
 *
 * Note this is only ever asked of a member who has just WON the claim, so "never greeted" is
 * implied by reaching here at all; the query does not re-check it.
 */
export async function isReturningMember(db: Queryable, memberId: string): Promise<boolean> {
  const { rows } = await db.query<{ one: number }>(
    `SELECT 1 AS one FROM messages WHERE sender_member_id = $1 LIMIT 1`,
    [memberId],
  );
  return rows.length > 0;
}

/**
 * Correct the row when the send failed after the claim was won.
 *
 * The claim must come FIRST - it is what stops a second bot sending - so the row exists
 * before the outcome is known and states the route that was INTENDED. When that route
 * refuses, this rewrites it to the truth. The row is never deleted: the claim is still held,
 * deliberately, because a member who could not be greeted must not be greeted later by
 * whichever bot happens to see the next event. One attempt per member, whatever it produced.
 */
export async function recordFailedSend(
  db: Queryable,
  memberId: string,
  reason: SuppressionReason,
): Promise<void> {
  await db.query(
    `UPDATE cinderella_welcome_greetings
        SET route = 'suppressed', reason = $2
      WHERE member_id = $1`,
    [memberId, reason],
  );
}

/** Has this member been greeted? For the console, never for the once-rule; see the header. */
export async function wasGreeted(db: Queryable, memberId: string): Promise<boolean> {
  const { rows } = await db.query<{ one: number }>(
    `SELECT 1 AS one FROM cinderella_welcome_greetings WHERE member_id = $1`,
    [memberId],
  );
  return rows.length > 0;
}

export interface GreetingLogRow extends GreetingRecord {
  greetedAt: Date;
}

/** Newest first, for the diagnostics panel: who was greeted, when, where, how, or why not. */
export async function listGreetings(
  db: Queryable,
  botProfileId: number,
  limit = 50,
): Promise<GreetingLogRow[]> {
  const { rows } = await db.query<{
    member_id: string;
    bot_profile_id: string | number;
    group_id: string | number;
    group_name: string;
    member_name: string;
    is_returning: boolean;
    route: string;
    reason: string | null;
    greeted_at: string | Date;
  }>(
    `SELECT member_id, bot_profile_id, group_id, group_name, member_name,
            is_returning, route, reason, greeted_at
       FROM cinderella_welcome_greetings
      WHERE bot_profile_id = $1
      ORDER BY greeted_at DESC
      LIMIT $2`,
    [botProfileId, limit],
  );
  return rows.map((r) => ({
    memberId: r.member_id,
    botProfileId: Number(r.bot_profile_id),
    groupId: Number(r.group_id),
    groupName: r.group_name,
    memberName: r.member_name,
    isReturning: r.is_returning,
    route: r.route as GreetingRecord['route'],
    reason: r.reason as SuppressionReason | null,
    greetedAt: new Date(r.greeted_at),
  }));
}
