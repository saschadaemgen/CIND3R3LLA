-- Persistent SimpleX bot onboarding configuration and workflow state.
-- This migration stores desired settings only. It does not create addresses,
-- accept contacts, join groups, change roles, or activate policies.

CREATE TABLE cinderella_bot_profiles (
  id                                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug                              TEXT        NOT NULL UNIQUE,
  display_name                      TEXT        NOT NULL,
  enabled                           BOOLEAN     NOT NULL DEFAULT TRUE,
  selected_for_runtime              BOOLEAN     NOT NULL DEFAULT FALSE,
  workflow_state                    TEXT        NOT NULL DEFAULT 'configured',
  sdk_version                       TEXT        NOT NULL DEFAULT '6.5.4',
  sdk_types_version                 TEXT        NOT NULL DEFAULT '0.8.0',

  create_address                    BOOLEAN     NOT NULL DEFAULT TRUE,
  update_address                    BOOLEAN     NOT NULL DEFAULT TRUE,
  update_profile                    BOOLEAN     NOT NULL DEFAULT TRUE,
  auto_accept_contacts              BOOLEAN     NOT NULL DEFAULT TRUE,
  welcome_message                   TEXT,
  business_address                  BOOLEAN     NOT NULL DEFAULT FALSE,
  allow_files                       BOOLEAN     NOT NULL DEFAULT TRUE,
  command_registry_mode             TEXT        NOT NULL DEFAULT 'cinderella_defaults',
  custom_commands                   JSONB       NOT NULL DEFAULT '[]'::jsonb,
  use_bot_profile                   BOOLEAN     NOT NULL DEFAULT TRUE,
  log_contacts                      BOOLEAN     NOT NULL DEFAULT TRUE,
  log_network                       BOOLEAN     NOT NULL DEFAULT FALSE,

  group_invitation_mode             TEXT        NOT NULL DEFAULT 'manual',
  expected_group_role               TEXT        NOT NULL DEFAULT 'admin',
  role_verification_required        BOOLEAN     NOT NULL DEFAULT TRUE,
  policy_activation_mode            TEXT        NOT NULL DEFAULT 'manual',

  remote_commands_enabled           BOOLEAN     NOT NULL DEFAULT FALSE,
  persistent_changes_enabled        BOOLEAN     NOT NULL DEFAULT FALSE,

  contact_request_retention_hours   INTEGER     NOT NULL DEFAULT 168,
  group_invitation_retention_hours  INTEGER     NOT NULL DEFAULT 168,
  max_pending_contact_requests      INTEGER     NOT NULL DEFAULT 100,

  created_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT cinderella_bot_profiles_slug_check
    CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  CONSTRAINT cinderella_bot_profiles_name_check
    CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 80),
  CONSTRAINT cinderella_bot_profiles_workflow_state_check
    CHECK (
      workflow_state IN (
        'configured',
        'waiting_contact_request',
        'contact_request_pending',
        'contact_connected',
        'waiting_group_invitation',
        'group_invitation_pending',
        'joined',
        'waiting_expected_role',
        'role_verified',
        'ready',
        'error'
      )
    ),
  CONSTRAINT cinderella_bot_profiles_command_mode_check
    CHECK (command_registry_mode IN ('disabled', 'cinderella_defaults', 'custom')),
  CONSTRAINT cinderella_bot_profiles_custom_commands_check
    CHECK (jsonb_typeof(custom_commands) = 'array'),
  CONSTRAINT cinderella_bot_profiles_group_invitation_mode_check
    CHECK (
      group_invitation_mode IN (
        'manual',
        'automatic',
        'approved_contacts',
        'approved_groups'
      )
    ),
  CONSTRAINT cinderella_bot_profiles_expected_role_check
    CHECK (
      expected_group_role IN (
        'relay',
        'observer',
        'author',
        'member',
        'moderator',
        'admin',
        'owner'
      )
    ),
  CONSTRAINT cinderella_bot_profiles_policy_activation_mode_check
    CHECK (
      policy_activation_mode IN ('manual', 'automatic_after_verification')
    ),
  CONSTRAINT cinderella_bot_profiles_contact_retention_check
    CHECK (contact_request_retention_hours BETWEEN 1 AND 8760),
  CONSTRAINT cinderella_bot_profiles_group_retention_check
    CHECK (group_invitation_retention_hours BETWEEN 1 AND 8760),
  CONSTRAINT cinderella_bot_profiles_pending_limit_check
    CHECK (max_pending_contact_requests BETWEEN 1 AND 10000)
);

CREATE UNIQUE INDEX cinderella_one_runtime_bot_profile_idx
  ON cinderella_bot_profiles (selected_for_runtime)
  WHERE selected_for_runtime = TRUE;

CREATE INDEX cinderella_bot_profiles_state_idx
  ON cinderella_bot_profiles (workflow_state, enabled, display_name);
