-- Runtime policy decisions for incoming SimpleX group messages.
-- The table stores technical identifiers and the resolved policy result only.
-- Message content, invitation links, and secrets are never stored here.

CREATE TYPE cinderella_runtime_policy_outcome AS ENUM ('allow', 'deny', 'unassigned');

CREATE TYPE cinderella_runtime_policy_reason AS ENUM (
  'allowed',
  'group_unassigned',
  'profile_disabled',
  'group_disabled',
  'member_blocked'
);

CREATE TABLE cinderella_runtime_policy_decisions (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  decided_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  profile_id        BIGINT
    REFERENCES cinderella_profiles (id) ON DELETE SET NULL,
  group_id          BIGINT
    REFERENCES cinderella_groups (id) ON DELETE SET NULL,
  simplex_group_id  BIGINT NOT NULL,
  simplex_member_id TEXT   NOT NULL,
  item_id           BIGINT NOT NULL,
  outcome           cinderella_runtime_policy_outcome NOT NULL,
  reason            cinderella_runtime_policy_reason  NOT NULL,
  role              cinderella_group_role,
  group_kind        cinderella_group_kind,
  local_only        BOOLEAN NOT NULL,
  cloud_allowed     BOOLEAN NOT NULL,
  details           JSONB   NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT cinderella_runtime_policy_group_check CHECK (simplex_group_id > 0),
  CONSTRAINT cinderella_runtime_policy_item_check CHECK (item_id > 0),
  CONSTRAINT cinderella_runtime_policy_member_check
    CHECK (char_length(btrim(simplex_member_id)) BETWEEN 1 AND 240),
  CONSTRAINT cinderella_runtime_policy_privacy_check
    CHECK (NOT (local_only AND cloud_allowed)),
  CONSTRAINT cinderella_runtime_policy_message_unique
    UNIQUE (simplex_group_id, item_id)
);

CREATE INDEX cinderella_runtime_policy_recent_idx
  ON cinderella_runtime_policy_decisions (decided_at DESC, id DESC);

CREATE INDEX cinderella_runtime_policy_identity_idx
  ON cinderella_runtime_policy_decisions
  (simplex_group_id, simplex_member_id, decided_at DESC);
