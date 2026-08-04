-- The warning is spoken, and counted (CCB-S4-033, D-137).
--
-- CCB-S4-032 shipped a ladder whose warn rung produced a log row and complete silence in
-- the chat. A member climbing toward a sanction was never told, which meant that when
-- enforcement is eventually armed the first thing they would notice is being muted.
--
-- THE LINE THIS MIGRATION ENCODES: speech is live, action stays observed. A warning
-- changes nothing about anybody's membership, so it happens now. Mute, block and remove
-- touch a member's standing, so they stay recorded-only until the arming briefing.

/* ── What was actually said, as distinct from what was merely decided ────── */

-- NULL means the step was computed and recorded and NOTHING WAS SAID, which is every
-- mute, block and remove today. A timestamp means she spoke in the chat.
--
-- A separate column rather than a new `mode` value, because the two questions are
-- independent and will stay independent: `mode` is did-it-happen-to-the-member, this is
-- did-they-hear-about-it. An armed system will have enforced steps that are announced
-- and enforced steps that are not, and collapsing them now would make that unsayable.
ALTER TABLE cinderella_sanctions
  ADD COLUMN spoken_at TIMESTAMPTZ;

-- The schema half of "speech is live, action stays observed": while a row is observed,
-- the only step that may have been spoken is a warning. A recorded mute that claims to
-- have been announced would mean she told somebody they were muted when they were not.
--
-- Written to permit the armed future WITHOUT an ALTER on a table that will by then hold
-- production history (the same discipline as 029's reserved columns): once a row is
-- `enforced`, any action may carry a spoken_at, which is what the announcement setting
-- turns on.
ALTER TABLE cinderella_sanctions
  ADD CONSTRAINT cinderella_sanctions_observed_speaks_only_warnings_check
    CHECK (mode = 'enforced' OR spoken_at IS NULL OR action = 'warn');

COMMENT ON COLUMN cinderella_sanctions.spoken_at IS
  'When she said it in the chat. NULL means the step was recorded and nothing was said, '
  'which is every non-warning step while the mode is observe. Distinct from mode, which '
  'says whether it happened to the member rather than whether they heard about it.';

/* ── How many warnings come before the ladder advances ───────────────────── */

-- THE OPERATOR-FACING CONTROL, and the reason it exists: before this, how many warnings
-- preceded a mute was implied by the gap between two rung thresholds (5 and 10), so the
-- operator had to derive by arithmetic a number they wanted to state.
--
-- ONE SOURCE OF TRUTH. This column is authoritative and the threshold of the rung that
-- follows the warning is DERIVED from it, in `normalizeModerationRules`, on every read
-- and every write. There is deliberately no code path that can hold the two in
-- disagreement, because two controls for one value is how a console starts lying.
--
-- 0 means the operator has deliberately chosen no warnings at all: the warn rung goes
-- inert and the ordering guarantee does not apply to them. Any other value means at
-- least one warning is heard before anything harder is decided.
ALTER TABLE cinderella_bot_profiles
  ADD COLUMN moderation_warning_count INTEGER NOT NULL DEFAULT 5;

ALTER TABLE cinderella_bot_profiles
  ADD CONSTRAINT cinderella_bot_profiles_warning_count_check
    CHECK (moderation_warning_count BETWEEN 0 AND 100);

COMMENT ON COLUMN cinderella_bot_profiles.moderation_warning_count IS
  'How many warnings are spoken before the ladder advances. Authoritative: the threshold '
  'of the rung after the warning is derived from it, never stored independently. 0 means '
  'no warnings, chosen deliberately.';
