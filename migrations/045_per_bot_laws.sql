-- Standard laws, per bot (CCB-S5-001, D-155).
--
-- ── THE REQUIREMENT ──────────────────────────────────────────────────────────
--
-- The operator's swearing law is the proof case: it is a LAW, not a dial, and one bot
-- must be allowed it while another is not. So a standard law can be on, off, or carry
-- different text per bot, and constitutional laws can do none of those.
--
-- ── WHY AN OVERRIDE TABLE AND NOT THE `bot` TIER ─────────────────────────────
--
-- 035 put `bot` in the tier vocabulary for exactly this day, with the note that "the value
-- is in the vocabulary so the first per-bot rule does not need a migration". It was the
-- right thing to reserve and it is the wrong mechanism, for one reason: a tier is a
-- property of a ROW, so promoting a rule to `bot` says "this row belongs to one bot". It
-- cannot say "this law exists once, and bot B words it differently", because that is two
-- texts for one law and a row holds one text. Expressing it would mean a second row with
-- the same meaning and a different id.
--
-- A duplicate id is not a cosmetic problem here. FIVE things are keyed on the rule id and
-- every one of them would fork: the history (037) would record two lineages for one law,
-- `nameable` (039) would be set twice and could disagree about whether she may quote it,
-- the recital's chapter prefixes (040) would file the copies into different chapters, the
-- invocation record (042) would attribute a firing to one arbitrary copy, and
-- `verify:prompt-identity`'s byte baseline would have to carry N copies of every rule for
-- N bots, which would defeat what that check is for.
--
-- An override says the other thing: the law is one row, and a bot may deviate from it.
-- On, off and reworded become ONE mechanism with one shape - a row here, with NULL
-- meaning inherit - rather than the three the briefing warns against. The base rows are
-- untouched, which is what keeps the existing bot's assembled prompt byte-for-byte
-- identical, and "shared or per bot" becomes DERIVED from whether overrides exist rather
-- than declared in a column that could drift from the truth.
--
-- The `bot` tier therefore stays unused, deliberately. It is not removed: 035 is applied,
-- and removing a CHECK value from an applied migration is a change to history.

CREATE TABLE cinderella_prompt_rule_overrides (
  bot_profile_id BIGINT      NOT NULL
                   REFERENCES cinderella_bot_profiles (id) ON DELETE CASCADE,
  rule_id        TEXT        NOT NULL
                   REFERENCES cinderella_prompt_rules (id) ON DELETE CASCADE,

  -- NULL means INHERIT, in both columns, and that is the whole design. A row that
  -- switches a law off for one bot sets `enabled` and leaves `rule_text` NULL, so it
  -- keeps tracking later edits to the shared wording instead of freezing a copy of it at
  -- the moment somebody switched it off.
  enabled        BOOLEAN,
  rule_text      TEXT,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (bot_profile_id, rule_id),

  -- An override that overrides nothing is noise: it would show in the console as a
  -- deviation, and reading the law would show it identical to the shared one.
  CONSTRAINT cinderella_prompt_rule_overrides_not_empty_check
    CHECK (enabled IS NOT NULL OR rule_text IS NOT NULL),

  -- The same bound the base rules carry (035), so a per-bot wording cannot be something
  -- the shared column would have refused.
  CONSTRAINT cinderella_prompt_rule_overrides_text_check
    CHECK (rule_text IS NULL OR char_length(btrim(rule_text)) BETWEEN 1 AND 2000)
);

CREATE INDEX cinderella_prompt_rule_overrides_rule_idx
  ON cinderella_prompt_rule_overrides (rule_id);

COMMENT ON TABLE cinderella_prompt_rule_overrides IS
  'Per-bot deviations from a standard law (CCB-S5-001). NULL in either column means '
  'inherit the shared value. Constitutional laws can have no row here at all: see the '
  'trigger below.';

/* ── Constitutional laws are shared, and not overridable ─────────────────────── */

-- ── WHY A TRIGGER AND NOT A CHECK ───────────────────────────────────────────
--
-- The tier lives on the referenced row, and a CHECK cannot see another table. The
-- alternative - denormalising the tier into this table - would create a second copy of it
-- that an UPDATE on the base rule could leave stale, and a stale tier here would silently
-- permit exactly what this refuses. The precedent is 020's BEFORE DELETE hold trigger,
-- which is in this schema for the same reason: an invariant spanning two tables.
--
-- ── WHY IT IS REFUSED AT ALL ────────────────────────────────────────────────
--
-- Not because a bot cannot be vicious. That is entirely a matter of dials and standard
-- laws, and this briefing makes it easier rather than harder. It is because five bots
-- with five different outermost limits means NOBODY CAN SAY what any of them will refuse,
-- and tightening a limit tomorrow would reach only the bots nobody had touched. The
-- ceiling and the child-safety line are the two promises the product makes to people who
-- never see the console.
--
-- Genuinely different limits (an adults-only community behind an AVS) are whole rulebook
-- profiles, which is parked for a later season. They are not this, and they are
-- deliberately not per-bot suspension of a constitutional law.

CREATE OR REPLACE FUNCTION cinderella_refuse_constitutional_override()
RETURNS TRIGGER AS $$
DECLARE
  rule_tier TEXT;
BEGIN
  SELECT tier INTO rule_tier
    FROM cinderella_prompt_rules
   WHERE id = NEW.rule_id;

  IF rule_tier = 'constitutional' THEN
    RAISE EXCEPTION
      'Rule % is constitutional and cannot be set per bot. Constitutional laws are shared '
      'by every bot so that the outermost limit is one sentence with one answer; a per-bot '
      'exception would mean no one could say what any bot will refuse, and tightening the '
      'limit later would reach only the bots nobody had touched.',
      NEW.rule_id
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cinderella_prompt_rule_overrides_constitutional_guard
  BEFORE INSERT OR UPDATE ON cinderella_prompt_rule_overrides
  FOR EACH ROW EXECUTE FUNCTION cinderella_refuse_constitutional_override();

COMMENT ON FUNCTION cinderella_refuse_constitutional_override() IS
  'Refuses any per-bot override of a constitutional law (CCB-S5-001). The last line of '
  'three: the console never offers the control, the application gate refuses it, and this '
  'refuses it even if both are bypassed.';

/* ── The history records which bot an edit was for ───────────────────────────── */

-- The Book's history (037) has one row per change to a law, and until now every change
-- was to the shared text so the bot dimension was not a question. It is now: the same law
-- can be edited shared, and edited again for one bot, and a reader has to be able to tell
-- those apart - not least because rolling back the wrong one puts back the wrong text.
--
-- NULL means the change was to the SHARED law, which is what every existing row is.
ALTER TABLE cinderella_prompt_rule_history
  ADD COLUMN bot_profile_id BIGINT REFERENCES cinderella_bot_profiles (id) ON DELETE CASCADE;

CREATE INDEX cinderella_prompt_rule_history_bot_idx
  ON cinderella_prompt_rule_history (rule_id, bot_profile_id, changed_at DESC);

COMMENT ON COLUMN cinderella_prompt_rule_history.bot_profile_id IS
  'Which bot this change was for (CCB-S5-001), or NULL when it changed the shared law '
  'that every bot inherits. Every row written before this column existed is a shared '
  'change, which is why NULL is the right value for them rather than a guess.';

-- Two new actions, because a per-bot deviation being created and being withdrawn are
-- distinct events and neither is an `edit` of the shared law. `revert` is the one that
-- puts a bot back on the shared text, which is not the same as `rollback`: rollback
-- restores an earlier text, revert removes the deviation entirely.
ALTER TABLE cinderella_prompt_rule_history DROP CONSTRAINT IF EXISTS cinderella_prompt_rule_history_action_check;
ALTER TABLE cinderella_prompt_rule_history ADD CONSTRAINT cinderella_prompt_rule_history_action_check
  CHECK (action IN ('create', 'edit', 'enable', 'disable', 'reorder', 'visibility', 'rollback', 'override', 'revert'));

COMMENT ON CONSTRAINT cinderella_prompt_rule_history_action_check ON cinderella_prompt_rule_history IS
  '`override` sets or changes a per-bot deviation, `revert` removes one and puts that bot '
  'back on the shared text. Both carry a non-NULL bot_profile_id; every other action '
  'changes the shared law and carries NULL.';
