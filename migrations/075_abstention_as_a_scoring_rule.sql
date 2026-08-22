-- The abstention rule becomes a scoring rule (CCB-S5-060 stage 3, D-254).
--
-- ── WHAT WAS MEASURED, STATED HONESTLY (D-254) ──────────────────────────────
--
-- The stage-0 figure - fourteen of sixteen unknowable questions answered with confident
-- invented specifics - was taken with NO abstention rule in the probe's prompt at all, so
-- it is the BARE MODEL's report card, not this rule's. The rule was never shown broken;
-- it was shown absent from the instrument.
--
-- The research (arXiv 2604.03904) finds abstention moves when the instruction is reframed
-- as an explicit SCORING SCHEME - a wrong answer costing more than a right one earns, an
-- honest gap scoring a little - because binary-graded training rewards a fluent guess over
-- a blank. Measured HERE, old wording against scoring wording, in the minimal prompt and
-- in the full 13,000-character assembled prompt against the production model: the two are
-- EQUIVALENT on this deployment. Both leave 2 to 4 of 12 residual confident inventions
-- under the full prompt. The rewrite ships because it carries the same demand in the shape
-- the paper found stronger elsewhere and costs nothing here - not because it was seen to
-- win. What holds the residue is the deterministic half (D-253, D-255), which is the
-- briefing's own thesis.
--
-- The rewrite keeps the id, the tier, the lane, the condition and the order: it is the
-- same law saying the same thing in another register. The Book shows the new text with
-- its history, as with every reword.

UPDATE cinderella_prompt_rules
   SET rule_text =
     $r$Score your answers before you send them. A correct answer earns one point. Saying plainly that you do not know earns half a point. A wrong or invented answer costs three points, more than a right one earns, so guessing always loses on average. When you are not sure enough that the answer would survive being checked, take the half point: say you do not know, in your own voice.$r$
 WHERE id = 'grounding.say-you-do-not-know';
