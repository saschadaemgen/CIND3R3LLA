-- Which bot captures which room (CCB-S5-033, D-190).
--
-- ── WHY THIS KEYS ON A RECORD AND NOT ON A ROOM ──────────────────────────────
--
-- A "room" is derived: several `groups` records are one room when their member sets
-- intersect (see src/capture/rooms.ts for the measurement). Any key computed from that
-- membership MOVES when the membership moves, and an assignment whose key had drifted
-- would be silently forgotten - the room would fall back to the automatic election with
-- nothing saying the operator's choice had been dropped.
--
-- So the assignment names a REAL RECORD: this bot, this group id, the row the core keeps.
-- If that record disappears the assignment simply stops matching and the room falls back
-- to the election, which is the safe direction and is visible on the Capture page.
--
-- ── ONE ROW PER ROOM IS NOT EXPRESSIBLE HERE, DELIBERATELY ───────────────────
--
-- The database cannot hold "one assignment per room", because a room is not a column: it
-- is a fact about SimpleX membership that lives in the core's SQLite, not here. The
-- invariant is enforced where it is knowable - `assignCapture` deletes every assignment
-- for the other records of the same room inside ONE transaction, so switching is a single
-- action with no instant in which a room has two capturers or none.
--
-- The primary key still rules out the one duplicate this table CAN see: the same bot
-- assigned twice to the same record.

CREATE TABLE cinderella_capture_assignments (
  bot_profile_id  BIGINT      NOT NULL REFERENCES cinderella_bot_profiles(id) ON DELETE CASCADE,
  -- The core's local group id for THAT bot. Not globally unique, which is the whole point:
  -- the pair is what names a membership.
  group_id        BIGINT      NOT NULL,
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The admin username, for the audit trail the console also writes.
  assigned_by     TEXT        NOT NULL,
  PRIMARY KEY (bot_profile_id, group_id)
);

COMMENT ON TABLE cinderella_capture_assignments IS
  'The operator''s explicit choice of which bot captures a room, keyed on a real group record. '
  'Absent means the room is decided by election (lowest SimpleX user id, D-182).';
