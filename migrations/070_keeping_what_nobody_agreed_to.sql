-- Keeping what nobody agreed to (CCB-S5-054, D-240).
--
-- ── WHAT THE OPERATOR ASKED, AND WHAT WAS TRUE ──────────────────────────────
--
-- The product's promise is that nothing is kept without consent. What was actually
-- true is that EVERYTHING is kept and only PUBLICATION is consent-gated. Measured on
-- his archive at stage 0: 5,194 rows, 1,857 published, 3,337 unpublished (64%), and
-- 119 MB of the 207 MB of TOAST is `raw_json` belonging to messages nobody ever
-- agreed to keep.
--
-- That is not a defect anybody introduced. Capture was built before publication was,
-- and the promise was written for the half that was consent-gated. It is worth fixing
-- rather than explaining.
--
-- ── THE TOMBSTONE, IN WORDS THAT CAN BE REPEATED ────────────────────────────
--
--     The content is gone. The fact that a message existed is not.
--
-- The row stays. What it SAID does not: the text, the extracted link text, the raw
-- SimpleX envelope, the sender's display name, the link rows and the media bytes.
-- What stays is the skeleton - which room, which item, which member id, when, what
-- kind, whether it was deleted - plus `content_swept_at`, so every surface can say
-- "the content was removed on this date" rather than rendering an empty message as
-- though the member had sent nothing.
--
-- ── WHY A TOMBSTONE AND NOT A DELETE ────────────────────────────────────────
--
-- A DELETE was the obvious reading of the briefing's shape A and it is the wrong one,
-- for four reasons that are all structural rather than stylistic:
--
--  1. `messages` has SEVEN foreign keys pointing at it, six of them ON DELETE CASCADE,
--     and a BEFORE DELETE trigger that raises `restrict_violation` for a held row. One
--     held row in a bulk DELETE aborts the ENTIRE statement, so the sweep would either
--     do nothing or have to be written row by row around the guard it must not defeat.
--  2. The cascade reaches `reply_to_id`, so deleting a member's question silently takes
--     HER answer with it - including answers the operator may have published.
--  3. `messages_group_msg_unique (group_id, group_msg_id)` is what makes capture
--     idempotent. Delete the row and the next re-capture of the same chat item inserts
--     the content again, so a sweep would compete with capture forever.
--  4. `media_path` is the ONLY handle on the encrypted original. A bulk DELETE orphans
--     those bytes permanently and silently: nothing can ever find them again.
--
-- Keeping the row and clearing the columns has none of those problems, and it gives
-- the member data registry (D-217) something honest to report.
--
-- ── AND WHY THE PUBLISHED SET CANNOT MOVE ───────────────────────────────────
--
-- `message_publish_state` reads id, group_id, group_msg_id, sender_member_id, sent_at,
-- is_bot, bot_category, reply_to_id, deleted, group_deleted, moderation_state,
-- mentions_scanned, member_category and bridge_channel_key. The sweep clears NONE of
-- those. So the publish derivation is bit-identical before and after, which is not an
-- assertion about the sweep's WHERE clause but about which columns it touches at all -
-- and `verify:retention` proves it by EXCEPT in both directions.

/* ── 1. THE MARK ──────────────────────────────────────────────────────────── */

ALTER TABLE messages ADD COLUMN content_swept_at TIMESTAMPTZ;

COMMENT ON COLUMN messages.content_swept_at IS
  'When retention removed this row''s content (CCB-S5-054, D-240). NULL means the row '
  'is intact. Non-null means the content is gone and the row is a tombstone: the fact '
  'that a message existed, and nothing it said.';

/* ── 2. A TOMBSTONE THAT STILL HOLDS CONTENT IS UNREPRESENTABLE ───────────── */

-- The repository's own habit, and it is the difference between a sweep that is correct
-- and a sweep that is BELIEVED to be correct: state the post-condition as a constraint
-- so a partial sweep cannot commit at all.
--
-- `raw_json` is NOT NULL, so the swept value is the empty object rather than NULL.
-- `search_body` is '' rather than NULL because migration 013's own CHECK requires a bot
-- row to carry one; `text_body` and the rest are nullable and go to NULL.
--
-- `sender_display_name` is NOT NULL and becomes ''. It is cleared deliberately: the
-- display name is the human-readable identity of somebody who never agreed to anything,
-- the consent model binds to `sender_member_id` and never to the name, and the one path
-- that resolves a name back to a member (`bot-messages.ts`) fails TOWARDS withholding
-- when it finds nothing, which is the safe direction.
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
      AND sender_display_name = ''
      AND coalesce(search_body, '') = ''
      AND raw_json = '{}'::jsonb
    )
  );

/* ── 3. FINDING THE ROWS WITHOUT READING THE ARCHIVE ──────────────────────── */

-- The sweep scans by age over rows not yet swept. Partial on `content_swept_at IS NULL`
-- so the index SHRINKS as the archive is swept, which is the opposite of the usual
-- direction and is the whole point: a deployment that has been running this for a year
-- pays less for the scan, not more.
--
-- D-236's lesson applies directly. The scan must never touch a content column, and it
-- does not: `sent_at` and `is_bot` are both in the index.
CREATE INDEX messages_unswept_idx
  ON messages (sent_at)
  WHERE content_swept_at IS NULL;

CREATE INDEX messages_swept_idx
  ON messages (content_swept_at)
  WHERE content_swept_at IS NOT NULL;
