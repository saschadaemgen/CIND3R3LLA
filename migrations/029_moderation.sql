-- Moderation: the violation counter, the sanction record, and the two ladders
-- (CCB-S4-032, D-136).
--
-- NOTHING IN THIS MIGRATION ENABLES AN ACTION. `cinderella_sanctions` records what
-- WOULD happen; the columns that an armed enforcer will need are present and are
-- documented below as unpopulated for now, so the arming briefing adds behaviour
-- rather than schema, and so a reader is never left guessing whether a NULL means
-- "not yet built" or "did not apply".
--
-- WHY THE RULES ARE COLUMNS ON cinderella_bot_profiles. Same reason the personality
-- layer is (028): that is the per-bot settings record the Create AI Bot wizard writes,
-- and the `settings` table is global with no bot dimension. Two bots in one deployment
-- must be able to moderate differently.
--
-- WHY THE LADDERS ARE JSONB AND THE REST ARE COLUMNS. A ladder is a list of rungs, and
-- 019 already stores a list in this table as JSONB (`custom_commands`) with a
-- `jsonb_typeof = 'array'` CHECK. Everything that is a single value stays a real column
-- with a real constraint, because a scalar hidden inside a blob is how a setting stops
-- being checkable. The rung SHAPE is validated in `normalizeModerationRules`, which
-- also pads and truncates to a fixed length, so a document written by another version
-- cannot produce a console form with a missing row.

/* ── The counter ─────────────────────────────────────────────────────────── */

-- Append-only. Queried over a rolling window; rows are never updated and the count is
-- always "how many in the last N seconds", so a violation ages out rather than being
-- deleted. Five nicknames spread across a year must never add up to a ban.
CREATE TABLE cinderella_violations (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- PER MEMBER, PER CHAT. One member being noisy in one group must not accumulate
  -- against them somewhere else, so both are part of every count.
  group_id            BIGINT      NOT NULL,
  member_id           TEXT        NOT NULL,

  -- The name at the time, so the log is readable months later even if they rename.
  member_display_name TEXT        NOT NULL,

  -- The member's group role when it happened, or NULL when the adapter could not say.
  -- NULL is a real answer and the arming briefing must refuse to act on it: aiming a
  -- sanction at a member whose role is unknown risks aiming at an owner, which would
  -- fail at the SDK and read as a bug rather than as the policy it is.
  member_role         TEXT,

  -- GENERIC BY CONSTRUCTION. Nicknames are the first trigger, not the only one the
  -- ladder can express. A later rule adds a value here and reuses everything else;
  -- counts never mix across types.
  type                TEXT        NOT NULL,

  at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT cinderella_violations_type_check
    CHECK (type IN ('nickname')),
  CONSTRAINT cinderella_violations_role_check
    CHECK (member_role IS NULL OR member_role IN
      ('relay', 'observer', 'author', 'member', 'moderator', 'admin', 'owner'))
);

-- The one query this table exists for: count of a type for a member in a chat since a
-- cutoff. Leading columns match the equality predicates, `at` closes the range.
CREATE INDEX cinderella_violations_window_idx
  ON cinderella_violations (group_id, member_id, type, at DESC);

-- The log page reads newest first across everything.
CREATE INDEX cinderella_violations_recent_idx
  ON cinderella_violations (at DESC);

/* ── The record of what happened, or would have ──────────────────────────── */

CREATE TABLE cinderella_sanctions (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  group_id            BIGINT      NOT NULL,
  member_id           TEXT        NOT NULL,
  member_display_name TEXT        NOT NULL,
  member_role         TEXT,

  -- What would happen, or did. 'none' never reaches this table: a row exists because a
  -- rung fired.
  action              TEXT        NOT NULL,

  -- Why, in the operator's terms: which rule, what count, over what window, which rung.
  -- Held as the three parts AND the rendered sentence, because the parts are what a
  -- future query wants and the sentence is what the log page shows.
  violation_type      TEXT        NOT NULL,
  violation_count     INTEGER     NOT NULL,
  window_seconds      INTEGER     NOT NULL,
  rung_threshold      INTEGER,
  reason              TEXT        NOT NULL,

  -- 'observed' means computed and recorded and NOTHING DONE. It is the only value this
  -- briefing writes. 'enforced' exists so the arming briefing has somewhere to put a
  -- real action, and so the console can show both in one list without a second table.
  mode                TEXT        NOT NULL,

  decided_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ── FIELDS FOR THE ARMING BRIEFING. ALL NULL TODAY, BY DESIGN. ───────────
  -- Nothing in CCB-S4-032 writes any of these. They are here so that arming is a
  -- behaviour change rather than a schema change on a table that will by then hold
  -- production history.
  --
  -- previous_role: what the member held before a mute, so restoring a muted moderator
  --   returns them to moderator and not to member. Losing this is how a mute silently
  --   becomes a demotion.
  previous_role       TEXT,
  -- enforced_at: when the SDK call actually succeeded. Distinct from decided_at,
  --   because a decision that failed to apply must not look like one that applied.
  enforced_at         TIMESTAMPTZ,
  -- enforcement_error: why it did not apply. A failed sanction that records nothing is
  --   indistinguishable from one that was never attempted.
  enforcement_error   TEXT,
  -- expires_at: when a timed mute should lift, for the queue to sweep.
  expires_at          TIMESTAMPTZ,
  -- undone_at / undone_by: the operator's manual reversal.
  undone_at           TIMESTAMPTZ,
  undone_by           TEXT,

  CONSTRAINT cinderella_sanctions_action_check
    CHECK (action IN ('warn', 'mute', 'block', 'remove')),
  CONSTRAINT cinderella_sanctions_mode_check
    CHECK (mode IN ('observed', 'enforced')),
  CONSTRAINT cinderella_sanctions_type_check
    CHECK (violation_type IN ('nickname')),
  CONSTRAINT cinderella_sanctions_role_check
    CHECK (member_role IS NULL OR member_role IN
      ('relay', 'observer', 'author', 'member', 'moderator', 'admin', 'owner')),
  CONSTRAINT cinderella_sanctions_previous_role_check
    CHECK (previous_role IS NULL OR previous_role IN
      ('relay', 'observer', 'author', 'member', 'moderator', 'admin', 'owner')),
  -- An observed sanction did nothing, so it cannot carry a time at which it was done.
  -- This is the schema half of the no-act guarantee: a row claiming to be observed AND
  -- enforced cannot exist.
  CONSTRAINT cinderella_sanctions_observed_never_enforced_check
    CHECK (mode <> 'observed' OR (enforced_at IS NULL AND previous_role IS NULL))
);

CREATE INDEX cinderella_sanctions_recent_idx
  ON cinderella_sanctions (decided_at DESC);

-- The Active page: who is currently under something that has not lapsed or been undone.
-- Correctly returns nothing while every row is observed, which is what the page says.
CREATE INDEX cinderella_sanctions_active_idx
  ON cinderella_sanctions (group_id, member_id, expires_at)
  WHERE mode = 'enforced' AND undone_at IS NULL;

COMMENT ON TABLE cinderella_sanctions IS
  'What the enforcement ladder decided. mode=observed means computed and recorded with '
  'nothing done, which is the only value CCB-S4-032 writes. The previous_role, '
  'enforced_at, enforcement_error, expires_at and undone_* columns belong to the arming '
  'briefing and are unpopulated until then.';

/* ── The rules, per bot ──────────────────────────────────────────────────── */

ALTER TABLE cinderella_bot_profiles
  ADD COLUMN moderation_mode                TEXT    NOT NULL DEFAULT 'observe',
  ADD COLUMN moderation_verbal_window_secs  INTEGER NOT NULL DEFAULT 600,
  ADD COLUMN moderation_enforce_window_secs INTEGER NOT NULL DEFAULT 600,
  ADD COLUMN moderation_verbal_ladder       JSONB   NOT NULL
    DEFAULT '[{"threshold":2,"sharpnessBonus":1},
              {"threshold":3,"sharpnessBonus":2},
              {"threshold":4,"sharpnessBonus":3},
              {"threshold":5,"sharpnessBonus":4}]'::jsonb,
  ADD COLUMN moderation_enforce_ladder      JSONB   NOT NULL
    DEFAULT '[{"threshold":5,"action":"warn","durationSeconds":0},
              {"threshold":10,"action":"mute","durationSeconds":600},
              {"threshold":20,"action":"none","durationSeconds":0},
              {"threshold":30,"action":"none","durationSeconds":0}]'::jsonb,
  ADD COLUMN moderation_exempt_roles        JSONB   NOT NULL
    DEFAULT '["owner","admin","moderator"]'::jsonb,
  ADD COLUMN moderation_verbal_exempts_staff BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN moderation_announce            BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE cinderella_bot_profiles
  -- Only 'observe' is implemented. The CHECK permits both so the arming briefing does
  -- not have to alter a constraint on a deployed table to switch a bot on; the console
  -- is what refuses to offer 'enforce' today.
  ADD CONSTRAINT cinderella_bot_profiles_moderation_mode_check
    CHECK (moderation_mode IN ('observe', 'enforce')),
  ADD CONSTRAINT cinderella_bot_profiles_verbal_window_check
    CHECK (moderation_verbal_window_secs BETWEEN 10 AND 604800),
  ADD CONSTRAINT cinderella_bot_profiles_enforce_window_check
    CHECK (moderation_enforce_window_secs BETWEEN 10 AND 604800),
  ADD CONSTRAINT cinderella_bot_profiles_verbal_ladder_check
    CHECK (jsonb_typeof(moderation_verbal_ladder) = 'array'),
  ADD CONSTRAINT cinderella_bot_profiles_enforce_ladder_check
    CHECK (jsonb_typeof(moderation_enforce_ladder) = 'array'),
  ADD CONSTRAINT cinderella_bot_profiles_exempt_roles_check
    CHECK (jsonb_typeof(moderation_exempt_roles) = 'array');

COMMENT ON COLUMN cinderella_bot_profiles.moderation_mode IS
  'observe (the only implemented value) computes and records a sanction without acting. '
  'enforce is reserved for the arming briefing; the console does not offer it.';
