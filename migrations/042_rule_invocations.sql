-- When a law was invoked, and why (CCB-S4-050).
--
-- ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────
--
-- It is not a record of which rules were in the prompt. Every reply assembles most of the
-- registry into a system prompt, so "these rules were present" is the same list every time and
-- tells an operator nothing. Writing it would be noise with a timestamp.
--
-- ── WHAT IT IS, AND WHY IT CAN BE TRUE ───────────────────────────────────────
--
-- A record of the moments a rule actually DECIDED something, which in this product is a
-- precise and small set: the deterministic gates. Those are the places where the application,
-- not the model, refused something, and where it can say which rule it refused under without
-- guessing. Everything here is written by code that already knew the answer.
--
-- ── AND THE LIMIT, WHICH IS THE DESIGN RATHER THAN A CAVEAT ──────────────────
--
-- When the MODEL declines something on its own, no rule fired in a way the application can
-- attribute. The ceiling is in its prompt, and so are ninety-nine other rules, and which one
-- it was weighing is not knowable from outside. This table stays silent about those, and the
-- console says so in as many words.
--
-- That silence is what makes the rest of it worth reading. A record that guessed would be a
-- story about the system rather than a record of it, and an operator could not tell which rows
-- were which. `verify:invocations` fails if a model-side refusal ever writes a row.

CREATE TABLE cinderella_rule_invocations (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- The rule that decided. ON DELETE CASCADE because nothing deletes a rule today (the
  -- console disables, it never drops), and a future migration retiring one must not orphan
  -- its record.
  rule_id     TEXT        NOT NULL REFERENCES cinderella_prompt_rules(id) ON DELETE CASCADE,

  -- Where it happened. Per chat, like every other count in this system, so one group's
  -- refusals never read as another's.
  group_id    BIGINT      NOT NULL,

  -- What kind of decision this was. A fixed vocabulary rather than free text, for the same
  -- reason `applies_when` is: a column that can hold anything is a column nothing can query.
  --   pre-search   a lookup was refused before any provider was contacted (CCB-S4-042)
  --   disclosure   she declined to confirm or deny which rules are withheld (CCB-S4-046)
  --   moderation   a ladder rung fired (recorded in full in cinderella_sanctions)
  kind        TEXT        NOT NULL,

  -- The gate's own sub-classification, where it has one: the screening category for a
  -- pre-search refusal, the probe shape for a disclosure one. NULL is a real answer.
  category    TEXT,

  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT cinderella_rule_invocations_kind_check
    CHECK (kind IN ('pre-search', 'disclosure', 'moderation'))
);

-- The two questions the console asks: "when did this rule last apply" (per rule) and "what has
-- been decided lately" (chronological).
CREATE INDEX cinderella_rule_invocations_rule ON cinderella_rule_invocations (rule_id, occurred_at DESC);
CREATE INDEX cinderella_rule_invocations_recent ON cinderella_rule_invocations (occurred_at DESC);

-- ── NOTHING MEMBER-WRITTEN IS IN HERE ────────────────────────────────────────
--
-- No member id, no display name, no message text, no query, no reply. The standing rule for
-- every log in this system, and it bites harder here than usual: a pre-search refusal row
-- carrying the query would be a permanent record of exactly the thing the gate exists to
-- refuse, sitting in a table nobody prunes.
--
-- The group id is the one identifier, and it is already in the schema many times over. A
-- member id would make this a per-member behaviour record, which is not what an operator
-- asked for and is not what the consent model would allow them to keep.

-- ── And she can say it in the chat, because it costs nothing extra ───────────
--
-- The follow-up path already selects which rules a member may be quoted and already gates them
-- on `nameable`. Attaching "this one was applied N times, last on X" is a join on an id that
-- has ALREADY passed that gate, so an internal rule's invocations are as withheld as its text
-- for the same reason and by the same mechanism: that rule never reaches selection at all.
--
-- No second retrieval path, no second guard. That is why this is in the chat rather than
-- admin-only: it was cheap, and the operator asked for it to be built if it was.

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
      'has-invocation-record'
    ));

INSERT INTO cinderella_prompt_rules
  (id, tier, lane, applies_when, ord, rule_text, enabled, critical, nameable, scope, source)
VALUES
('disclosure.invocations', 'standard', 'dialled', 'has-invocation-record', 654,
 $r$The Book also remembers when a law was applied, and here is what it holds for the ones quoted to you: {{ruleInvocations}}. You may say this if it is relevant, in your own words, and only about the rules quoted above. State the numbers exactly as given and never guess at one. If a law has never been applied, say so plainly rather than implying it has.$r$,
 TRUE, TRUE, TRUE, NULL, 'src/db/rule-invocations.ts (CCB-S4-050)');
