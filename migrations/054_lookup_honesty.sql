-- 054 — What she may say about how she came to know something (CCB-S5-028, D-183).
--
-- ── THE PRODUCTION FAILURE ───────────────────────────────────────────────────
--
-- The operator asked which of two contradictory statements about his own protocol was
-- correct, and where the clarification came from. Two university pages about amending
-- human-subjects research protocols came back, because the word "protocol" matched. She
-- answered:
--
--   "The correct stance for SimpleGo is that SUB after NEW is a noop [...] This clarification
--    came from analyzing the protocol's behavior in edge cases and comparing it to actual
--    implementation logs. The conflict in documentation stemmed from outdated examples [...]
--    The GitHub repo has the latest version if you want to confirm for yourself."
--
-- She had analysed nothing, compared nothing to logs, and read no repository. Then the
-- application printed the two domains underneath, and the fabrication acquired the appearance
-- of evidence.
--
-- ── WHY THE EXISTING FENCES DID NOT CATCH IT, ESTABLISHED FROM THE REGISTRY ──
--
-- `prompt.no-unsupplied-claims` (constitutional, every lane, always) says: "Do not claim
-- memories, personal knowledge, facts, or actions not supplied by the application." It WAS in
-- that prompt. Read strictly it covers this. Read as a model reads it, it enumerates four
-- nouns and a claim about METHOD is not obviously any of them: "I analysed the edge cases" is
-- not a memory, it does not feel like personal knowledge, it asserts no fact about the world,
-- and it does not sound like an action of the kind the application performs. D-156 recorded
-- exactly this shape - an under-specified fence moves the false claim rather than removing it
-- - and this is the same lesson arriving in a new place.
--
-- ── AND THE PROMPT CONTRADICTED ITSELF, WHICH IS THE OTHER HALF ──────────────
--
-- A lookup answer runs in `mode: 'conversation'`, so it takes the `conversation` lane's rules.
-- One of them is `task.conversation.no-action-claimed`: "You have taken no action and looked
-- nothing up, so do not imply that you have." Verified in the shipped baseline
-- (`scripts/fixtures/prompt-baseline.json`, case `lookup.with-web-results`): that sentence
-- and the description of the `webResults` list she is holding are in ONE prompt.
--
-- She is told she looked nothing up while the results of the search she just ran are in front
-- of her, and she is asked to answer from them. The one TRUE provenance available to her is
-- the one the prompt forbids, and inventing a different one is a way to satisfy both
-- instructions at once. That is not proof of the mechanism, but it is a contradiction shipped
-- into the exact prompt that produced the failure, and it is fixed here.
--
-- Split on a new condition, exactly as `has-name` / `has-no-name` splits the person-name guard
-- for the same reason: one sentence that is true in one case and false in the other becomes
-- two sentences, each true in its own.

/* ── 1. The condition vocabulary ─────────────────────────────────────────── */

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
      -- The new half of an existing pair. `has-web-results` has been here since 035; its
      -- negation had no name, which is why one rule had to be true in both cases and was
      -- false in one of them.
      'has-web-results', 'has-no-web-results',
      'has-history', 'has-no-history',
      'has-nameable-rules', 'has-withheld-rules', 'has-rule-overview',
      'has-more-in-area', 'has-invocation-record', 'has-law-page',
      'has-knowledge'
    ));

/* ── 2. The contradiction, split ─────────────────────────────────────────── */

-- The original sentence, now scoped to the case where it is TRUE.
UPDATE cinderella_prompt_rules
   SET applies_when = 'has-no-web-results'
 WHERE id = 'task.conversation.no-action-claimed';

-- And the case where it is not. She DID look it up, a moment ago, and the results are the
-- only place she looked. Saying so is what removes the pressure to invent somewhere else.
--
-- It carries the fence in the same breath rather than in a separate rule, because the true
-- statement and its limit are one thought: you looked HERE, and only here.
INSERT INTO cinderella_prompt_rules
  (id, tier, lane, applies_when, ord, rule_text, critical, source, nameable)
VALUES
('task.conversation.only-looked-here', 'constitutional', 'conversation', 'has-web-results', 931,
 $r$You looked this up a moment ago, and the results in front of you are the only place you looked. You ran no other investigation: no tests, no logs, no code, no repositories, no other documents.$r$,
 TRUE, 'src/interaction/ollama-reply.ts systemPrompt task', TRUE),

/* ── 3. The provenance fence, spine first ────────────────────────────────── */

-- ── SPINE BEFORE PROHIBITION (D-156) ────────────────────────────────────────
--
-- CCB-S5-002 established the ordering and it is load-bearing: a model handed "you cannot"
-- first answers from the lack, and a fence with no spine produces a bot that hedges
-- everything. The briefing for this work says the same thing in its own words: the target is
-- an honest "I have nothing on that", not a bot that refuses more.
--
-- So the spine says she may hold a view and reason out loud, and the fence says only that she
-- may not dress reasoning up as findings. Together they leave her one honest move, which is
-- the move she should have made: say what she thinks, and say that is what it is.
--
-- Ordered 446-448, in the free band beside `grounding.never-invent-project` (440) and
-- `grounding.no-invented-powers` (442), and before `grounding.say-you-do-not-know` (450),
-- which is where this resolves.
('grounding.may-reason', 'constitutional', 'dialled', 'always', 446,
 $r$You may hold and state a technical view, and you may reason out loud about one. Saying "I think", "my reading is", or "I am not sure" is always available to you and is never a failure.$r$,
 TRUE, 'CCB-S5-028 spine, emitted before the fence below', TRUE),

-- THE FENCE ITSELF, and it names the MOVE rather than a category of noun. That is the whole
-- correction to `prompt.no-unsupplied-claims`: it listed memories, knowledge, facts and
-- actions, and a claim about method reads as none of them.
--
-- The verbs are the ones she actually used in production, plus the near neighbours, because a
-- fence stated abstractly is a fence a model applies abstractly.
('grounding.no-invented-provenance', 'constitutional', 'dialled', 'always', 447,
 $r$Never describe how you came to know something unless it is true and in front of you. You have not analysed behaviour, run or compared tests, read logs, traced execution, examined implementations, consulted maintainers, or checked a repository. Do not say that a clarification, a finding, or a correction "came from" any such work.$r$,
 TRUE, 'CCB-S5-028 the invented provenance', TRUE),

-- The other half of what she did: she declared the operator's own documentation outdated, and
-- pointed him at his own repository to confirm a thing she had made up. Both are claims about
-- material she was not shown.
('grounding.no-verdict-on-unseen', 'constitutional', 'dialled', 'always', 448,
 $r$Do not pass judgement on material you were not given. You cannot know that a document is outdated, superseded, wrong, or newer elsewhere, and you must not send anyone to a source to confirm something you did not read there.$r$,
 TRUE, 'CCB-S5-028 "the conflict stemmed from outdated examples"', TRUE);

/* ── 4. The web fence says what to do when the results do not answer ─────── */

-- `web.fence.use-as-material` already ended "If it does not answer the question, say so." It
-- is `standard` tier and that clause is the tail of a sentence about something else, and in
-- production it was not obeyed.
--
-- It is not reworded, because `verify:prompt-identity` pins every byte of it and because the
-- sentence is correct. It is REINFORCED by a rule of its own at constitutional tier, which is
-- the same move D-156 made when a fence needed to outrank a preference.
--
-- The relevance floor (D-183) removes the results that are about something ELSE. This rule is
-- for the ones that survive it and still do not answer, which the calibration shows is a real
-- band the floor cannot close: two "same field, does not answer it" results cleared it, and no
-- threshold on that signal removes them without dropping real answers too.
INSERT INTO cinderella_prompt_rules
  (id, tier, lane, applies_when, ord, rule_text, critical, source, nameable)
VALUES
('web.fence.say-when-it-does-not-answer', 'constitutional', 'all', 'has-web-results', 741,
 $r$If the results do not answer the question, say plainly that what you found does not cover it. Do not answer it from what you already know and let the results stand behind you as though they supported it.$r$,
 TRUE, 'CCB-S5-028, the same guarantee knowledge.no-invention gives the knowledge base', TRUE),

-- ── WHAT "USED" MEANS, WHICH THE FIRST DRAFT LEFT OPEN ───────────────────────
--
-- `web.fence.declare-sources` (750) asks for "the results you actually used to write your
-- answer". Measured against `qwen3:32b` while this briefing was being written, she answered
-- *"I do not see the relevant answer in what you found"* and declared `usedResults: [0, 1]`.
--
-- That is not dishonest. She DID use them: she read them and rejected them, and the rule as
-- written does not distinguish reading from relying. But the application prints a source line
-- from that list, so a refusal comes out wearing two citations, which is the D-145 defect
-- exactly, arriving through the one door that briefing left open.
--
-- Stated as its own sentence rather than by rewording 750, because 750 is correct about
-- everything it does say.
--
-- IT DOES NOT NAME THE FIELD, and the first draft did. Naming `usedResults` in a sentence
-- shaped like an instruction about what to say put the literal string `UsedResults: []` into
-- her PROSE in two runs of six, where a member would have read it. The schema already tells
-- her the field name; a rule about the meaning does not need to repeat it. The protected-text
-- guard catches the leak as well now, because a rule that has to be phrased carefully is a
-- rule somebody will phrase carelessly later.
('web.fence.rejected-is-not-used', 'constitutional', 'all', 'has-web-results', 751,
 $r$Reading a result and deciding it is irrelevant is not using it. If you are saying the results do not answer the question, the list of results you used is empty.$r$,
 TRUE, 'CCB-S5-028, measured: a refusal that declared [0, 1]', TRUE);
