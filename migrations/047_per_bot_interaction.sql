-- Two bots, one name (CCB-S5-006, D-158).
--
-- ── THE DEFECT ───────────────────────────────────────────────────────────────
--
-- CCB-S5-001 made personality and standard laws per bot and left the Interaction settings
-- shared. That was not deliberate: the briefing named personality and laws, never mentioned
-- identity, and nothing pointed at it. So `wakeWord` stayed in one shared record handed to
-- every hosted bot and TWO BOTS ANSWERED TO THE SAME NAME. In separate groups that hides
-- itself, which makes it worse rather than better, because nobody finds out until two bots
-- meet.
--
-- The wake word was not alone. The nickname list and its retorts are shared too, so a
-- second bot answers to "Cindy" with retorts written in the first bot's voice, about the
-- first bot's name.
--
-- ── ONE MECHANISM, NOT A SECOND ONE ──────────────────────────────────────────
--
-- Shared defaults with per-bot deviations, exactly as 045 established for the laws, and
-- D-155's reasoning applies unchanged. A value the operator has not set for a bot is
-- INHERITED, so editing the shared value still reaches every bot that has not deviated.
--
-- Copying every setting onto every bot at creation time would have been easier to write and
-- wrong in the same way a forked rulebook is wrong: "what is this setting" would have N
-- answers with no way to tell which was the default, and an operator changing the shared
-- value would find it changed nothing.
--
-- ── WHY A CHECK LIST AND NOT A TRIGGER ───────────────────────────────────────
--
-- 045 used a trigger because the thing it had to consult (a rule's tier) lives in another
-- table and a CHECK cannot see one. Here the set of per-bot keys is STATIC, so a CHECK is
-- both sufficient and cheaper. It follows 035's precedent for fixed vocabularies, which
-- states the case: this is the one place where a mistake silently changes behaviour, and a
-- free-text key column would let one in from a form field.
--
-- The list below is duplicated from `SETTING_SCOPES` in
-- `src/interaction/setting-scope.ts`, which is a real duplication and is deliberate: the
-- code needs it to render the console and the database needs it to refuse a bad write.
-- `verify:interaction-scope` asserts the two lists agree, so the duplication cannot drift
-- without a check going red.

CREATE TABLE cinderella_interaction_overrides (
  bot_profile_id BIGINT      NOT NULL
                   REFERENCES cinderella_bot_profiles (id) ON DELETE CASCADE,
  -- A dotted path into InteractionSettings: `wakeWord`, `addressing.silenceOnUnknown`.
  setting_key    TEXT        NOT NULL,
  -- The value, as JSON, because the settings are of every shape: strings, numbers,
  -- booleans, string arrays, and the per-language records that hold the persona and the
  -- retorts. A column per type would be five columns and four of them always null.
  value          JSONB       NOT NULL,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (bot_profile_id, setting_key),

  -- ONLY THESE MAY BE SET PER BOT. Everything else is shared, and the reasons are in the
  -- inventory in `setting-scope.ts`. Consent behaviour is the one worth naming here: it is
  -- a property of the archive and the member, never of which bot was spoken to, and two
  -- bots offering different consent terms in one community would be a real defect.
  CONSTRAINT cinderella_interaction_overrides_key_check
    CHECK (setting_key IN (
      -- Identity: who she is and what she is called.
      'wakeWord',
      'botLabel',
      'nicknames.words',
      'retorts',
      'persona',
      -- Guards: what counts as being addressed, and how sure she has to be.
      'addressing.silenceOnUnknown',
      'addressing.strongSignalGreeting',
      'addressing.strongSignalReply',
      'addressing.strongSignalWindow',
      'addressing.maxInstructionLength',
      'addressing.lengthGuardConfidence',
      'confidenceThreshold'
    ))
);

CREATE INDEX cinderella_interaction_overrides_key_idx
  ON cinderella_interaction_overrides (setting_key);

COMMENT ON TABLE cinderella_interaction_overrides IS
  'Per-bot deviations from the shared interaction settings (CCB-S5-006). Absence means '
  'inherit. Only the keys in the CHECK may be set per bot; the rest are shared, and the '
  'reasons are in src/interaction/setting-scope.ts.';

COMMENT ON COLUMN cinderella_interaction_overrides.setting_key IS
  'A dotted path into InteractionSettings. Constrained to the per-bot set, so a shared '
  'setting cannot be given a per-bot value by a form that posted the wrong field name.';

/* ── A new bot must not answer to the first one's name ───────────────────────── */

-- ── THE BACKFILL, AND WHY IT IS NOT A NO-OP ─────────────────────────────────
--
-- The EXISTING bot must end up with exactly what it has today, and it does: it has no
-- override rows, so it inherits every shared value unchanged. Nothing is written for it and
-- nothing about it moves.
--
-- But CCB-S5-001 shipped the ability to create a second bot, and any bot created between
-- that briefing and this one is currently answering to the primary's wake word. Those are
-- the rows this backfill exists for. Each non-primary bot gets its OWN display name as its
-- wake word, which is what `wakeWordForNewBot` will do for every bot created from here on.
--
-- Deliberately NOT applied to the primary: it keeps the shared value, which is the name its
-- members already use, and writing an override for it would show the primary as deviating
-- from a default that exists only because of it.
--
-- Bots whose display name cannot serve as a wake word (too short, too long) get nothing
-- rather than a fallback to the shared value. No wake word is a bot nobody can address,
-- which the operator will see; the WRONG wake word is a bot answering to somebody else's
-- name, which is the defect being fixed.
INSERT INTO cinderella_interaction_overrides (bot_profile_id, setting_key, value)
SELECT id, 'wakeWord', to_jsonb(btrim(display_name))
  FROM cinderella_bot_profiles
 WHERE selected_for_runtime = FALSE
   AND char_length(btrim(display_name)) BETWEEN 2 AND 40
ON CONFLICT (bot_profile_id, setting_key) DO NOTHING;

COMMENT ON CONSTRAINT cinderella_interaction_overrides_key_check
  ON cinderella_interaction_overrides IS
  'The per-bot set, duplicated from SETTING_SCOPES in src/interaction/setting-scope.ts. '
  'verify:interaction-scope asserts the two agree, so the duplication cannot drift.';
