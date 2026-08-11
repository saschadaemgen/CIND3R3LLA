-- 056: a bot with no wake word of its own answers to its own name (CCB-S5-030).
--
-- ── WHAT CHANGED IN CODE, AND WHY THIS FILE EXISTS ──────────────────────────
--
-- `applySettingOverrides` now resolves an ABSENT `wakeWord` override from the bot's own
-- display name instead of from the shared setting. So the two states are:
--
--   no row   the wake word follows the display name, and a rename carries through
--   a row    the operator chose this word, and it stays put
--
-- Before this, absence meant "use the SHARED wake word", which is another bot's name. That is
-- why creation wrote a row for every bot: not because the operator had chosen anything, but to
-- stop a new bot answering to the primary's name. The row then froze the value derived on the
-- day the bot was made, `validateCreation` has exactly one caller, and no rename path
-- recomputes anything, so a renamed bot went on answering to a word derived from the name it
-- used to have and nothing said so.
--
-- ── WHAT THIS MIGRATION CAN AND CANNOT RECOVER ──────────────────────────────
--
-- It CANNOT tell, for an existing row, whether the operator typed that word or merely accepted
-- the suggestion the form pre-filled. Both were stored identically. Where the stored word no
-- longer matches the display name, the two explanations are "he chose it" and "the bot was
-- renamed", and the row itself does not carry the difference.
--
-- Guessing would be worse than not knowing: silently re-deriving would change what a bot
-- answers to without being asked, and for a bot whose word really was chosen that is the same
-- class of failure in the other direction. So NOTHING IS RECLASSIFIED HERE. Existing rows stay
-- exactly as they are, the console now states which state each bot is in, and switching a bot
-- to follow its name is one deliberate click that deletes the row.
--
-- What this file does do is stop the CHANGE OF MEANING from moving anything on its own. A bot
-- with no row today reads the shared wake word; after the code change it would read one
-- derived from its display name. Usually identical, and "usually" is not good enough for the
-- one fact that decides whether a bot can be spoken to at all. So every bot without a row gets
-- one holding the value it answers to TODAY, and the deployment wakes up behaving exactly as
-- it went to sleep.
--
-- The cost is stated plainly: every bot that exists right now is marked as having an
-- operator-chosen wake word, including ones that never chose. The console shows that, and one
-- click per bot puts it back on its name. Bots created from here on need no such click,
-- because creation only writes a row when the operator's word actually differs from what the
-- name derives.

INSERT INTO cinderella_interaction_overrides (bot_profile_id, setting_key, value)
SELECT
  b.id,
  'wakeWord',
  -- The shared wake word as it stands, which is what these bots answer to today. Read out of
  -- the settings blob rather than hardcoded, so a deployment that changed it keeps its own.
  -- COALESCE covers a deployment that has never saved the interaction settings at all, where
  -- the blob has no `wakeWord` key and the code default applies; it must match
  -- `DEFAULT_INTERACTION.wakeWord`.
  COALESCE(
    (SELECT value -> 'wakeWord' FROM settings WHERE key = 'interaction'),
    '"Cinderella"'::jsonb
  )
FROM cinderella_bot_profiles b
WHERE NOT EXISTS (
        SELECT 1
          FROM cinderella_interaction_overrides o
         WHERE o.bot_profile_id = b.id
           AND o.setting_key = 'wakeWord'
      )
  -- A NULL or non-string in the settings blob would write a row the loader ignores and the
  -- console cannot explain. Skipping leaves that bot on the new derived fallback, which is a
  -- better answer than a row holding nothing.
  AND jsonb_typeof(
        COALESCE(
          (SELECT value -> 'wakeWord' FROM settings WHERE key = 'interaction'),
          '"Cinderella"'::jsonb
        )
      ) = 'string';
