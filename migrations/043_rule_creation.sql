-- Enacting a law, not only rewriting one (CCB-S4-051).
--
-- ── THE OMISSION THIS CLOSES ─────────────────────────────────────────────────
--
-- CCB-S4-043 built the Book so the operator could edit a law, enable it, disable it and
-- reorder it. It never asked for creation, so creation was never built. That was an omission
-- in the briefing rather than in the build, and it showed up the first time the operator
-- wanted a new law and had nowhere to put it.
--
-- The consequence is not cosmetic. A Book he can rewrite but not add to is a record of
-- decisions somebody else made, rather than the place where he governs.
--
-- ── WHY THERE IS NO `remove` ACTION HERE ─────────────────────────────────────
--
-- The briefing defined removal as: leaves the assembled prompt, stays in history, can be
-- brought back. That is what `disable` already does, and each clause was checked rather than
-- assumed. `selectPromptRules` filters on `enabled`, so a disabled law is genuinely absent
-- from what she runs under; the history keeps every side of the change; and enabling it again
-- is one click.
--
-- A HARD delete is worse than redundant, it is contradictory: `cinderella_prompt_rule_history`
-- references this table ON DELETE CASCADE, so dropping a law would erase the record of it ever
-- having existed. That is the one thing the Book is for.
--
-- So removal is not built, and the console instead says plainly that disabling is how a law
-- leaves the prompt. The gap was in the wording, not in the machinery.

ALTER TABLE cinderella_prompt_rule_history DROP CONSTRAINT IF EXISTS cinderella_prompt_rule_history_action_check;
ALTER TABLE cinderella_prompt_rule_history ADD CONSTRAINT cinderella_prompt_rule_history_action_check
  CHECK (action IN ('create', 'edit', 'enable', 'disable', 'reorder', 'visibility', 'rollback'));

-- ── WHAT A CREATION ROW LOOKS LIKE ───────────────────────────────────────────
--
-- The history stores both sides of every editable field, which was built for changes and needs
-- one decision for creation: what is the OLD side of a law that did not exist?
--
-- The old text is empty and the old flags are the new ones. That keeps the invariant D-146
-- rests on, that the OLDEST row per rule is what the rule shipped as, and it makes a creation
-- readable as exactly what it is: text appearing where there was none. It also means the
-- rollback path cannot walk a rule back to before it existed, which is correct. Undoing a
-- creation is disabling the law, and that is a different act with its own record.
--
-- No schema change is needed for that, only the action value above. Recording it here so the
-- next person to read the history knows why a creation row has empty old text rather than
-- treating it as a bug.

COMMENT ON CONSTRAINT cinderella_prompt_rule_history_action_check ON cinderella_prompt_rule_history IS
  'Includes create since CCB-S4-051. A creation row carries empty old_text and identical old/new flags: '
  'there was no previous state, and the oldest row per rule must stay readable as what it shipped as.';
