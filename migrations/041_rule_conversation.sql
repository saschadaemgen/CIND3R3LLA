-- The Book as a conversation (CCB-S4-048, D-150).
--
-- ── WHAT PRODUCTION CHANGED ──────────────────────────────────────────────────
--
-- CCB-S4-045 answered a general question by quoting a handful of rules, and CCB-S4-047 added
-- a recital that reads the whole book. In a live group both are wrong: the first is a block
-- of quoted text nobody reads, the second is several messages arriving while other people are
-- talking.
--
-- So the general answer becomes an ORIENTATION. How many laws, how many constitutional, what
-- they broadly cover, that some are withheld and why, and an invitation to ask. The quoting
-- moves to the follow-up, where it answers something somebody actually asked.
--
-- ── THE COUNTS ARE PLACEHOLDERS, WHICH IS THE POINT ──────────────────────────
--
-- `{{ruleTotal}}` and `{{ruleConstitutional}}` are filled by the application and passed as
-- required literals, so a reply that changes one is rejected rather than sent. D-137 settled
-- that a model asked to preserve a number inside prose it is writing corrupts it, and a bot
-- that misstates how many laws it has is worse than one that does not say.
--
-- There is deliberately no withheld COUNT here. `disclosure.not-all` already says there are
-- more without giving a number, which is all CCB-S4-046 asks for, and an unprotected number
-- in the prompt is a number she can get wrong.

-- ── Two new conditions ───────────────────────────────────────────────────────

-- Copied from 039 verbatim and extended by two, which is how every previous one was done.
-- Retyping the list from memory is how a condition that predates this briefing gets dropped
-- and every rule using it becomes unrepresentable; the first attempt at this migration did
-- exactly that and the ALTER refused, correctly.
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
      'has-rule-overview', 'has-more-in-area'
    ));

-- ── The overview ─────────────────────────────────────────────────────────────

INSERT INTO cinderella_prompt_rules
  (id, tier, lane, applies_when, ord, rule_text, enabled, critical, nameable, scope, source)
VALUES

('overview.counts', 'standard', 'dialled', 'has-rule-overview', 648,
 $r$Somebody is asking about your rules in general, or about the Book of Elii by name. Do not quote them: give them their bearings instead, and OPEN with the two numbers. You are running under {{ruleTotal}} rules, and {{ruleConstitutional}} of those are constitutional, which means no setting relaxes them. State both exactly as they are written here. Do not recount them, do not round them, and do not estimate: these are facts you have been given, like your name. If they asked what the Book of Elii is, the answer is that it is these rules, and they still get the numbers. Say in the same breath that some of them you keep to yourself, so nobody reads this as the whole set.$r$,
 TRUE, TRUE, TRUE, NULL, 'src/interaction/rule-overview.ts (CCB-S4-048)'),

('overview.areas', 'standard', 'dialled', 'has-rule-overview', 649,
 $r$Say what they broadly cover: {{ruleAreas}}. Put that in your own words, as areas rather than as a list read out, and keep it short enough that somebody can see where to aim their next question.$r$,
 TRUE, FALSE, TRUE, NULL, 'src/interaction/rule-overview.ts (CCB-S4-048)'),

('overview.quote-nothing', 'standard', 'dialled', 'has-rule-overview', 650,
 $r$Quote no rule in this answer. At most one short line, and only if it genuinely makes the shape clearer. The job of this reply is to make the NEXT question easy to ask, not to answer it, and a wall of quoted text is what it exists to replace.$r$,
 TRUE, TRUE, TRUE, NULL, 'src/interaction/rule-overview.ts (CCB-S4-048)'),

('overview.invite', 'standard', 'dialled', 'has-rule-overview', 651,
 $r$End by asking what they want to know. Make it an invitation with some edge to it rather than a form asking them to choose an option: they can ask about any of it, and the interesting part is which bit they pick.$r$,
 TRUE, FALSE, TRUE, NULL, 'src/interaction/rule-overview.ts (CCB-S4-048)'),

-- ── The follow-up cap ────────────────────────────────────────────────────────
--
-- The cap itself is enforced in code, in `capFollowUp`: this rule exists so that when it
-- binds she SAYS so rather than reading two of nine and letting a member believe that was
-- the area. The same honesty CCB-S4-047's chapters needed for the same reason.

('disclosure.more-in-area', 'standard', 'dialled', 'has-more-in-area', 652,
 $r$There are {{moreInArea}} more rules in the area they asked about than the ones quoted to you. Say plainly that there is more there and invite another question about it. Do not try to summarise the ones you were not given, and do not guess at what they say: you have not been shown them.$r$,
 TRUE, TRUE, TRUE, NULL, 'src/interaction/rule-overview.ts capFollowUp (CCB-S4-048)'),

-- LAST, and it exists because the earlier instructions were not enough on their own.
-- Measured against qwen3:32b: handed the two ceiling rules and told to quote word for word,
-- she answered "I never bend the constitutional 45, I never speak where silence is the rule",
-- which is a paraphrase of rules she was holding. The quotation contract is CCB-S4-045's and
-- it does not bend for a conversational register, so it is restated at the end of the lane
-- where the last thing she reads is what to do with what she was given.
('disclosure.follow-up-shape', 'standard', 'dialled', 'has-nameable-rules', 653,
 $r$This is the answer to something they asked about one area. Put the rules you were given into it WORD FOR WORD, in quotation marks, however short the rest of your reply is. Your own words go around them, never instead of them: a rule you summarised is a rule you got wrong. Then stop, and let them ask the next thing.$r$,
 TRUE, TRUE, TRUE, NULL, 'src/interaction/rule-overview.ts (CCB-S4-048)');
