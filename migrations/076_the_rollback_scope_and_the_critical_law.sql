-- Two of the three serious ones (CCB-S5-062, D-260).
--
-- ── PART ONE: THE HISTORY ROW SAYS WHICH OF TWO THINGS IT IS, AS A CONSTRAINT ─
--
-- 045 added `bot_profile_id` so a reader can tell a shared change from a per-bot one, and
-- its own comment said the distinction "matters most at the moment somebody rolls one
-- back". The rollback path never read the column: pressing "Put it back to Was" on an
-- override row rewrote the SHARED law with one bot's before-text, for every bot at once,
-- and recorded the act as an ordinary rollback. The code fix makes the two kinds of change
-- two TYPES with two rollback writers (D-258's id-space treatment, one level up); this
-- makes the correspondence between `action` and the bot dimension a constraint rather than
-- a comment, so a row that claims to be a shared edit while naming a bot, or a per-bot
-- deviation while naming none, is unrepresentable.
--
-- `rollback` is the one action legal in BOTH spaces, and the row says which space by the
-- same column every reader now consults: NULL rolled back a shared change, a bot id rolled
-- back that one bot's own. That supersedes the half of 045's constraint comment which said
-- every action other than `override` and `revert` carries NULL; it was true only for as
-- long as rolling a per-bot row back wrote to the wrong table.

ALTER TABLE cinderella_prompt_rule_history
  ADD CONSTRAINT cinderella_prompt_rule_history_scope_check
  CHECK (
    CASE
      WHEN action IN ('override', 'revert') THEN bot_profile_id IS NOT NULL
      WHEN action = 'rollback'              THEN TRUE
      ELSE bot_profile_id IS NULL
    END
  );

COMMENT ON CONSTRAINT cinderella_prompt_rule_history_scope_check
  ON cinderella_prompt_rule_history IS
  'A change is in exactly one of two spaces (CCB-S5-062). `override` and `revert` are '
  'per-bot acts and must name their bot; `rollback` is legal in both spaces and names a '
  'bot exactly when it rolled a per-bot change back; every other action changes the '
  'shared law and names none.';

COMMENT ON CONSTRAINT cinderella_prompt_rule_history_action_check
  ON cinderella_prompt_rule_history IS
  '`override` sets or changes a per-bot deviation, `revert` removes one and puts that bot '
  'back on the shared text. `rollback` re-applies a recorded change''s before-side in the '
  'space that change was in, shared or per-bot. Which space a row is in is '
  '`bot_profile_id`, held to the action by the scope check beside this one.';

/* ── PART TWO: A CRITICAL LAW CANNOT BE SWITCHED OFF FOR ONE BOT ─────────────── */

-- ── THE GAP, AND WHY THE GUARD KEYS ON `critical` ────────────────────────────
--
-- A critical law that is standard rather than constitutional could be disabled for one
-- bot, and it escaped both alarms: the Book's shout reads the SHARED registry
-- (`disabledCriticalRules` sees no overrides) and `verify:prompt-identity` pins what
-- SHIPS, not what a deployment stores. So a safety rule could leave a single bot's prompt
-- with nothing anywhere saying so. Eight such laws exist in the shipped registry today:
-- the two overview rules, the five disclosure rules, and `prompt.concise-no-dashes`,
-- which is the model-side half of the CCB-S3-021 no-dashes guarantee.
--
-- `critical` is the flag that MEANS "must reach the prompt"; `constitutional` is the flag
-- that means "one text everywhere". The override guards keyed only on the second, so the
-- first was enforceable shared (where switching one off is allowed and LOUD) and silently
-- defeasible per bot. The refusal below keys on what the flag means: a per-bot override
-- may not carry `enabled = FALSE` for a critical law. Rewording one per bot stays
-- allowed, because a reworded law still reaches the prompt; switching one off is a shared
-- act, taken where the Book shouts about it.
--
-- Same shape as the constitutional refusal it extends: the console does not offer the
-- control and says why, the route cannot express it, this trigger refuses it when both
-- are bypassed, and `applyOverrides` ignores a stored `enabled = FALSE` on a critical law
-- so even a row that predates this migration removes nothing.

DROP TRIGGER cinderella_prompt_rule_overrides_constitutional_guard
  ON cinderella_prompt_rule_overrides;
DROP FUNCTION cinderella_refuse_constitutional_override();

CREATE FUNCTION cinderella_guard_prompt_rule_override()
RETURNS TRIGGER AS $$
DECLARE
  rule_tier     TEXT;
  rule_critical BOOLEAN;
BEGIN
  SELECT tier, critical INTO rule_tier, rule_critical
    FROM cinderella_prompt_rules
   WHERE id = NEW.rule_id;

  IF rule_tier = 'constitutional' THEN
    RAISE EXCEPTION
      'Rule % is constitutional and cannot be set per bot. Constitutional laws are shared '
      'by every bot so that the outermost limit is one sentence with one answer; a per-bot '
      'exception would mean no one could say what any bot will refuse, and tightening the '
      'limit later would reach only the bots nobody had touched.',
      NEW.rule_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF rule_critical AND NEW.enabled IS FALSE THEN
    RAISE EXCEPTION
      'Rule % is critical and cannot be switched off for one bot. Critical means the law '
      'must reach every prompt: the Book shouts and verify:prompt-identity goes red when '
      'one is off, and neither can see a per-bot switch. Reword it for one bot if it must '
      'differ; switching it off is a shared act, taken where the page is loud about it.',
      NEW.rule_id
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cinderella_prompt_rule_overrides_guard
  BEFORE INSERT OR UPDATE ON cinderella_prompt_rule_overrides
  FOR EACH ROW EXECUTE FUNCTION cinderella_guard_prompt_rule_override();

COMMENT ON FUNCTION cinderella_guard_prompt_rule_override() IS
  'Refuses any per-bot override of a constitutional law (CCB-S5-001) and any per-bot '
  'off-switch of a critical one (CCB-S5-062). The last line of the layers: the console '
  'never offers either control, the route cannot express them, this refuses them when '
  'both are bypassed, and applyOverrides ignores what somehow got past all three.';
