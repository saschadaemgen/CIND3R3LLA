-- Quarantine withholds; an ordinary hold does not (CCB-S3-013 §4).
--
-- Migration 020 established the rule that a hold defers DESTRUCTION and nothing
-- else: publication is untouched, and hiding stays instant for the member. That
-- rule is right, and it stays, because reporting must never become a way to
-- unpublish someone.
--
-- Quarantine is a different thing wearing the same table. Two cases produce it:
--
--   * a CSAM hash match (`source = 'csam'`), and
--   * an operator ESCALATION, which preserves an item for a legal process.
--
-- For those, "accessible to nobody in normal operation" is the requirement, and
-- continuing to serve the content publicly while it is preserved as evidence is
-- indefensible. So a quarantine withholds as well as defers.
--
-- WHY THIS IS NOT ENOUGH ON ITS OWN, and why the code moves the bytes too: the
-- admin console mounts the whole media tree by path. Withholding a row from the
-- publish views stops the PUBLIC media route serving it, because that route is
-- derived from `published_messages`, but it does nothing about a raw path fetch.
-- Segregation that exists only in the database is not segregation. See
-- `src/media/quarantine.ts`, which moves the files out of `MEDIA_ROOT` entirely,
-- and the id-resolving admin route that replaced the static mount.
--
-- `CREATE OR REPLACE` again: only a predicate changes, the column list does not,
-- so the long explicit `published_messages` projection is left alone.

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
      -- QUARANTINE. Applies to her rows as well as members', which is why it sits
      -- outside the bot/member CASE: a hash match on something she posted is
      -- exactly as unservable as one on a member's photograph.
      AND NOT EXISTS (
        SELECT 1 FROM evidence_holds h
        WHERE h.message_id = m.id
          AND (h.source = 'csam' OR h.state = 'escalated')
          AND h.state IN ('active', 'escalated')
      )
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
          -- CCB-S3-013: said while hidden, so never consented to (migration 021).
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

-- The quarantine lookup runs for every row of every public read, so it gets its
-- own index rather than relying on the one-live-hold partial index.
CREATE INDEX evidence_holds_quarantine_idx
  ON evidence_holds (message_id)
  WHERE state IN ('active', 'escalated') AND (source = 'csam' OR state = 'escalated');
