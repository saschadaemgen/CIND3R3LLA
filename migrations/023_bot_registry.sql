-- The persistent bot registry: one row per SimpleX profile the runtime hosts.
--
-- WHY THIS IS A NEW TABLE AND NOT A COLUMN ON cinderella_profiles.
-- The two are keyed on different things and populated by different actors.
-- `cinderella_profiles` (017) rows are OPERATOR-AUTHORED access-control subjects,
-- keyed by a slug matching '^[a-z0-9][a-z0-9-]{1,62}$'. Registry rows are
-- CORE-DISCOVERED, one per userId returned by the SimpleX core's own user list, and
-- the runtime has no slug to invent for them: a discovered display name of `Мария`
-- yields none. Retrofitting would have meant relaxing a CHECK on a deployed table in
-- the same migration that adds the feature, and every auto-inserted row would have
-- silently taken `local_only = TRUE, cloud_allowed = FALSE` (017:23-24), a privacy
-- stance nobody chose. The two are linked instead, by a nullable FK an operator sets
-- deliberately.
--
-- WHY TEXT + CHECK RATHER THAN NATIVE ENUMS. 017 uses native ENUMs, 019 uses
-- TEXT + CHECK for the same job, so there is no single house style to follow. This
-- picks TEXT + CHECK because every one of these value sets is expected to grow, and
-- extending a CHECK is a plain ALTER while adding a value to a native enum inside a
-- transaction has historically been restricted.
--
-- THE SAFETY INVARIANTS OF §14 ARE ENCODED HERE WHERE THEY ARE EXPRESSIBLE, and only
-- where they are. A constraint that cannot see intent cannot enforce "never SILENTLY
-- changes"; that half lives in the registry store, which audits every transition.

CREATE TABLE cinderella_bot_registry (
  id                         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- The SimpleX core's own user id. THE key: the runtime routes every incoming event
  -- by the `userId` carried on it, and this is the only column that can receive it.
  -- Nothing else in the schema had a SimpleX user id before this migration.
  simplex_user_id            BIGINT      NOT NULL UNIQUE,

  display_name               TEXT        NOT NULL,

  actor_type                 TEXT        NOT NULL,
  automation_mode            TEXT        NOT NULL,

  avatar_source              TEXT        NOT NULL DEFAULT 'none',
  -- Path or key for the avatar, meaning determined by `avatar_source`. NULL for
  -- `none`. The image generator is out of scope (briefing §3.2); this stores the
  -- reference so an uploaded avatar can always replace a generated one.
  avatar_ref                 TEXT,

  -- Member-facing when present, so it is in scope for `verify:no-dashes`.
  disclosure_label           TEXT,

  -- Who is accountable for a human-operated agent. TEXT rather than a foreign key
  -- because THERE IS NO ADMIN IDENTITY TABLE in this schema: the console
  -- authenticates one env-configured operator (`ADMIN_USERNAME`), so there is no row
  -- to reference. It becomes an FK when multi-admin arrives. Deliberately NOT a
  -- reference into `cinderella_profile_authorities`, which models authority OVER a
  -- profile and whose one-enabled-owner index would silently cap this at one.
  human_operator_ref         TEXT,

  -- Personality reference, per briefing §9.1 and D-084. Three columns rather than one
  -- JSONB blob: `personality_profile` on 017 is exactly what a single loosely-typed
  -- column becomes when nothing writes it, and repeating that shape to save a future
  -- migration would repeat the mistake it represents.
  personality_id             TEXT,
  personality_seed           BIGINT,
  personality_config_version TEXT,

  -- Defaults FALSE. A profile discovered in the shared SimpleX database must not
  -- begin acting merely because it exists; enabling is an operator decision and is
  -- audited. Note this is the THIRD `enabled` in the schema (017:22, 019:9) and they
  -- mean different things: 017 is "this access-control subject is active", 019 is
  -- "this onboarding draft is live", this is "the runtime may host this profile".
  enabled                    BOOLEAN     NOT NULL DEFAULT FALSE,

  -- Optional link to the operator-authored access-control profile, set deliberately.
  policy_profile_id          BIGINT      REFERENCES cinderella_profiles (id) ON DELETE SET NULL,

  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT cinderella_bot_registry_user_id_check
    CHECK (simplex_user_id > 0),

  CONSTRAINT cinderella_bot_registry_actor_type_check
    CHECK (actor_type IN ('human_user', 'human_operated_agent', 'npc', 'system_automation')),

  CONSTRAINT cinderella_bot_registry_automation_mode_check
    CHECK (automation_mode IN ('manual', 'assisted', 'autopilot', 'fully_automated')),

  CONSTRAINT cinderella_bot_registry_avatar_source_check
    CHECK (avatar_source IN ('none', 'uploaded', 'generated_template', 'generated_local_ai')),

  -- SimpleX rejects `.` and `'` in display names (briefing §12), so a name carrying
  -- one is unusable the moment it reaches the core. Rejected here as well as in the
  -- sanitiser, so a bad write fails at the boundary rather than at first use.
  CONSTRAINT cinderella_bot_registry_display_name_check
    CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 80
           AND display_name !~ '[.'']'),

  -- §14, first invariant: a human-operated agent must never become a fully automated
  -- NPC. The actor type and the mode cannot contradict each other at rest.
  CONSTRAINT cinderella_bot_registry_operated_not_automated_check
    CHECK (NOT (actor_type = 'human_operated_agent' AND automation_mode = 'fully_automated')),

  -- §3: a human-operated agent is one for which "a human remains accountable". An
  -- accountable party that is not recorded is not accountable.
  CONSTRAINT cinderella_bot_registry_operator_required_check
    CHECK (actor_type <> 'human_operated_agent'
           OR char_length(btrim(coalesce(human_operator_ref, ''))) > 0),

  -- §14, second invariant: an NPC is never presented as human-operated. §3 says an NPC
  -- "must support a disclosure label"; requiring it is the reading that makes the
  -- invariant enforceable rather than aspirational.
  CONSTRAINT cinderella_bot_registry_npc_disclosure_check
    CHECK (actor_type <> 'npc'
           OR char_length(btrim(coalesce(disclosure_label, ''))) > 0),

  -- An avatar reference without a source, or a source without a reference, is a
  -- half-written row that reads as configured.
  CONSTRAINT cinderella_bot_registry_avatar_ref_check
    CHECK ((avatar_source = 'none' AND avatar_ref IS NULL)
           OR (avatar_source <> 'none' AND char_length(btrim(coalesce(avatar_ref, ''))) > 0)),

  -- The personality reference is all-or-nothing. A seed with no configuration version
  -- reconstructs nothing, which is the failure mode `personality_profile` already has.
  CONSTRAINT cinderella_bot_registry_personality_check
    CHECK ((personality_id IS NULL AND personality_seed IS NULL AND personality_config_version IS NULL)
           OR (personality_id IS NOT NULL AND personality_seed IS NOT NULL
               AND personality_config_version IS NOT NULL))
);

-- The runtime looks profiles up by SimpleX user id on every routed event; the UNIQUE
-- constraint above already provides that index. This one serves the enable sweep at
-- boot, which reads only the enabled rows.
CREATE INDEX cinderella_bot_registry_enabled_idx
  ON cinderella_bot_registry (enabled)
  WHERE enabled = TRUE;

COMMENT ON TABLE cinderella_bot_registry IS
  'One row per SimpleX profile the multi-profile runtime may host. Core-discovered, '
  'operator-enabled. Distinct from cinderella_profiles, which is operator-authored '
  'access control keyed by slug.';

COMMENT ON COLUMN cinderella_bot_registry.simplex_user_id IS
  'The SimpleX core user id. Incoming events are routed by this value.';

COMMENT ON COLUMN cinderella_bot_registry.personality_seed IS
  'Reconstructs a personality exactly, given personality_config_version. Supersedes '
  'cinderella_profiles.personality_profile, which is never written and is scheduled '
  'for removal in the D-068 consolidation.';
