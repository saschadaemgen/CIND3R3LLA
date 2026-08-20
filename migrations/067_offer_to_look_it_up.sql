-- She may offer to look something up (CCB-S5-046, D-232).
--
-- ── THE OBSERVED BEHAVIOUR, AND WHY IT WAS CORRECT ──────────────────────────
--
-- A member asked "what is a SINA Box?". She answered that it sounded like a myth she had
-- not heard of and told him to try again. She did not mention that she could look it up.
--
-- Nothing was broken. The rule engine returns UNKNOWN at zero confidence for that message,
-- `asksToLookItUp` is false, and a model claiming LOOKUP is downgraded at two independent
-- points, because the member did not ask her to go and look. That downgrade is right and is
-- untouched here: an ordinary what-is question must not spend an outbound request, a bill,
-- and untrusted text entering the prompt. What she then said is her following
-- `grounding.say-you-do-not-know` and `task.conversation.no-action-claimed` exactly.
--
-- ── THE STRUCTURAL CAUSE, WHICH IS NOT A MISSING SENTENCE ───────────────────
--
-- The conversation prompt was never told what the bot can DO. `capabilities` has been on the
-- reply request for some time and was read by exactly one thing, the post-hoc invented-refusal
-- strip: the application knew which capabilities a bot held, used that knowledge to DELETE
-- sentences she wrote about them, and never once told her she had them. And the condition
-- vocabulary had no term for it - `has-web-results` means results are already in hand, which
-- is the situation after a search rather than before one.
--
-- ── THE SHAPE IS THE ONE MUSIC ALREADY PROVED ──────────────────────────────
--
-- `has-music` is the working precedent: a per-bot capability whose facts reach the prompt only
-- for a bot the plugin is on for, so a bot without it never sees the sentence. That satisfies
-- D-183 with a condition rather than with a sentence the model is trusted to honour, which
-- matters here because a rule alone would have a bot offering to search when the operator had
-- switched searching off for it.
--
-- The alternative considered and REJECTED was a deterministic line appended by the application
-- when a lookup-capable bot says it does not know. It is structurally reliable and it is
-- D-180's trap: anything the application appends to her words becomes, through memory, an
-- example of how she writes, and twenty of those and the offer is simply a format she copies.
--
-- ── NAMEABLE FALSE, WHICH IS THE SHIPPED DEFAULT AND ALSO A DECISION ───────
--
-- Migration 039 defaults `nameable` to FALSE so that a rule a later migration adds is private
-- until somebody decides otherwise, and that default is taken deliberately rather than by
-- omission. `law-numbers.ts` derives a law's page from the registry over the NAMEABLE set, so
-- marking this quotable would renumber every law that sorts after it and change the number a
-- member is quoted for laws that did not move. Making it quotable is a separate decision with
-- that cost attached to it.
--
-- The `conversation` lane, not `dialled`: this is how she answers a question she cannot
-- answer, so it has no business in a retort, and in the searching lane she is already looking.

-- The condition vocabulary grows by one; the CHECK restates the FULL list (the 038 pattern),
-- and the paired code change is PROMPT_RULE_CONDITIONS in src/interaction/prompt-rules.ts.
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
      'has-music',
      -- CCB-S5-046: this bot HOLDS web search, as opposed to already having results.
      'has-web-search'
    ));

INSERT INTO cinderella_prompt_rules
  (id, tier, lane, applies_when, ord, rule_text, enabled, critical, nameable, scope, source)
VALUES
  ('task.conversation.offer-lookup', 'standard', 'conversation', 'has-web-search', 945,
   $r$You can look things up on the web when somebody asks you to. So when a member asks about something you do not know and a search would plainly answer it, say briefly that you do not know it and offer to look it up. Offer once and wait: the offer is not the looking, and you have not looked until they ask you to.$r$,
   TRUE, FALSE, FALSE, NULL,
   'src/interaction/ollama-reply.ts systemPrompt (has-web-search)');
