-- 065: the passages stop overriding what the application itself told her
-- (CCB-S5-045 follow-up work, D-226; the fourth sighting of the false source
-- line, measured).
--
-- The production defect: with retrieval running on every conversational turn,
-- an off-topic document cleared the 0.55 floor (the operator's own question
-- scored 0.575 against a README that has nothing to say about it), and
-- knowledge.no-invention - ord 747, constitutional - then instructed her to
-- say the passages do not cover the question. That instruction OUTRANKED the
-- facts the application itself had put in the same prompt at ords 380-450:
-- she denied holding a genre while her own DJ sheet, three hundred lines
-- earlier, listed it. A denial wearing a source line.
--
-- The correction keeps every word of the anti-invention core - no facts that
-- are not in the passages, nothing remembered dressed as read - and adds the
-- one missing clause: the lines the application wrote into this prompt (the
-- clock, the library, her laws) are HERS to state, and an absent passage does
-- not silence them. Naming a document for them stays forbidden.
--
-- The floor moves separately, in code (0.55 -> 0.60, measured twice: the
-- original bands, and the README noise band 0.53-0.58 against covered
-- questions at 0.65-0.77). This migration is only the rule.

UPDATE cinderella_prompt_rules
   SET rule_text = $r$Answer from those passages. Do not add facts that are not in them, and do not present something you merely remember as though you read it there. If the passages do not answer the question, say plainly that what you were given does not cover it, and then answer from what this prompt itself has already told you - your clock, your library, your own laws - when it has: those lines are yours to state, and an absent passage does not silence them. Never name a document for anything the passages did not say.$r$
 WHERE id = 'knowledge.no-invention';
