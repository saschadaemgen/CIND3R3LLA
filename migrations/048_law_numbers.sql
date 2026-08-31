-- The laws have numbers (CCB-S5-005, D-159).
--
-- ── WHY THIS IS A MIGRATION AND NOT A LINE OF CODE ───────────────────────────
--
-- D-144: every sentence the model reads is a row in this table, and there is no fallback copy
-- in the source. She is about to be told what a page of the Book is, so those sentences are
-- rows here, editable in the Book of Elii like every other rule, and `verify:prompt-identity` is
-- re-baselined on purpose because the assembled prompt has moved.
--
-- ── THE NUMBER IS NOT HERS TO WRITE, AND THAT WAS MEASURED ───────────────────
--
-- The briefing asks that she be able to say "that is law 12 of the 61 I can show you". The
-- first build did exactly that: she was handed the law, the number, and an instruction to say
-- both. Against `qwen3:32b`, over four turns, the law TEXT survived every time and the number
-- did not. Handed page 12 she read out a different rule under that number; handed page 3 she
-- read the right rule and called it law 1; at a lower sharpness she read out a rule she had
-- not been given at all and called it law 4.
--
-- That is D-137 exactly, and here getting it wrong sends a member to the wrong page of her own
-- rulebook. So the page is PRINTED BY THE APPLICATION, under her words, whole, with its number
-- on it, in the same block the scene prints its law in. The intent of the briefing is met and
-- its mechanism is not: a member is told which page they are looking at, by something that
-- cannot be wrong about it, and what stays hers is the framing, which is the part that should
-- be.
--
-- These rules are therefore about what she does NOT do, and they are the same two sentences
-- the scene's brief carries, living here because the model reads them.
--
-- ── AND WHY THE NUMBERING COVERS ONLY WHAT SHE CAN SHOW ──────────────────────
--
-- Numbering every enabled law would give each withheld one a position between two she will
-- read out. Ids are family-clustered, so a member walking the numbers could read a withheld
-- law's SUBJECT off its neighbours, which is `disclosure.never-narrow` defeated by arithmetic.
-- So the numbering is over the nameable set, the denominator is the nameable count, and a
-- number outside it is answered by the application (`rulesNoSuchLaw`) rather than by a model
-- that would write a statute to fill the gap.

-- ── One new condition ────────────────────────────────────────────────────────
--
-- Copied from 041 verbatim and extended, which is how every previous one was done. Retyping
-- the list from memory is how a condition that predates this briefing gets dropped and every
-- rule using it becomes unrepresentable.
ALTER TABLE cinderella_prompt_rules DROP CONSTRAINT IF EXISTS cinderella_prompt_rules_applies_when_check;
ALTER TABLE cinderella_prompt_rules ADD CONSTRAINT cinderella_prompt_rules_applies_when_check
    CHECK (applies_when IN (
      'always',
      'has-personality', 'has-no-personality',
      'has-character', 'has-personality-no-character',
      'has-origin', 'has-no-origin',
      'has-name', 'has-no-name',
      'has-label', 'has-archive-url', 'has-project-url', 'has-model',
      'has-given-facts-with-origin', 'has-given-facts-without-origin',
      'has-nicknames', 'has-clock', 'has-web-results',
      'has-history', 'has-no-history',
      'has-nameable-rules', 'has-withheld-rules',
      'has-rule-overview', 'has-more-in-area',
      'has-invocation-record',
      'has-law-page'
    ));

-- ── One page of the Book ─────────────────────────────────────────────────────
--
-- ord 656 and 657, after the whole disclosure block, so they are the last thing she reads
-- about this answer. Not 654: `disclosure.invocations` holds that, and two rules that can be
-- selected together must not share a position.
--
-- Nameable, both of them: they describe something a member can watch happening, and there is
-- nothing in either that is a lever.

INSERT INTO cinderella_prompt_rules
  (id, tier, lane, applies_when, ord, rule_text, enabled, critical, nameable, scope, source)
VALUES

('disclosure.page-handed-over', 'standard', 'dialled', 'has-law-page', 656,
 $r$They have asked for one page of the Book of Elii, by its number or by asking for another one. That page exists and it is printed underneath your reply, whole, exactly as it is written, with its number on it, and you are not the one printing it. So write ONE short line in your own voice handing over to it, and stop there. Do not answer the question yourself, because the page answers it, and never say there is no such page.$r$,
 TRUE, TRUE, TRUE, NULL, 'src/interaction/law-numbers.ts (CCB-S5-005)'),

('disclosure.page-unseen', 'standard', 'dialled', 'has-law-page', 657,
 $r$You have not been shown what is on that page. So do not say what it says, do not quote anything, do not put anything in quotation marks or asterisks, and do not give any law a number. If you write a sentence and call it one of your laws, you have invented it, and an invented law is worse than no answer at all.$r$,
 TRUE, TRUE, TRUE, NULL, 'src/interaction/book-scene.ts sceneVoiceUsable (CCB-S5-005)');
