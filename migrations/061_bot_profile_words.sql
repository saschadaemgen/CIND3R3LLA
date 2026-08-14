-- 061: the two profile fields that say what she is, in the operator's own words (CCB-S5-041).
--
-- ── WHY THESE STOPPED BEING A NICETY ────────────────────────────────────────
--
-- `fullName` has been hard-coded to '' since the beginning and `shortDescr` appeared nowhere in
-- the tree at all. Both are writable on `T.Profile`, and neither was ever offered to the
-- operator, so a bot could say nothing about itself beyond its name.
--
-- That was a small gap this morning. It is not one now. The bot label a client may or may not
-- render comes from `peerType`, which is SimpleX's field, rendered SimpleX's way, and neither
-- the operator nor this codebase has ever watched a client display it. These two fields are
-- the ONLY place transparency can be asserted in the operator's OWN WORDS, independent of what
-- any client chooses to show. Since 2 August 2026 that is a compliance question rather than a
-- preference, and a claim that depends on somebody else's rendering is not a claim you control.
--
-- ── 160 CHARACTERS, READ FROM THE CORE ──────────────────────────────────────
--
-- `Simplex/Chat/Types.hs`: `shortDescr :: Maybe Text, -- short description limited to 160
-- characters`. The column is bounded HERE too, at the same number, so an over-long description
-- is refused at the write rather than truncated on the wire - a description silently losing its
-- last sentence would take the warranty disclaimer off the end, which is the part that matters
-- most. The console states the budget and counts down; the CHECK is what makes that honest.
--
-- `full_name` carries no documented limit in the core and none is invented here. It is bounded
-- generously so a runaway paste cannot become a profile write, and the number is stated as
-- arbitrary rather than dressed up as a protocol fact.
--
-- NOTE for whoever adds the next one: stable's `Profile` has gained `description`, `badge` and
-- `contactDomain`, which @simplex-chat/types 0.10.3 does not carry. There is no second, longer
-- field available to this deployment, so 160 is the whole budget and not a summary line.

ALTER TABLE cinderella_bot_profiles
  ADD COLUMN IF NOT EXISTS full_name  TEXT,
  ADD COLUMN IF NOT EXISTS short_descr TEXT;

-- NULL means "not set", which is distinct from '' and is what an untouched deployment holds:
-- nothing is written to any profile until the operator writes something. Same shape as
-- `avatar_path` in 049, where NULL means the deployment default rather than a gap.
ALTER TABLE cinderella_bot_profiles
  ADD CONSTRAINT cinderella_bot_profiles_short_descr_len
  CHECK (short_descr IS NULL OR char_length(short_descr) <= 160);

ALTER TABLE cinderella_bot_profiles
  ADD CONSTRAINT cinderella_bot_profiles_full_name_len
  CHECK (full_name IS NULL OR char_length(full_name) <= 200);

COMMENT ON COLUMN cinderella_bot_profiles.short_descr IS
  'The bot''s own description, up to 160 characters - the core''s documented limit, not ours. '
  'The one place transparency is stated in the operator''s words rather than left to a client''s '
  'rendering of peerType. Member-facing, so verify:no-dashes applies.';

COMMENT ON COLUMN cinderella_bot_profiles.full_name IS
  'The profile''s full name. Hard-coded to empty since the beginning and never offered to the '
  'operator until CCB-S5-041. The 200 bound is arbitrary and is not a protocol limit.';
