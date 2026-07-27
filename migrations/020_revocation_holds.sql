-- Hide or delete on revocation, with evidence holds (CCB-S3-013).
--
-- This is the destructive half of the consent model. Until now a revocation set
-- `consent.revoked_at` and the publish views stopped selecting that member's
-- messages: the content was HIDDEN, and nothing was ever erased. This migration
-- adds the member's choice between that (hide, restorable) and real destruction
-- (delete), plus the evidence holds that defer destruction while the operator
-- reviews an illegal-content report.
--
-- Numbering: allocated from 020 per D-069. Numbers 017, 018 and 019 each exist
-- twice already; the runner keys `schema_migrations` on the full FILENAME, so
-- nothing here may ever be renamed.
--
-- WHAT IS DELIBERATELY *NOT* IN THIS FILE
--
-- `message_publish_state` and `published_messages` are NOT redefined, and that
-- is the whole point of the derived model rather than an oversight. "Hidden" is
-- already exactly what `c.revoked_at IS NULL` expresses: the moment a member
-- revokes, every one of their messages leaves the published set by derivation,
-- through all eleven public routes, with no per-route work and no stored flag.
--
-- So each state this briefing asks for is already derived:
--   * awaiting the member's answer -> revoked_at set, mode 'pending' -> hidden
--   * hide                         -> revoked_at set, mode 'hide'    -> hidden
--   * delete                       -> the row is gone
--   * restored                     -> revoked_at cleared (see below)
-- Adding a second `hidden` column would reintroduce precisely the stale-flag
-- failure mode D-003 exists to prevent, and would need both views rebuilt with
-- their explicit column lists (the trade migration 014 documents). Nothing here
-- needs that, so nothing here does it.

-- ---------------------------------------------------------------------------
-- 1. The member's choice, recorded against the consent row.
-- ---------------------------------------------------------------------------

-- NULL whenever `revoked_at` is NULL (the member is opted in). While revoked it
-- carries the choice, and 'pending' is the safe interim: the briefing forbids a
-- default for a destructive decision, so the state between "she asked" and "they
-- answered" is explicit and reads as hidden, never as consent to destroy.
ALTER TABLE consent ADD COLUMN revocation_mode TEXT
  CHECK (revocation_mode IN ('pending', 'hide', 'delete'));

-- An opt-in must leave no stale choice behind.
UPDATE consent SET revocation_mode = 'hide' WHERE revoked_at IS NOT NULL;

-- Existing revocations predate the choice. They are recorded as 'hide' above,
-- which is what they factually were: content retained, not published. Nothing
-- was ever destroyed under the old behaviour, so calling them 'hide' is accurate
-- rather than a guess, and it means those members can restore.

-- ---------------------------------------------------------------------------
-- 2. The journal learns the new decisions.
-- ---------------------------------------------------------------------------

-- The journal stays APPEND-ONLY: the mode is a new decision with its own row and
-- its own timestamp, not a mutation of the opt_out row that preceded it. That is
-- what "record which mode was chosen, and when" asks for, and it keeps the table
-- readable as a list of decisions.
--
-- Undo safety is automatic and worth stating: `undoReducesExposure` (see
-- src/db/consent-actions.ts) returns true ONLY for 'opt_in', so every action
-- added here is non-undoable by construction. Undoing a 'hide' would republish,
-- and undoing a 'delete' is not a thing that exists. Restoring after a hide is a
-- separate, first-person operation ('restore'), never a reversal.
ALTER TABLE consent_actions DROP CONSTRAINT consent_actions_action_check;
ALTER TABLE consent_actions ADD CONSTRAINT consent_actions_action_check
  CHECK (action IN ('opt_in', 'opt_out', 'hide', 'delete', 'restore'));

-- The journal already captures the consent row as it stood BEFORE each action so
-- an undo can put it back exactly. `revocation_mode` is part of that row now, so
-- it has to be captured too, or undo would restore a revoked state with no mode.
-- Concretely: revoke as 'hide', opt back in (mode cleared), then undo the opt-in.
-- Without this column the row would come back revoked with mode NULL, which is a
-- state the rest of the system has no name for.
ALTER TABLE consent_actions ADD COLUMN prev_revocation_mode TEXT
  CHECK (prev_revocation_mode IN ('pending', 'hide', 'delete'));

-- Existing journal rows predate the column. Rows whose prior state was revoked
-- get 'hide', matching the backfill of `consent.revocation_mode` above and for
-- the same reason: under the old behaviour a revocation retained everything.
UPDATE consent_actions SET prev_revocation_mode = 'hide' WHERE prev_revoked_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Evidence holds.
-- ---------------------------------------------------------------------------

-- A hold prevents DESTRUCTION. It never prevents hiding, and it never changes
-- publication: reporting an item must not be a way to unpublish it, and hiding
-- must stay instant for the member even while a report is open.
CREATE TABLE evidence_holds (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message_id   BIGINT      NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  -- 'report' = an illegal-content report. 'csam' = a hash match, which does not
  -- exist yet: the seam is here so the mechanism is built and tested before the
  -- screening that needs it (the briefing asks for the hook only).
  source       TEXT        NOT NULL CHECK (source IN ('report', 'csam')),
  state        TEXT        NOT NULL DEFAULT 'active'
                 CHECK (state IN ('active', 'released', 'escalated')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULL means NEVER EXPIRES. A CSAM quarantine and an escalation are released
  -- only by an explicit operator decision; a report hold is time-boxed so an
  -- unreviewed report cannot become a permanent block by neglect.
  expires_at   TIMESTAMPTZ,
  resolved_at  TIMESTAMPTZ,
  resolved_by  TEXT,
  outcome      TEXT CHECK (outcome IN ('release', 'destroy', 'escalate', 'expired'))
);

-- AT MOST ONE LIVE HOLD PER MESSAGE. This is the anti-abuse rule expressed in
-- the schema rather than in application code: repeated reports of the same item
-- cannot create a second hold, so they cannot compound or extend it. The clock
-- runs from the first qualifying report.
CREATE UNIQUE INDEX evidence_holds_one_live
  ON evidence_holds (message_id) WHERE state IN ('active', 'escalated');

-- The expiry sweep and the admin "expiring soon" warning both read this.
CREATE INDEX evidence_holds_expiry_idx
  ON evidence_holds (expires_at) WHERE state = 'active' AND expires_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. The hold guard: no path destroys held content.
-- ---------------------------------------------------------------------------

-- The acceptance criterion is "a held item cannot be destroyed by member
-- deletion, by operator takedown, or by any other path". Application-level
-- checks cannot deliver that: `scripts/scan-support-scope.ts` already issues a
-- bare `DELETE FROM messages` against production, and the next ad-hoc
-- remediation script would too. So the guard lives in the database, where every
-- path meets it.
--
-- It is a row-level BEFORE DELETE trigger, which means it also fires for rows
-- removed by a CASCADE. That matters: `messages.reply_to_id` cascades, so
-- destroying a member's question would otherwise silently destroy Cinderella's
-- paired answer. If that answer is held, the guard aborts the whole delete.
CREATE FUNCTION guard_evidence_hold() RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM evidence_holds h
    WHERE h.message_id = OLD.id AND h.state IN ('active', 'escalated')
  ) THEN
    RAISE EXCEPTION 'message % is under an evidence hold and cannot be destroyed', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER messages_evidence_hold_guard
  BEFORE DELETE ON messages
  FOR EACH ROW EXECUTE FUNCTION guard_evidence_hold();

-- ---------------------------------------------------------------------------
-- 5. Deletion intent that outlives the process.
-- ---------------------------------------------------------------------------

-- When a member chooses delete and some of their items are held, the hide half
-- runs immediately for everything and the delete half is DEFERRED for the held
-- ones. The member must not have to ask twice, so the intent is recorded here
-- rather than living only in a queue job: the queue actuates it, this remembers
-- it. A restart, a dead-lettered job or a cancelled job cannot lose the request.
CREATE TABLE pending_destructions (
  message_id   BIGINT      PRIMARY KEY REFERENCES messages (id) ON DELETE CASCADE,
  -- Who asked. A member may only ever destroy their own content; the operator
  -- destroy outcome is recorded separately so the two are never confused.
  member_id    TEXT        NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  requested_by TEXT        NOT NULL CHECK (requested_by IN ('member', 'operator'))
);

CREATE INDEX pending_destructions_member_idx ON pending_destructions (member_id);

-- ---------------------------------------------------------------------------
-- 6. A coarser reporter token, for the abuse threshold only.
-- ---------------------------------------------------------------------------

-- `reports.reporter_hash` is HMAC over `ip|messageId|utcDate` (D-016), which is
-- deliberately per-item-per-day so reporters cannot be profiled across the
-- archive. That property is why it CANNOT answer "has this source had many
-- illegal-content reports dismissed": message_id is inside the hash and
-- UNIQUE (message_id, reporter_hash) exists, so the count is always 0 or 1.
--
-- The briefing asks for that threshold, so this adds the narrowest token that
-- can support it: HMAC over `ip|YYYY-MM`. It is coarser than the per-day token
-- in scope (it links a source's reports within one calendar month) and blunter
-- in time (it cannot link across months at all). It is used for ONE query,
-- counting dismissed illegal reports in the current bucket, and for nothing
-- else. See D-071 for the trade and why the month bucket was chosen.
ALTER TABLE reports ADD COLUMN reporter_source TEXT;

CREATE INDEX reports_source_idx
  ON reports (reporter_source) WHERE reporter_source IS NOT NULL;
