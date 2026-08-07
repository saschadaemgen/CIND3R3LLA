-- Hosting more than one of her (CCB-S5-001, D-155).
--
-- ── THE MISSING EDGE ─────────────────────────────────────────────────────────
--
-- Everything a second bot needs already exists per bot, and the briefing says so: the
-- base character and the dials (028), the origin (031), the moderation ladders (029),
-- the onboarding record and the contact address (019, 024). All of them hang off
-- `cinderella_bot_profiles`.
--
-- The SimpleX user id does not. It lives on `cinderella_bot_registry` (023), which is a
-- different table with no link back, so THERE IS NO WAY TO ASK "which personality does
-- the profile that just received this message have". Nothing noticed, because with one
-- profile hosted the answer was always the single `selected_for_runtime` row: the join
-- was not missing so much as unnecessary.
--
-- It becomes necessary the moment a second profile is hosted, and it is the whole reason
-- this migration exists. The runtime routes every event by the receiving `userId`, so
-- that id has to reach the row carrying the character, the laws and the ladders.
--
-- ── WHY THE COLUMN GOES HERE AND NOT AN FK ON THE REGISTRY ───────────────────
--
-- Hosting reads "every enabled bot, with its character, its dials, its origin and its
-- ladders". Put the id here and that is ONE row from ONE table. Put it on the registry
-- and every read on the reply path becomes a join against a table that models something
-- else: 023 is the record of what the CORE reports (actor type, automation mode,
-- disclosure label), written by discovery, and its `enabled` means "the runtime may host
-- this profile" while 019's means "this onboarding draft is live". They are deliberately
-- different questions and 023 says so in as many words. Borrowing one to answer the other
-- is how two flags end up disagreeing about whether a bot runs.
--
-- NULL is a real state and the default: a configured bot that has not yet been bound to a
-- SimpleX profile. Hosting resolves it (adopting or creating the profile) and writes it
-- back, so binding is recorded rather than re-derived from a display name on every boot -
-- which is the failure `profiles.ts` already refuses to repeat, because group membership
-- belongs to the SimpleX user and matching by name hands an operator who renamed a bot a
-- fresh profile in no groups, on a boot that logs success.

ALTER TABLE cinderella_bot_profiles
  ADD COLUMN simplex_user_id BIGINT;

-- One SimpleX profile backs at most one bot configuration. Two configurations pointing at
-- one profile would give one bot two characters and two sets of laws, decided by whichever
-- row a query happened to return first.
CREATE UNIQUE INDEX cinderella_bot_profiles_simplex_user_idx
  ON cinderella_bot_profiles (simplex_user_id)
  WHERE simplex_user_id IS NOT NULL;

ALTER TABLE cinderella_bot_profiles
  ADD CONSTRAINT cinderella_bot_profiles_simplex_user_check
    CHECK (simplex_user_id IS NULL OR simplex_user_id > 0);

COMMENT ON COLUMN cinderella_bot_profiles.simplex_user_id IS
  'The SimpleX core user id this bot configuration is bound to, or NULL when it has not '
  'been bound yet. Written by the runtime when it adopts or creates the profile. This is '
  'the column that lets an incoming event, which carries only a userId, reach the '
  'character, the laws and the ladders of the bot that received it.';

/* ── What selected_for_runtime means from here on ────────────────────────────── */

-- It used to mean "the one bot that runs". It cannot mean that any more, because every
-- enabled bot runs.
--
-- It is now THE PRIMARY, and the meaning is deliberately small: the console's default
-- selection, for pages that have to show one bot before the operator has picked one, and
-- the prompt preview's starting point. It decides nothing about hosting, nothing about
-- capture and nothing about which bot answers a member.
--
-- The one-row partial unique index from 019 is kept exactly as it is: a primary is still
-- at most one. Nothing about the index changes; what changed is the sentence it enforces.
COMMENT ON COLUMN cinderella_bot_profiles.selected_for_runtime IS
  'THE PRIMARY (CCB-S5-001): the console''s default bot selection, and nothing more. '
  'Every enabled bot is hosted regardless of this flag. It does not decide who runs, who '
  'captures, or who answers.';

/* ── Moderation counters get a bot dimension ─────────────────────────────────── */

-- ── WHY, WHEN THEY ARE ALREADY ISOLATED ─────────────────────────────────────
--
-- They are, and the reason is worth writing down because it is not obvious and it is not
-- durable. `cinderella_violations` counts per `(group_id, member_id, type)`, and
-- `groups.group_id` in the SimpleX core is `INTEGER PRIMARY KEY` over the whole database
-- rather than per user: two profiles in the SAME real group hold two rows with two
-- DIFFERENT group ids. So today two bots cannot share a counter even when they share a
-- group, and the isolation the briefing asks to be proven is already there.
--
-- It is there BY ACCIDENT of how the core allocates ids, not by design, and the accident
-- has a known expiry. D-083 and D-096 record that a conversation carries N group ids
-- across N participating profiles and that canonicalising them is planned work. The day
-- that lands, group ids stop distinguishing bots and every counter silently merges: one
-- member's nicknames in one group would accumulate against two different ladders at once,
-- and a member could be sanctioned by bot B for what bot A counted.
--
-- So the dimension is made EXPLICIT now, while the accident still holds and the backfill
-- is therefore exactly right, rather than after canonicalisation makes it ambiguous.
ALTER TABLE cinderella_violations
  ADD COLUMN bot_profile_id BIGINT REFERENCES cinderella_bot_profiles (id) ON DELETE CASCADE;

ALTER TABLE cinderella_sanctions
  ADD COLUMN bot_profile_id BIGINT REFERENCES cinderella_bot_profiles (id) ON DELETE CASCADE;

-- Every existing row belongs to the only bot that has ever run: the current primary.
-- Correct precisely because one bot has been hosted until now, which is the fact this
-- whole briefing is changing, so this backfill can never be right again after today.
UPDATE cinderella_violations
   SET bot_profile_id = (
     SELECT id FROM cinderella_bot_profiles WHERE selected_for_runtime = TRUE LIMIT 1
   )
 WHERE bot_profile_id IS NULL;

UPDATE cinderella_sanctions
   SET bot_profile_id = (
     SELECT id FROM cinderella_bot_profiles WHERE selected_for_runtime = TRUE LIMIT 1
   )
 WHERE bot_profile_id IS NULL;

-- The counting query's index, with the bot leading: every count is now "for this bot, for
-- this member, in this chat, of this type, since this cutoff". The 029 index stays too,
-- because the log page still reads across everything.
CREATE INDEX cinderella_violations_bot_window_idx
  ON cinderella_violations (bot_profile_id, group_id, member_id, type, at DESC);

CREATE INDEX cinderella_sanctions_bot_idx
  ON cinderella_sanctions (bot_profile_id, group_id, member_id, decided_at DESC);

COMMENT ON COLUMN cinderella_violations.bot_profile_id IS
  'Which bot counted this (CCB-S5-001). NULL only for rows written before the column '
  'existed and never backfillable to anything else. Two bots must never share a count: '
  'the ladders are per bot, so a shared counter would let one bot''s strict ladder fire '
  'on what another bot''s lenient one tolerated.';
