-- The personality layer (CCB-S4-029, D-133): who a bot is, and the four dials that
-- decide how it sounds when it is talking rather than executing a command.
--
-- WHY THESE ARE COLUMNS ON cinderella_bot_profiles AND NOT ROWS IN `settings`.
-- The briefing left the choice open and asked that it match how per-bot settings are
-- stored today. They are stored exactly like this: `cinderella_bot_profiles` (019) is
-- the record the Create AI Bot wizard writes, one row per bot, and every per-bot
-- setting the wizard collects is a column on it. The `settings` table is the GLOBAL
-- store, keyed by name with no bot dimension at all, which is where the interaction
-- settings live precisely because they are not per bot. A personality dialled per bot
-- and stored globally would be the same value for every bot the operator ever creates.
--
-- The runtime resolves which row is live through `selected_for_runtime`, which 019
-- already constrains to at most one via a unique partial index, so there is no
-- ambiguity about whose personality the conversation prompt is built from.
--
-- WHY SMALLINT WITH A CHECK RATHER THAN A SCALE TABLE. The range is fixed at 1 to 10
-- by the product decision, the console renders exactly that range, and the prompt
-- builder clamps to it independently. A CHECK is the cheapest way to make a bad write
-- fail at the boundary instead of producing a prompt that reads "SHARPNESS 47 of 10".
--
-- DEFAULTS ARE MID, NOT ABSENT. A bot nobody has dialled must sound like the middle of
-- each axis rather than like an accident, and NOT NULL DEFAULT 5 means every existing
-- row acquires a usable personality the moment this migration applies. The base
-- character is deliberately NULLABLE: an unwritten character must read as "not
-- configured" in the console rather than as a character somebody chose.

ALTER TABLE cinderella_bot_profiles
  ADD COLUMN base_character       TEXT,
  ADD COLUMN axis_sharpness       SMALLINT NOT NULL DEFAULT 5,
  ADD COLUMN axis_warmth          SMALLINT NOT NULL DEFAULT 5,
  ADD COLUMN axis_humor           SMALLINT NOT NULL DEFAULT 5,
  ADD COLUMN axis_permissiveness  SMALLINT NOT NULL DEFAULT 5;

ALTER TABLE cinderella_bot_profiles
  ADD CONSTRAINT cinderella_bot_profiles_base_character_check
    CHECK (base_character IS NULL OR char_length(base_character) <= 600),
  ADD CONSTRAINT cinderella_bot_profiles_axis_sharpness_check
    CHECK (axis_sharpness BETWEEN 1 AND 10),
  ADD CONSTRAINT cinderella_bot_profiles_axis_warmth_check
    CHECK (axis_warmth BETWEEN 1 AND 10),
  ADD CONSTRAINT cinderella_bot_profiles_axis_humor_check
    CHECK (axis_humor BETWEEN 1 AND 10),
  ADD CONSTRAINT cinderella_bot_profiles_axis_permissiveness_check
    CHECK (axis_permissiveness BETWEEN 1 AND 10);

COMMENT ON COLUMN cinderella_bot_profiles.base_character IS
  'Who this bot is, in the operator''s own words. Set in the Create AI Bot wizard and '
  'edited on the Personality page. NULL means not configured. Prepended to the '
  'conversation system prompt, where it outranks any generic assistant framing.';

COMMENT ON COLUMN cinderella_bot_profiles.axis_permissiveness IS
  'How far she goes when things get suggestive, 1 to 10. A boundary axis, not a tone '
  'axis: it scales cheekiness strictly below a fixed safety ceiling that is emitted on '
  'every conversation prompt at every value. No value of this column lifts that '
  'ceiling. See src/interaction/personality.ts PERMISSIVENESS_CEILING.';
