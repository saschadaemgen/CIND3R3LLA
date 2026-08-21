-- The answer says which documents it used (CCB-S5-055 stage 1, D-243).
--
-- ── THE DEFECT ──────────────────────────────────────────────────────────────
--
-- The knowledge source line named the documents she was HANDED rather than the ones the
-- answer used. That was deliberate under D-137 - what she was handed is a fact the code
-- knows, what she used is a claim she could get wrong - and it produced six false
-- attributions in a week. Measured on the deployment: 38 lines emitted, all from free
-- conversation, 16 naming a document with nothing to do with the answer, and the last one
-- printing `SimpleGo README` under invented claims about a third party's roadmap and
-- pricing. A correct refusal to use a document still printed as provenance.
--
-- ── THIS IS THE WEB RULE, ONE SOURCE ALONG ──────────────────────────────────
--
-- `web.fence.declare-sources` (migration 036, order 750) has done exactly this for search
-- since CCB-S4-042 and has never produced a wrong citation. Its text is the model of this
-- one, deliberately, down to naming what the number MEANS to a member rather than only what
-- to return - because the failure being prevented is a citation attached to an answer that
-- did not use it.
--
-- WHY IT TRANSFERS, since the two differ in that web results arrive as a small numbered set:
-- passages do too. `maxChunks` and the character budget bound the selection to a handful,
-- and both ride in the SAME user-message JSON as positional arrays. The property that makes
-- the web mechanism work is present here.
--
-- AND IT IS SAFER HERE. The model is shown passage TEXT and never a document name
-- (CCB-S5-027, D-180), so its declaration is over anonymous numbered slots and the
-- application does the naming. It cannot invent a title; it can only point at a slot it was
-- given, and an index outside the handed set is dropped rather than clamped.
--
-- ── AND WHY A SELF-REPORT IS ACCEPTABLE HERE AT ALL ─────────────────────────
--
-- D-183 says a bar that lives only in a prompt is not a bar, and this rule is a sentence in
-- a prompt. It is acceptable because the declaration is a VETO rather than a source of
-- truth: retrieval decides what CAN be named, this can only narrow that set, and neither
-- alone can produce a citation. The deterministic half is the retrieval gate in
-- `shouldRetrieve`, which is where the bar actually lives.

INSERT INTO cinderella_prompt_rules
  (id, tier, lane, applies_when, ord, rule_text, critical, source)
VALUES
-- Order 749: after the three knowledge fence rules (745-747) and the no-attribution rule
-- (748), before the web declaration (750). Same condition as the rest of the family, so it
-- is selected exactly when passages are attached and never otherwise - a field asking which
-- documents were used, on a request carrying none, is an invitation to invent some.
--
-- CONSTITUTIONAL, like its web counterpart: this decides what a member is told the answer
-- rests on, and an operator editing it in the Book could turn a citation back into a guess.
('knowledge.fence.declare-documents', 'constitutional', 'all', 'has-knowledge', 749,
 $r$Also return "usedDocuments": the index numbers, counting from 0, of the reference documents you actually used to write your answer. Return an empty list if you used none of them, including when they turned out to be about something else. The application prints the source from that list and from nothing else, so a number you did not use becomes a source you never read.$r$,
 TRUE, 'src/interaction/ollama-reply.ts responseSchema + engine.ts conversation attribution');
