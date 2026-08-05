-- Arming the enforcer (CCB-S4-035, D-139): the columns that make a sanction real,
-- reversible, and incapable of lying about itself.
--
-- 029 anticipated most of this and left previous_role, enforced_at, enforcement_error,
-- expires_at, undone_at and undone_by in place, unpopulated. Two things it could not
-- anticipate are added here, and both are load-bearing.
--
-- ── WHY group_member_id, WHEN member_id ALREADY EXISTS ───────────────────────
--
-- They are different identifiers and only one of them can be acted on. `member_id` is
-- the protocol's stable member id, a string, and it is what the archive keys consent on.
-- The three enforcement APIs (`apiSetMembersRole`, `apiBlockMembersForAll`,
-- `apiRemoveMembers`) all take `groupMemberIds: number[]`, the core's own numeric row id.
--
-- At decision time the engine has both, because CCB-S4-032 put `senderGroupMemberId` on
-- CapturedMessage for exactly this briefing. Expiry and undo do NOT: they run minutes or
-- hours later from a queue worker or a console click, with no message in hand and no
-- guarantee the member has spoken since. Without the numeric id on the row there would be
-- nothing to restore the role THROUGH, and a mute that cannot be lifted is the thing this
-- briefing exists to prevent. So it is captured at sanction time and stored.
--
-- NULLABLE, because a row may be written when the id is unknown, and the enforcer refuses
-- to act in that case rather than guessing. A NULL here is why a mute did not happen.
--
-- ── WHY expired_at IS SEPARATE FROM expires_at ───────────────────────────────
--
-- `expires_at` is when a mute SHOULD lift. `expired_at` is when the role was actually put
-- back. Collapsing them would make "the expiry job ran" indistinguishable from "the
-- expiry time has passed", and the difference between those two is the entire failure the
-- briefing names: a mute whose job was lost must be visible as OVERDUE rather than
-- silently permanent. With both columns, overdue is a query
-- (`expired_at IS NULL AND expires_at < now()`) instead of a hope.
--
-- The operator's manual reversal keeps its own pair, undone_at/undone_by. An automatic
-- expiry and a human deciding to lift something early are different events and the Active
-- page says which happened.
--
-- ── THE CHECK THAT MAKES A LIE UNREPRESENTABLE ───────────────────────────────
--
-- 029 shipped the observation half: a row claiming to be observed cannot carry an
-- enforcement timestamp. This adds the enforcement half. An enforced row is either
-- APPLIED (enforced_at set) or FAILED (enforcement_error set). A row that is neither has
-- claimed a sanction happened and recorded no evidence that it did, and the Active page
-- would show a member as muted who is not. That row can no longer exist.

ALTER TABLE cinderella_sanctions
  ADD COLUMN group_member_id BIGINT,
  ADD COLUMN expired_at      TIMESTAMPTZ;

ALTER TABLE cinderella_sanctions
  -- Applied or failed, never neither. The schema half of "a failed SDK call must not
  -- leave a lie".
  ADD CONSTRAINT cinderella_sanctions_enforced_outcome_check
    CHECK (mode <> 'enforced' OR enforced_at IS NOT NULL OR enforcement_error IS NOT NULL),
  -- A sanction that never applied cannot have expired, and one that was never observed to
  -- happen cannot have been reversed automatically.
  ADD CONSTRAINT cinderella_sanctions_expired_requires_enforced_check
    CHECK (expired_at IS NULL OR enforced_at IS NOT NULL),
  -- An observation acted on nobody, so there is no numeric member to have acted on.
  -- Keeps the no-act guarantee legible in the data as well as in the code.
  ADD CONSTRAINT cinderella_sanctions_observed_has_no_member_ref_check
    CHECK (mode <> 'observed' OR group_member_id IS NULL);

-- The Active page and the expiry sweep both ask the same question: which enforced,
-- applied sanctions have not been reversed by either route. 029's partial index keyed on
-- expires_at, which silently excluded exactly the overdue rows this briefing must show,
-- so it is replaced rather than added to.
DROP INDEX IF EXISTS cinderella_sanctions_active_idx;

CREATE INDEX cinderella_sanctions_active_idx
  ON cinderella_sanctions (group_id, member_id, expires_at)
  WHERE mode = 'enforced'
    AND enforced_at IS NOT NULL
    AND undone_at IS NULL
    AND expired_at IS NULL;

COMMENT ON COLUMN cinderella_sanctions.group_member_id IS
  'The core''s numeric group-member id, which is what the three enforcement APIs take. '
  'Captured at sanction time because expiry and undo run later with no message in hand '
  'and would otherwise have nothing to restore the role through. NULL means the id was '
  'not known, which is a reason the sanction did not apply rather than a missing value.';

COMMENT ON COLUMN cinderella_sanctions.expired_at IS
  'When a timed mute was actually lifted and the previous role put back. Distinct from '
  'expires_at, which is only when it was due: without both, a lost expiry job would be '
  'indistinguishable from one that ran, and the mute would be silently permanent.';

COMMENT ON TABLE cinderella_sanctions IS
  'What the enforcement ladder decided, and what was done about it. mode=observed means '
  'computed and recorded with nothing done. mode=enforced means it was attempted: '
  'enforced_at records success and enforcement_error records failure, and a CHECK '
  'refuses a row carrying neither. A mute is reversible by two routes, expired_at '
  '(automatic, via the queue) and undone_at/undone_by (an operator lifting it early), '
  'and previous_role is what either route restores.';
