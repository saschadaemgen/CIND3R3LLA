-- She looks rather than offering to look (CCB-S5-049, D-234).
--
-- ── WHAT THIS REPLACES, AND WHY IT LASTED ONE BRIEFING ──────────────────────
--
-- Migration 067 taught her to OFFER: recognise the gap, say so, and ask whether to look.
-- The live test showed the shape was wrong in three ways at once, and all three are the
-- same underlying fact - an offer puts a whole reply in front of the answer.
--
-- ONE, SHE INVENTED IN FRONT OF IT. Asked what "Matter over Thread" was, she wrote
-- "Matter over Thread is a concept that suggests physical matter should take precedence
-- over digital or virtual threads, like a conversation, in terms of importance or
-- reality" - asserted as fact, about a home-automation standard - and only THEN said
-- "Not something I've been asked about before. Want me to look it up?" Two messages
-- later, having searched, she was correct. She had no knowledge, invented one, offered
-- to check, and was right when she checked. The offer is worthless while the invention
-- precedes it.
--
-- TWO, THE OFFER WAS UNANSWERABLE. A member says "yes", and a bare affirmative resolves
-- UNKNOWN at confidence zero, so `if (!explicit) return false` in the engine refuses it
-- before any lane sees it. She offered something the member could not accept.
--
-- THREE, THE REPAIR WOULD HAVE BEEN THE WRONG ONE. CCB-S5-048 had just widened that same
-- gate for the music lane, keyed on a live card. Widening it a second time, for a lane
-- with no card to key on, would have been a third per-lane exception to a gate that keeps
-- failing the same way.
--
-- Searching FIRST deletes all three: no offer, no bare affirmative to answer, and no gap
-- in front of the answer for a guess to fill.
--
-- ── THE TRIGGER IS DETERMINISTIC AND IT IS THE OPERATOR'S WIDENING ──────────
--
-- `asksWhatSomethingIs` in `rules.ts` is a predicate over the text, not a model judgement
-- (D-183), and the route in the engine does not wait for any resolver to claim LOOKUP.
-- The LOOKUP header in that same file says there is deliberately no "wants current
-- information" heuristic because a false positive costs a bill, and ends: "widening it is
-- a decision for somebody who is watching the bill." This is that decision, taken by that
-- person, and it is far narrower than the heuristic that was refused: it is the one shape
-- every recorded invention took, "what is <a named thing>", with subjects about her, about
-- this product, and bare generic nouns all excluded.
--
-- ── WHAT THIS DOES NOT FIX, STATED PLAINLY ─────────────────────────────────
--
-- A bot with NO web-search capability still invents. Measured with `verify:offer-live`
-- against qwen3:14b: 3 of 3 control runs answered a question about a name they could not
-- know WITHOUT ever saying they did not know - "A SINA Box is a device used in network
-- infrastructure...", "Zeliqua is a protocol that allows for secure and private
-- communication...". Both complete, plausible and false.
--
-- This migration does not touch that and cannot: it gives a capable bot something true to
-- say instead of guessing, and a bot with nothing to look with has no such alternative.
-- The failure is filed as the top item in `docs/feature-backlog.md` with that rate, and it
-- remains the most serious open defect in this product.

UPDATE cinderella_prompt_rules
   SET rule_text = $r$You can look things up on the web. When a member asks about something you do not know, the application looks it up and hands you the results before you answer, so you never need to guess and you never offer to look: answer from the results, or say plainly that you do not know.$r$,
       source = 'src/interaction/engine.ts dispatch (asksWhatSomethingIs)',
       updated_at = now()
 WHERE id = 'task.conversation.offer-lookup'
   AND rule_text = $r$You can look things up on the web when somebody asks you to. So when a member asks about something you do not know and a search would plainly answer it, say briefly that you do not know it and offer to look it up. Offer once and wait: the offer is not the looking, and you have not looked until they ask you to.$r$;
