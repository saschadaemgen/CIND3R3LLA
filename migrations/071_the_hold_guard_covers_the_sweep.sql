-- The hold guard covers the sweep, and a name is not content (CCB-S5-054 revision, D-241).
--
-- Two corrections to migration 070, found by sweeping every reader of message content before
-- lowering the retention bound. Both are mine; both are recorded here rather than edited into
-- 070, so the mistake stays legible and so this applies whether or not 070 has already run.
--
-- ── ONE: THE EVIDENCE-HOLD GUARANTEE HAD A DOOR THE SWEEP WALKS THROUGH ─────
--
-- Migration 020 put the hold guard in the DATABASE on purpose, and said why in a comment I
-- had read: "Application-level checks cannot deliver that: `scripts/scan-support-scope.ts`
-- already issues a bare `DELETE FROM messages` against production, and the next ad-hoc
-- remediation script would too. So the guard lives in the database, where every path meets
-- it."
--
-- It is a BEFORE **DELETE** trigger. The retention sweep does not delete; it UPDATEs. So the
-- trigger never fires for it, and the only thing standing between an evidence hold and the
-- erasure of the content it exists to preserve was one `NOT EXISTS` clause in TypeScript -
-- exactly the shape that comment forbids. The sweep is the "next remediation script" 020 was
-- written about, and I wrote it.
--
-- Worse than the missing clause is the RACE it leaves. The sweep reads its candidate ids,
-- then clears them. A hold placed between those two statements is invisible to the read, and
-- the application predicate cannot see it. In the database there is no gap.
--
-- This does NOT replace the application predicate. That one is still there and still right:
-- it keeps held rows out of the candidate set so the ordinary path never provokes an
-- exception. This is the guarantee underneath it, which is a different job.
--
-- ── TWO: CLEARING THE DISPLAY NAME COULD TURN A WITHHOLD INTO A PUBLISH ─────
--
-- 070 cleared `sender_display_name` to ''. Nothing asked for that; I added it as a privacy
-- gain, and it is a bad trade in both directions.
--
-- It buys almost nothing. The row keeps `sender_member_id`, which identifies the same person
-- more stably, and any message of theirs newer than the bound still carries the name in full.
--
-- And it can make something public. `resolveMemberByDisplayName` (src/db/bot-messages.ts)
-- selects DISTINCT senders who have posted under a name, LIMIT 2, and resolves ONLY when
-- exactly one comes back: nobody and more-than-one both return null, and a null mention is
-- treated as non-consenting, so it is redacted or withheld. Clearing a name REMOVES a sender
-- from that set. A name two members had used - one swept, one consented - resolves to the
-- consented one after a sweep, and her reply naming them publishes on the strength of the
-- wrong person's consent. That is "nothing unpublished may become public", broken by a line
-- nobody needed.
--
-- So the name stays. What a message SAID is content; who said it is the skeleton, and the
-- skeleton is what a tombstone is for.

/* ── 1. A NAME IS NOT CONTENT ─────────────────────────────────────────────── */

ALTER TABLE messages DROP CONSTRAINT messages_tombstone_holds_no_content;

ALTER TABLE messages ADD CONSTRAINT messages_tombstone_holds_no_content
  CHECK (
    content_swept_at IS NULL
    OR (
      text_body           IS NULL
      AND links_text      IS NULL
      AND media_path      IS NULL
      AND media_derived_path IS NULL
      AND media_mime      IS NULL
      AND media_meta_found IS NULL
      AND video_title     IS NULL
      AND video_id        IS NULL
      AND coalesce(search_body, '') = ''
      AND raw_json = '{}'::jsonb
    )
  );

-- Any row 070 already emptied gets its name back where the archive still knows it: from
-- another message by the same sender that has not been swept. Where the sender has no such
-- message the name is genuinely gone and the column stays '', which is honest rather than
-- invented. Reaches nothing on a deployment that has never swept, which is every deployment
-- today, and is here so that one which HAS swept is not left with a hole this migration is
-- about closing.
UPDATE messages m
   SET sender_display_name = src.sender_display_name
  FROM (
    SELECT DISTINCT ON (sender_member_id) sender_member_id, sender_display_name
      FROM messages
     WHERE content_swept_at IS NULL AND sender_display_name <> '' AND is_bot = FALSE
     ORDER BY sender_member_id, sent_at DESC
  ) src
 WHERE m.content_swept_at IS NOT NULL
   AND m.sender_display_name = ''
   AND m.sender_member_id = src.sender_member_id;

/* ── 2. THE HOLD GUARD MEETS THE SWEEP TOO ────────────────────────────────── */

CREATE FUNCTION guard_evidence_hold_sweep() RETURNS TRIGGER AS $$
BEGIN
  -- Only the transition into a tombstone. An ordinary UPDATE of a held row, and a second
  -- write to a row that is already swept, are both none of this trigger's business: the
  -- content is either still there or already gone, and raising on them would refuse
  -- legitimate edits in the name of a guarantee they do not touch.
  IF NEW.content_swept_at IS NOT NULL AND OLD.content_swept_at IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM evidence_holds h
      WHERE h.message_id = OLD.id AND h.state IN ('active', 'escalated')
    ) THEN
      RAISE EXCEPTION 'message % is under an evidence hold and its content cannot be swept', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER messages_evidence_hold_sweep_guard
  BEFORE UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION guard_evidence_hold_sweep();

COMMENT ON FUNCTION guard_evidence_hold_sweep() IS
  'The 020 hold guard, extended to the retention sweep (D-241). 020 guards DELETE; the sweep '
  'UPDATEs, so held content had only an application-level predicate in front of it - the exact '
  'thing 020''s own comment says cannot deliver this guarantee.';
