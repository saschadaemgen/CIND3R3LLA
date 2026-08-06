-- The Book of Elii's history (CCB-S4-043, D-146): every change to a rule, and what it was.
--
-- ── WHY A HISTORY IS NOT OPTIONAL HERE ───────────────────────────────────────
--
-- A badly worded rule does not break anything. It degrades her, subtly, in a way that shows
-- up as "she has been a bit off since Tuesday" and nowhere else. With eighty-two rules and no
-- record of which one moved, that is unfindable. This is the audit trail for the most
-- sensitive editable surface in the product, and it is the only thing that makes an edit
-- reversible.
--
-- ── FULL BEFORE AND AFTER, NOT A DIFF ────────────────────────────────────────
--
-- Each row carries both sides of all three editable fields, even the two that did not change.
-- A diff would be smaller and would make rollback a reconstruction: replay every row since,
-- in order, and hope none is missing. A snapshot makes rollback an assignment. At a few dozen
-- edits a year the storage argument does not exist.
--
-- ── AND IT IS WHERE "WHAT DID THIS SHIP AS" COMES FROM ───────────────────────
--
-- The OLDEST row's `old_*` values are what the rule was before anybody touched it, which is
-- what the migration seeded. So the console can mark a rule as changed from what shipped, and
-- offer a way back to it, without storing a second copy of the rule text anywhere. That
-- matters: D-144 settled that the migration is the ONLY authored copy, and a `shipped_text`
-- column would have quietly made that false.
--
-- No history rows for a rule therefore means exactly one thing: nobody has edited it.
--
-- ── WHAT IS EDITABLE, AND WHAT IS NOT ────────────────────────────────────────
--
-- Text, enabled and order. NOT tier, lane or condition, and that is a boundary rather than an
-- omission: the lane selection and the seventeen fixed conditions are contracts the assembler
-- implements in code, and a console that could retype `applies_when` would be exactly the
-- free-expression condition language D-144 ruled out, in the one place where a mistake
-- silently changes what the model is told. Those three columns have no editor and this table
-- has no column for them.

CREATE TABLE cinderella_prompt_rule_history (
  id           BIGSERIAL PRIMARY KEY,
  -- ON DELETE CASCADE is safe because nothing deletes a rule: the console disables, it never
  -- drops. It is here so that a future migration retiring a rule cannot orphan its history.
  rule_id      TEXT        NOT NULL REFERENCES cinderella_prompt_rules(id) ON DELETE CASCADE,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The admin session username. Never a member, and never a bot: nothing but a signed-in
  -- operator can reach the write path.
  actor        TEXT        NOT NULL,
  -- What kind of change this was, so the history reads as a sentence rather than as a diff
  -- the reader has to compute. `rollback` is its own kind on purpose: an undo is a change and
  -- belongs in the record as one, not as a silent second edit.
  action       TEXT        NOT NULL,

  old_text     TEXT        NOT NULL,
  new_text     TEXT        NOT NULL,
  old_enabled  BOOLEAN     NOT NULL,
  new_enabled  BOOLEAN     NOT NULL,
  old_ord      INTEGER     NOT NULL,
  new_ord      INTEGER     NOT NULL,

  CONSTRAINT cinderella_prompt_rule_history_action_check
    CHECK (action IN ('edit', 'enable', 'disable', 'reorder', 'rollback')),
  -- A row that changed nothing is a row that should never have been written. It would put
  -- noise in the one log an operator reads to find a regression.
  CONSTRAINT cinderella_prompt_rule_history_changed_check
    CHECK (old_text <> new_text OR old_enabled <> new_enabled OR old_ord <> new_ord)
);

-- The two reads the console makes: one rule's history newest-first, and the whole book's
-- history newest-first.
CREATE INDEX cinderella_prompt_rule_history_rule_idx
  ON cinderella_prompt_rule_history (rule_id, changed_at DESC, id DESC);
CREATE INDEX cinderella_prompt_rule_history_recent_idx
  ON cinderella_prompt_rule_history (changed_at DESC, id DESC);

COMMENT ON TABLE cinderella_prompt_rule_history IS
  'Every change to a prompt rule (CCB-S4-043): both sides of all three editable fields, who '
  'and when. The oldest row per rule carries what that rule shipped as, which is how the '
  'console marks drift without storing a second copy of the rule text.';

COMMENT ON COLUMN cinderella_prompt_rule_history.action IS
  'edit / enable / disable / reorder / rollback. A rollback is recorded as a change in its '
  'own right, so undoing something is as visible as doing it.';
