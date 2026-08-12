/**
 * Reading and writing which bot captures which room (CCB-S5-033, D-190).
 *
 * The interesting function is {@link assignCapture}, and what makes it interesting is that
 * it is ONE statement pair inside ONE transaction rather than "clear the old, set the new".
 * The briefing is explicit about why: between those two steps a room captures nothing and
 * nobody is told, and a crash between them leaves it that way permanently.
 */

import type { Queryable } from './pool.js';
import type { CaptureAssignment } from '../capture/rooms.js';

export interface StoredAssignment extends CaptureAssignment {
  assignedAt: Date;
  assignedBy: string;
}

export async function listCaptureAssignments(db: Queryable): Promise<StoredAssignment[]> {
  const r = await db.query<{
    bot_profile_id: string | number;
    group_id: string | number;
    assigned_at: Date;
    assigned_by: string;
  }>(
    `SELECT bot_profile_id, group_id, assigned_at, assigned_by
       FROM cinderella_capture_assignments`,
  );
  return r.rows.map((row) => ({
    botProfileId: Number(row.bot_profile_id),
    groupId: Number(row.group_id),
    assignedAt: row.assigned_at,
    assignedBy: row.assigned_by,
  }));
}

/**
 * Give a room to one bot, in one action.
 *
 * `peerRecords` is every (bot, group) record in that room INCLUDING the winner - the caller
 * knows the room because the room model told it. Everything else in the room is cleared and
 * the winner is written in the same transaction, so there is no instant with two capturers
 * and none with zero.
 *
 * Idempotent: assigning the bot that already holds the room rewrites the same row.
 */
export async function assignCapture(
  db: Queryable,
  winner: CaptureAssignment,
  peerRecords: readonly CaptureAssignment[],
  assignedBy: string,
): Promise<void> {
  const pairs = peerRecords.filter(
    (p) => !(p.botProfileId === winner.botProfileId && p.groupId === winner.groupId),
  );
  if (pairs.length > 0) {
    // One DELETE over the room's other records rather than a loop: a loop is several
    // statements and the gap between them is the state this function exists to avoid.
    await db.query(
      `DELETE FROM cinderella_capture_assignments
        WHERE (bot_profile_id, group_id) IN (
          SELECT * FROM unnest($1::bigint[], $2::bigint[])
        )`,
      [pairs.map((p) => p.botProfileId), pairs.map((p) => p.groupId)],
    );
  }
  await db.query(
    `INSERT INTO cinderella_capture_assignments (bot_profile_id, group_id, assigned_by)
          VALUES ($1, $2, $3)
     ON CONFLICT (bot_profile_id, group_id)
     DO UPDATE SET assigned_at = now(), assigned_by = EXCLUDED.assigned_by`,
    [winner.botProfileId, winner.groupId, assignedBy],
  );
}

/** Hand a room back to the automatic election. */
export async function clearCaptureAssignments(
  db: Queryable,
  records: readonly CaptureAssignment[],
): Promise<void> {
  if (records.length === 0) return;
  await db.query(
    `DELETE FROM cinderella_capture_assignments
      WHERE (bot_profile_id, group_id) IN (
        SELECT * FROM unnest($1::bigint[], $2::bigint[])
      )`,
    [records.map((r) => r.botProfileId), records.map((r) => r.groupId)],
  );
}
