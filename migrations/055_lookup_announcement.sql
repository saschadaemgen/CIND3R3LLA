-- 055: she says she is going to look, whichever of the three it is (CCB-S5-025).
--
-- The searching lane was built for web search alone (CCB-S4-038, D-142) and two of its five
-- rules say so in their own text: one tells her she is "about to go and search the web", the
-- other forbids talking about "searching the web" as a capability. That was correct when the
-- web was the only lookup. It is now one of three, and a rule that names the web cannot
-- honestly announce a read of the operator's own documents.
--
-- So the PLACE moves out of the rule text and into a placeholder the application fills, and
-- the rules keep what they were always for: the FORM. One short line, her own voice, promise
-- nothing, no capability talk. The three briefs live in
-- `src/interaction/lookup-announcement.ts` and are deliberately not strings she says, so the
-- line is worded live and varies with the dials.
--
-- Text only, on three rows. No new rule, no new condition, no new lane: the searching lane
-- already selects exactly when a lookup is about to happen, and the only thing that was
-- missing was which one.

UPDATE cinderella_prompt_rules
   SET rule_text = 'The member asked you something, and you are looking it up for them right now. {{lookupBrief}}'
 WHERE id = 'task.searching.about-to-look';

-- This one is the reason the brief carries a STANCE and not just a place. As shipped it told
-- her to say she does not have this in her own head, which is true of the web and of the
-- archive and is FALSE of the knowledge base: those documents are hers, the operator gave
-- them to her, and she is reading rather than going out. Left alone it would have contradicted
-- the knowledge brief in the same prompt, and a model handed both would have produced exactly
-- the confused half-sentence this briefing exists to avoid. So the rule now asks only for the
-- line; whether she has it already is the brief's to say.
UPDATE cinderella_prompt_rules
   SET rule_text = 'Say, in one short line and in your own voice, that you are going to look this one up.'
 WHERE id = 'task.searching.say-you-are-looking';

-- Kept as a prohibition on capability talk, with the web taken out of it. She should not
-- describe ANY of the three as a tool or a feature; she is just going to go and look.
UPDATE cinderella_prompt_rules
   SET rule_text = 'Do not describe looking this up as a capability, a tool or a feature of yours. You are just going to go and look.'
 WHERE id = 'task.searching.no-capability-talk';

-- The remaining two searching rules are untouched and stay exactly as CCB-S4-038 wrote them:
-- keep it a holding line, and promise nothing. The second of those is constitutional and is
-- the reason an announcement can never start answering the question it is covering for.

-- ─────────────────────────────────────────────────────────────────────────────
-- The per-bot copies (migration 045), and only where they would now BREAK.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- An override carries its own `rule_text`, so a bot whose operator had reworded one of these
-- keeps the OLD wording. Two of the three would then be structurally wrong rather than merely
-- differently worded, and only those two are touched:
--
--   about-to-look        the old text carries no {{lookupBrief}}, so that bot's holding line
--                        loses the destination completely and says only that she is looking.
--   say-you-are-looking  the old text asserts she does not have this in her own head, which
--                        directly CONTRADICTS the knowledge brief in the same prompt. That
--                        contradiction is the whole reason this rule was reworded.
--
-- `no-capability-talk` is deliberately LEFT ALONE. Its old text names the web, which is merely
-- narrower than the new wording rather than false, and an operator's authored sentence is a
-- deviation somebody chose. Rewriting all three would have erased that choice to fix a problem
-- only two of them have.
--
-- `enabled` is never touched: switching a law off for one bot is still meaningful. A row that
-- held only text is deleted rather than left all-NULL, which the table's own CHECK forbids.
UPDATE cinderella_prompt_rule_overrides
   SET rule_text = NULL
 WHERE rule_id IN ('task.searching.about-to-look', 'task.searching.say-you-are-looking')
   AND rule_text IS NOT NULL
   AND enabled IS NOT NULL;

DELETE FROM cinderella_prompt_rule_overrides
 WHERE rule_id IN ('task.searching.about-to-look', 'task.searching.say-you-are-looking')
   AND rule_text IS NOT NULL
   AND enabled IS NULL;
