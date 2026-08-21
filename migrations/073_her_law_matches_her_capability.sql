-- Her own law stops contradicting her own capability (CCB-S5-057, D-247).
--
-- ── WHAT THE OPERATOR READ, ON THE BOOK PAGE ────────────────────────────────
--
-- "You cannot see anything that was said before the message in front of you."
--
-- She HAS conversation memory. It was built in CCB-S4-044 and it works: she is given the
-- recent messages of the chat, up to a count and a window the operator sets. So a law that
-- says she cannot see them is a law that denies a capability she has, and the Book of Elii
-- prints every law regardless of the condition that selects it - which is how he found it.
--
-- ── IT WAS NOT SIMPLY LEFT BEHIND, AND THAT IS THE INTERESTING PART ─────────
--
-- Migration 038 replaced the two absolute no-memory rules with a PAIR, selected by
-- condition: `grounding.memory-window` when there is history, this one when there is none.
-- Read against its own condition it is true, in the narrow sense that on a turn with no
-- history there is nothing to see.
--
-- But a law is not read against its condition. It is read by the model as a standing
-- statement about itself, and by anybody who opens the Book as a statement about what she
-- is. "You cannot see anything that was said before" is absolute in its own words, and the
-- reader has no way to know it is conditional. D-140's own lesson applies to it: the two
-- ways of being wrong here are claiming perfect recall and denying she has any, and this
-- one does the second.
--
-- So the fix is to say what is TRUE ON THIS TURN without denying the capability: nothing
-- from earlier was given to her THIS TIME. Same guarantee - she still may not pretend to
-- remember, and still may not imply she chose not to keep track - with the false half gone.

UPDATE cinderella_prompt_rules
   SET rule_text =
     $r$Nothing from earlier in this chat has been given to you this time, so you cannot see it. If someone asks whether you remember something earlier, say plainly that it was not given to you. Do not imply you chose not to keep track, and do not pretend to remember.$r$
 WHERE id = 'grounding.no-memory-beyond';
