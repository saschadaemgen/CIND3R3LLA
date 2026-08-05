-- The verbosity dial (CCB-S4-038, D-142): how much she says, per bot.
--
-- The fifth axis, stored exactly like the four migration 028 added and for the same
-- reasons: it is a per-bot setting, `cinderella_bot_profiles` is where per-bot settings
-- live, and the `settings` table is global with no bot dimension.
--
-- WHY THE DEFAULT IS 5 AND WHY THAT MATTERS MORE HERE THAN ON THE OTHER DIALS. On the tone
-- axes, 5 means "the middle of the range". Here it means something stricter: 5 is exactly
-- the behaviour that shipped before this migration. `replyCharBudget(5)` is 500 and
-- `retortCharBudget(5)` is 240, which are the two constants this briefing replaced, so
-- every existing bot keeps saying precisely what it said the day before the upgrade. A
-- dial that silently made every deployed bot chattier on the way in would be a migration
-- changing behaviour, which is not what a migration is for.
--
-- Same SMALLINT with a CHECK as the others: the range is fixed by the product decision,
-- the console renders exactly that range, and the prompt builder clamps independently. A
-- CHECK makes a bad write fail at the boundary rather than producing a prompt that reads
-- "VERBOSITY 47 of 10".

ALTER TABLE cinderella_bot_profiles
  ADD COLUMN axis_verbosity SMALLINT NOT NULL DEFAULT 5;

ALTER TABLE cinderella_bot_profiles
  ADD CONSTRAINT cinderella_bot_profiles_axis_verbosity_check
    CHECK (axis_verbosity BETWEEN 1 AND 10);

COMMENT ON COLUMN cinderella_bot_profiles.axis_verbosity IS
  'How much she says, 1 to 10. The only dial that moves a hard bound as well as the '
  'prompt: the reply character budget is computed from it, so an instruction to be '
  'expansive cannot sit under a cap that truncates her. 5 reproduces the fixed 500 '
  'character conversation cap and 240 character retort cap that preceded it. See '
  'VERBOSITY_BUDGET_CHARS in src/interaction/personality.ts.';
