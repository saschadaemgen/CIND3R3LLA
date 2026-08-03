-- Group invitations for an onboarding bot (CCB-S4-025, D-129).
--
-- Step three of four. Step two connected the direct contact; the operator then invites
-- the bot into a group from their own app and the core raises `receivedGroupInvitation`.
-- Until now nothing listened, so the operator's app said "You sent group invitation" and
-- the bot never joined.
--
-- Rows for the same reason 025 uses rows: a bot can be invited to more than one group,
-- and columns would hold the newest while the operator accepted whichever the page
-- happened to render. Keyed unique on the core's own `groupId`, so a re-invitation or a
-- restart does not become a second row to choose between.
--
-- TWO ROLES, KEPT APART ON PURPOSE. `invited_as_role` is what the invitation offered and
-- `joined_role` is what the bot actually holds once the core answered the join. They are
-- usually the same and they are not the same fact, and neither of them is the operator's
-- EXPECTED role on `cinderella_bot_profiles`. Collapsing any two of the three would let
-- the page claim a role was satisfied because a different role was observed, which is
-- step four's whole job to check.

CREATE TABLE cinderella_bot_group_invitations (
  id                 BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bot_profile_id     BIGINT      NOT NULL
                       REFERENCES cinderella_bot_profiles (id) ON DELETE CASCADE,
  -- The core's own group id. The join is issued with exactly this.
  group_id           BIGINT      NOT NULL,
  -- The SimpleX user the invitation arrived on, so an invitation can never be joined
  -- against a record belonging to another identity in the same core database.
  simplex_user_id    BIGINT      NOT NULL,
  group_name         TEXT        NOT NULL,
  inviter_name       TEXT        NOT NULL,
  -- The role the invitation offers. NOT a promise: the core decides on join.
  invited_as_role    TEXT        NOT NULL,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  state              TEXT        NOT NULL DEFAULT 'pending',
  resolved_at        TIMESTAMPTZ,
  -- The role the core reports for the bot's own membership after joining.
  joined_role        TEXT,
  -- When the core said the membership was actually live, which is a later fact than
  -- the join command returning.
  joined_at          TIMESTAMPTZ,

  CONSTRAINT cinderella_bot_group_invitations_state_check
    CHECK (state IN ('pending', 'joined')),
  CONSTRAINT cinderella_bot_group_invitations_resolution_check
    CHECK (
      (state = 'pending' AND resolved_at IS NULL AND joined_role IS NULL)
      OR (state = 'joined' AND resolved_at IS NOT NULL AND joined_role IS NOT NULL)
    ),
  CONSTRAINT cinderella_bot_group_invitations_unique
    UNIQUE (bot_profile_id, group_id)
);

CREATE INDEX cinderella_bot_group_invitations_pending_idx
  ON cinderella_bot_group_invitations (bot_profile_id, state, received_at DESC);

COMMENT ON COLUMN cinderella_bot_group_invitations.group_id IS
  'The SimpleX core''s groupId. apiJoinGroup is issued with this exact value (CCB-S4-025).';
COMMENT ON COLUMN cinderella_bot_group_invitations.invited_as_role IS
  'The role the invitation offered. Not the role held: see joined_role, and neither is the operator''s expected role.';
COMMENT ON COLUMN cinderella_bot_group_invitations.joined_role IS
  'The role the core reports for the bot''s own membership after the join. Verifying it against the expected role is step four.';
