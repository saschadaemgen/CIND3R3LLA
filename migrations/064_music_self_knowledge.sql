-- 064: she knows she has a music player, and the album rides the tag
-- (CCB-S5-044 follow-up, D-218).
--
-- The operator asked her about the music player and she could not answer - not
-- what she holds, not what it does, not how to use it. The same failure as the
-- web search she once refused: a capability she has and is not aware of. The
-- fix is the clock's shape exactly: application-supplied facts under a
-- condition, rendered into the dialled prompt, so she cannot invent a genre or
-- a count - the numbers ARE the library's own GROUP BY, handed in as
-- placeholder values.
--
-- Three rules, the D-138 origin family's shape (background to draw on, a
-- prohibition, and how to answer when asked), lane `dialled`, condition
-- `has-music`, in the 381-399 gap after the origin family:
--
--   music.capability   what she holds and what she can do with it - the facts.
--   music.not-a-manual constitutional: mention it when it fits, never recite
--                      the numbers unprompted, never turn a reply into a
--                      manual. (The DETERMINISTIC half of "explain when asked"
--                      is the engine's music lane, which answers usage
--                      questions with the locked overview - D-183: this
--                      sentence shapes her conversation, the engine holds the
--                      bar.)
--   music.no-invention constitutional: the numbers and genres are the whole
--                      truth of what she holds; nothing beyond them exists.
--
-- Plus `album` on the tracks table: it is in the tag (TALB), the operator wants
-- it kept, and it was the one common field the first build dropped.

ALTER TABLE cinderella_tracks ADD COLUMN album TEXT;

-- The condition vocabulary grows by one; the CHECK restates the FULL list (the
-- 038 pattern), and the paired code change is PROMPT_RULE_CONDITIONS in
-- src/interaction/prompt-rules.ts.
ALTER TABLE cinderella_prompt_rules
  DROP CONSTRAINT cinderella_prompt_rules_applies_when_check;
ALTER TABLE cinderella_prompt_rules
  ADD CONSTRAINT cinderella_prompt_rules_applies_when_check
    CHECK (applies_when IN (
      'always',
      'has-personality', 'has-no-personality',
      'has-character', 'has-personality-no-character',
      'has-origin', 'has-no-origin',
      'has-name', 'has-no-name',
      'has-label', 'has-archive-url', 'has-project-url', 'has-model',
      'has-given-facts-with-origin', 'has-given-facts-without-origin',
      'has-nicknames', 'has-clock',
      'has-web-results', 'has-no-web-results',
      'has-history', 'has-no-history',
      'has-nameable-rules', 'has-withheld-rules', 'has-rule-overview',
      'has-more-in-area', 'has-invocation-record', 'has-law-page',
      'has-knowledge',
      -- CCB-S5-044: the music library's facts are in the prompt for this bot.
      'has-music'
    ));

-- NOT nameable, all three, and it was learned rather than chosen: the first cut
-- marked them quotable, and verify:disclosure went red because music.capability
-- contains the word "number", so a question aimed at the WITHHELD output-cap
-- machinery suddenly matched a nameable rule and slipped past the elimination
-- gate. Capability plumbing is not quotable law; her self-knowledge reaches
-- members through the has-music prompt and the locked overview lane, not
-- through the Book's quoting machinery. This is 039's default philosophy,
-- which the first cut ignored.
INSERT INTO cinderella_prompt_rules (id, tier, lane, applies_when, ord, rule_text, critical, nameable, source) VALUES
('music.capability', 'standard', 'dialled', 'has-music', 382,
 $r$You keep a music library here: {{musicTracks}} tracks across {{musicGenres}}, in {{musicPlaylists}} playlists you hold. You can list your playlists, list what is on one, and play a track when asked; a number or a name works at every step, and you play one track at a time, then wait to be asked again.$r$,
 FALSE, FALSE, 'src/interaction/personality.ts dialledPromptInputs'),
('music.not-a-manual', 'constitutional', 'dialled', 'has-music', 384,
 $r$Mention the library only when music is asked about or genuinely fits what is being said. Never recite these numbers unprompted, and never turn a reply into a manual.$r$,
 TRUE, FALSE, 'src/interaction/personality.ts dialledPromptInputs'),
('music.no-invention', 'constitutional', 'dialled', 'has-music', 386,
 $r$Those numbers and genres are the whole truth of what you hold. Never claim a track, a genre or a playlist beyond them.$r$,
 TRUE, FALSE, 'src/interaction/personality.ts dialledPromptInputs');
