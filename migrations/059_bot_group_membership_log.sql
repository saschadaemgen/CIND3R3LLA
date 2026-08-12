-- A bot joining or leaving a room, recorded (CCB-S5-033, D-190).
--
-- ── WHY NOTHING RECORDED THE JOIN ────────────────────────────────────────────
--
-- `receivedGroupInvitation` and `userJoinedGroup` were both routed and both had a handler,
-- so the machinery looked complete. But the join handler only ever ran
--
--     UPDATE cinderella_bot_group_invitations ... WHERE state = 'joined'
--
-- which stamps a row an INVITATION already created. A bot that joins by LINK has no such
-- row: zero rows updated, the function returns false, and the one log line it guards never
-- fires either. So a bot joined a group at 15:00, answered in it at 15:02, and there was no
-- table, no log line and no console surface that knew - the operator watched for it and saw
-- exactly what the code guaranteed he would see.
--
-- ── APPEND-ONLY, AND SEPARATE FROM THE INVITATION TABLE ──────────────────────
--
-- 026 records an INVITATION and its outcome, which is a different thing: it is the console's
-- onboarding step, one row per invitation, mutated as the state advances. This is the
-- HISTORY of membership - one row per change, never updated - so that "when did this bot
-- join that room, and how" is answerable after the fact rather than inferable from a boot
-- line. A membership that ends and resumes is two rows here and would overwrite one row
-- there.

CREATE TABLE cinderella_bot_group_memberships (
  id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bot_profile_id  BIGINT      NOT NULL REFERENCES cinderella_bot_profiles(id) ON DELETE CASCADE,
  -- Recorded as well as the profile id: the profile row can be renamed or re-pointed, and
  -- the SimpleX id is what the core's own group ids are scoped to.
  simplex_user_id BIGINT      NOT NULL,
  group_id        BIGINT      NOT NULL,
  -- The name AT THE TIME. A group can be renamed, and a history that showed today's name
  -- against a year-old join would misdescribe what happened.
  group_name      TEXT        NOT NULL,
  change          TEXT        NOT NULL CHECK (change IN ('joined', 'left')),
  -- How it happened, which is the question the operator actually asked. 'observed' is an
  -- honest value: a membership the runtime noticed between two reads, with no event naming
  -- its cause. Guessing a cause would make the true rows unreadable (the 042 lesson).
  how             TEXT        NOT NULL CHECK (how IN ('invitation', 'link', 'console', 'observed')),
  at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX cinderella_bot_group_memberships_bot_at_idx
  ON cinderella_bot_group_memberships (bot_profile_id, at DESC);

COMMENT ON TABLE cinderella_bot_group_memberships IS
  'Append-only history of a bot joining or leaving a room: which bot, which room, when, how. '
  'Distinct from 026, which tracks one invitation and mutates as it advances.';
