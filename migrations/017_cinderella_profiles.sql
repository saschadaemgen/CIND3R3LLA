-- Cinderella profile, group, and authority foundation.
-- This schema stores technical SimpleX identifiers and policy assignments only.
-- It does not connect to a group, consume an invitation link, or execute commands.

CREATE TYPE cinderella_group_kind AS ENUM ('team', 'member', 'test');
CREATE TYPE cinderella_profile_role AS ENUM ('owner', 'administrator', 'auditor');
CREATE TYPE cinderella_group_role AS ENUM (
  'owner',
  'administrator',
  'moderator',
  'team_member',
  'member',
  'auditor',
  'blocked'
);
CREATE TYPE cinderella_identity_type AS ENUM ('user', 'contact');

CREATE TABLE cinderella_profiles (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug                TEXT        NOT NULL UNIQUE,
  display_name        TEXT        NOT NULL,
  enabled             BOOLEAN     NOT NULL DEFAULT TRUE,
  local_only          BOOLEAN     NOT NULL DEFAULT TRUE,
  cloud_allowed       BOOLEAN     NOT NULL DEFAULT FALSE,
  personality_profile TEXT        NOT NULL DEFAULT 'cinderella-default',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cinderella_profiles_slug_check
    CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  CONSTRAINT cinderella_profiles_name_check
    CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 80),
  CONSTRAINT cinderella_profiles_privacy_check
    CHECK (NOT (local_only AND cloud_allowed))
);

CREATE TABLE cinderella_groups (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id         BIGINT                NOT NULL
    REFERENCES cinderella_profiles (id) ON DELETE CASCADE,
  simplex_group_id   BIGINT                NOT NULL UNIQUE,
  local_display_name TEXT                  NOT NULL,
  kind               cinderella_group_kind NOT NULL,
  enabled            BOOLEAN               NOT NULL DEFAULT TRUE,
  inherit_profile    BOOLEAN               NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ           NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ           NOT NULL DEFAULT now(),
  CONSTRAINT cinderella_groups_simplex_id_check CHECK (simplex_group_id > 0),
  CONSTRAINT cinderella_groups_name_check
    CHECK (char_length(btrim(local_display_name)) BETWEEN 1 AND 120)
);

CREATE UNIQUE INDEX cinderella_one_team_group_per_profile_idx
  ON cinderella_groups (profile_id)
  WHERE kind = 'team';

CREATE INDEX cinderella_groups_profile_idx
  ON cinderella_groups (profile_id, kind, local_display_name);

CREATE TABLE cinderella_profile_authorities (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id    BIGINT                    NOT NULL
    REFERENCES cinderella_profiles (id) ON DELETE CASCADE,
  identity_type cinderella_identity_type NOT NULL,
  simplex_id    BIGINT                    NOT NULL,
  display_label TEXT                      NOT NULL,
  role          cinderella_profile_role   NOT NULL,
  enabled       BOOLEAN                   NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ               NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ               NOT NULL DEFAULT now(),
  CONSTRAINT cinderella_profile_authority_id_check CHECK (simplex_id > 0),
  CONSTRAINT cinderella_profile_authority_label_check
    CHECK (char_length(btrim(display_label)) BETWEEN 1 AND 120),
  CONSTRAINT cinderella_profile_authority_unique
    UNIQUE (profile_id, identity_type, simplex_id)
);

CREATE UNIQUE INDEX cinderella_one_owner_per_profile_idx
  ON cinderella_profile_authorities (profile_id)
  WHERE role = 'owner' AND enabled = TRUE;

CREATE INDEX cinderella_profile_authorities_profile_idx
  ON cinderella_profile_authorities (profile_id, role);

CREATE TABLE cinderella_group_authorities (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id          BIGINT                NOT NULL
    REFERENCES cinderella_groups (id) ON DELETE CASCADE,
  simplex_member_id TEXT                  NOT NULL,
  display_label     TEXT                  NOT NULL,
  role              cinderella_group_role NOT NULL,
  enabled           BOOLEAN               NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ           NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ           NOT NULL DEFAULT now(),
  CONSTRAINT cinderella_group_authority_member_check
    CHECK (char_length(btrim(simplex_member_id)) BETWEEN 1 AND 240),
  CONSTRAINT cinderella_group_authority_label_check
    CHECK (char_length(btrim(display_label)) BETWEEN 1 AND 120),
  CONSTRAINT cinderella_group_authority_unique
    UNIQUE (group_id, simplex_member_id)
);

CREATE INDEX cinderella_group_authorities_group_idx
  ON cinderella_group_authorities (group_id, role);
