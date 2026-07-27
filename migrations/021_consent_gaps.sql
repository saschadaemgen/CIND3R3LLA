-- Restoring hidden content must not publish what was said while hidden
-- (CCB-S3-013, adversarial review finding).
--
-- THE LEAK. `restoreHidden` clears `consent.revoked_at` while deliberately
-- keeping the ORIGINAL `opted_in_at`, because publication is forward-only from
-- that timestamp and resetting it would strand every hidden message. Correct so
-- far. But capture never stops: a member who revokes and keeps talking has new
-- messages stored the whole time, and those messages also satisfy
-- `sent_at >= opted_in_at`. Clearing `revoked_at` therefore published content the
-- member posted while OPTED OUT, which they never consented to publish.
--
-- Nobody had ever seen those messages, so this was a latent leak rather than an
-- active one, and it existed only on the path this briefing introduced.
--
-- THE FIX. Record the interval a member spent revoked, and exclude messages whose
-- `sent_at` falls inside one. A table rather than a pair of columns, because a
-- member may hide and restore any number of times and every gap has to keep
-- excluding its own messages; a single `hidden_from`/`hidden_until` pair would
-- silently republish every earlier gap on the next restore.
--
-- Still fully DERIVED: nothing is stamped on a message, and the exclusion is
-- evaluated on every read like the rest of the publication model (D-003).

CREATE TABLE consent_gaps (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  member_id TEXT        NOT NULL,
  -- The revocation that opened the gap, and the restore that closed it. Both are
  -- in the same clock domain as `messages.sent_at` and `consent.opted_in_at`.
  gap_start TIMESTAMPTZ NOT NULL,
  gap_end   TIMESTAMPTZ NOT NULL,
  CONSTRAINT consent_gaps_ordered CHECK (gap_end > gap_start)
);

CREATE INDEX consent_gaps_member_idx ON consent_gaps (member_id, gap_start);

-- `CREATE OR REPLACE` rather than DROP + CREATE, which matters here: the column
-- list is unchanged, so `published_messages` (migrations/019_formatted_text.sql,
-- a long explicit projection) does not have to be dropped and rebuilt just to
-- change one predicate. Only the member branch of `self_published` gains a term;
-- everything else below is migration 015's definition verbatim.
CREATE OR REPLACE VIEW message_publish_state AS
WITH base AS (
  SELECT
    m.id,
    m.group_id,
    m.group_msg_id,
    m.sender_member_id,
    m.sent_at,
    m.is_bot,
    m.reply_to_id,
    (
      m.deleted = FALSE
      AND m.group_deleted = FALSE
      AND m.moderation_state <> 'rejected'
      AND CASE
        WHEN m.is_bot THEN
          b.publish_bot
          AND m.bot_category IS NOT NULL
          AND b.categories -> m.bot_category = 'true'::jsonb
          AND m.mentions_scanned
          AND (b.mention_guard <> 'withhold' OR NOT EXISTS (
                SELECT 1
                FROM message_mentions mm
                LEFT JOIN consent mc ON mc.member_id = mm.member_id
                WHERE mm.message_id = m.id
                  AND (mm.member_id IS NULL OR mc.member_id IS NULL OR mc.revoked_at IS NOT NULL)
              ))
        ELSE
          c.member_id IS NOT NULL
          AND c.revoked_at IS NULL
          AND m.sent_at >= c.opted_in_at
          -- An instruction publishes unless its category is switched off. NULL —
          -- ordinary chat — is unaffected.
          AND (
            m.member_category IS NULL
            OR mp.categories -> m.member_category = 'true'::jsonb
          )
          -- CCB-S3-013: said while hidden, so never consented to. A restore
          -- brings back what WAS public; it does not publish the words a member
          -- spoke while they were out of the light.
          AND NOT EXISTS (
            SELECT 1 FROM consent_gaps g
            WHERE g.member_id = m.sender_member_id
              AND m.sent_at >= g.gap_start
              AND m.sent_at < g.gap_end
          )
      END
    ) AS self_published
  FROM messages m
  LEFT JOIN consent c ON c.member_id = m.sender_member_id
  CROSS JOIN bot_publish_settings b
  CROSS JOIN member_publish_settings mp
)
SELECT
  base.id,
  base.group_id,
  base.group_msg_id,
  base.sender_member_id,
  base.sent_at,
  (
    base.self_published
    -- PAIR COHERENCE. One of her replies publishes only if the question it
    -- answers does. Derived, not stored, so a member's later /unpublish removes
    -- both halves on the next read with no backfill anywhere.
    AND (
      base.reply_to_id IS NULL
      OR EXISTS (SELECT 1 FROM base q WHERE q.id = base.reply_to_id AND q.self_published)
    )
  ) AS published
FROM base;
