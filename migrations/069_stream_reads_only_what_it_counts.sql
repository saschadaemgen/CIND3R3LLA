-- The stream stops reading everything to count anything (CCB-S5-051, D-236).
--
-- ── WHAT WAS MEASURED, ON HIS DATA ──────────────────────────────────────────
--
-- 5,186 messages, 1,856 published. The page took ten seconds. The archive is 3,312 kB of
-- heap and 207 MB of TOAST, all of it `raw_json` at 39 KB a row.
--
--     count(*)                      listPublishedItems      2,323 ms
--     channel list                  listPublishedChannels   2,440 ms
--     id hash                       listPublishedIds        2,039 ms
--     page of 20                                              520 ms
--     latest image id                                         203 ms
--
-- ── TWO FAULTS, NOT ONE, AND THE LARGER WAS THE HIDDEN ONE ──────────────────
--
-- ONE: THE REPLY CHAIN, ~1.5 s. `message_publish_state` held a CTE that referenced
-- ITSELF - a reply publishes only when its parent does, expressed as
-- `EXISTS (SELECT 1 FROM base q WHERE q.id = base.reply_to_id AND q.self_published)`.
-- Because `base` is referenced twice Postgres materialises it and compiles the EXISTS into
-- a HASHED SubPlan, which must be built in full before the outer scan can emit its first
-- row. That is why the plan showed a Seq Scan with 1,362 ms of STARTUP and 8 ms of
-- scanning, every buffer a cache hit and no I/O: the time was never the scan.
--
-- Measured in isolation, and this is the whole absurdity in one number: computing
-- `self_published` for all 5,188 rows costs 104 ms. Adding the chain check costs 1,750 ms.
-- It is paid for 493 rows: only 1,304 messages have a `reply_to_id` at all.
--
-- The repair evaluates the chain only where there is a parent to check, as an explicit
-- LEFT JOIN rather than a self-referencing subquery. Measured 1,478 ms -> 139 ms, and the
-- published set is IDENTICAL: 1,857 rows both ways, zero lost, zero gained, proven by
-- EXCEPT in both directions on his data before this was written.
--
-- TWO: THE CONTENT VIEW, ~600 ms. `published_messages` answers two different questions -
-- which messages are public, AND what they say - and the expensive one wins. Its
-- `formatted` column reads `raw_json -> 'chatItem' -> 'formattedText'`, so a query that
-- wants a single number pays to detoast 207 MB it discards. Proven directly:
-- `count(*)` over messages is 4.6 ms, `sum(length(raw_json::text))` is 2,275 ms, and
-- `sum(length(text_body))` is 18 ms. One column is the entire cost.
--
-- `published_message_index` is the split: publication plus the columns a filter needs
-- (type, sent_at, the channel's public id, the search vector) and NOT ONE content column.
-- `published_messages` is unchanged and stays what it is, the answer to "what does it
-- say", asked only for the twenty rows on screen.
--
-- ── THIS IS NOT A RECENT REGRESSION, AND HE SHOULD KNOW THAT ────────────────
--
-- `formatted` arrived with migration 019 and the reply chain is older still. Nothing in
-- the channel work caused this. What changed is that the archive grew until the fault
-- hurt, and the channel work added a third O(total) query on top of the two already
-- there. The same shape will bite again as the archive grows, which is why
-- `verify:cheap-queries` now exists rather than a convention.

-- ── THE REPLY CHAIN, EVALUATED ONLY WHERE THERE IS A PARENT ─────────────────
--
-- Column list, names, types and order are unchanged, so this REPLACES in place and
-- `published_messages` keeps working without being dropped.
--
-- COALESCE(p.self_published, false) reproduces the EXISTS exactly: no parent row and a
-- parent that is not itself published both yield false, which is what
-- `EXISTS (...) = false` meant. A reply whose parent is absent stays unpublished.
CREATE OR REPLACE VIEW message_publish_state AS
 WITH base AS (
         SELECT m.id,
            m.group_id,
            m.group_msg_id,
            m.sender_member_id,
            m.sent_at,
            m.is_bot,
            m.bot_category,
            m.reply_to_id,
            m.deleted = false AND m.group_deleted = false AND m.moderation_state <> 'rejected'::moderation_state AND NOT (EXISTS ( SELECT 1
                   FROM evidence_holds h
                  WHERE h.message_id = m.id AND (h.source = 'csam'::text OR h.state = 'escalated'::text) AND (h.state = ANY (ARRAY['active'::text, 'escalated'::text])))) AND (NOT m.is_bot OR m.mentions_scanned AND (b.mention_guard <> 'withhold'::text OR NOT (EXISTS ( SELECT 1
                   FROM message_mentions mm
                     LEFT JOIN consent mc ON mc.member_id = mm.member_id
                  WHERE mm.message_id = m.id AND (mm.member_id IS NULL OR mc.member_id IS NULL OR mc.revoked_at IS NOT NULL))))) AND
                CASE
                    WHEN m.is_bot AND m.bot_category = 'bridge'::text THEN m.bridge_channel_key IS NOT NULL AND (EXISTS ( SELECT 1
                       FROM cinderella_bridge_channel_publication p
                      WHERE p.channel_key = m.bridge_channel_key AND p.publish))
                    WHEN m.is_bot THEN b.publish_bot AND m.bot_category IS NOT NULL AND (b.categories -> m.bot_category) = 'true'::jsonb
                    ELSE c.member_id IS NOT NULL AND c.revoked_at IS NULL AND m.sent_at >= c.opted_in_at AND (m.member_category IS NULL OR (mp.categories -> m.member_category) = 'true'::jsonb) AND NOT (EXISTS ( SELECT 1
                       FROM consent_gaps g
                      WHERE g.member_id = m.sender_member_id AND m.sent_at >= g.gap_start AND m.sent_at < g.gap_end))
                END AS self_published,
            NOT m.is_bot OR m.bot_category IS DISTINCT FROM 'bridge'::text OR (b.categories -> 'bridge'::text) = 'true'::jsonb AS in_stream
           FROM messages m
             LEFT JOIN consent c ON c.member_id = m.sender_member_id
             CROSS JOIN bot_publish_settings b
             CROSS JOIN member_publish_settings mp
        )
 SELECT b.id,
    b.group_id,
    b.group_msg_id,
    b.sender_member_id,
    b.sent_at,
    b.self_published AND (b.reply_to_id IS NULL OR COALESCE(p.self_published, false)) AS published,
    b.in_stream
   FROM base b
     LEFT JOIN base p ON p.id = b.reply_to_id;

-- ── THE INDEX: PUBLICATION AND FILTERS, NO CONTENT ──────────────────────────
--
-- Every column here is one a WHERE clause or an ORDER BY needs. There is deliberately no
-- `formatted`, no `text_body`, no mention rewriting and no persona lookup: a count, a
-- hash and a distinct list need none of them, and reading them is what cost the seconds.
--
-- `search` carries the SAME anonymisation branch the content view applies, so a visitor's
-- full-text filter matches exactly what it matched before. It is a view column, so it is
-- computed only when a query references it - a count with no query string never touches it.
--
-- `bridge_channel_public_id` needs the publication lateral because the public id lives on
-- the publication record rather than on the message; that lateral reads two small columns
-- of a table with one row per channel.
CREATE VIEW published_message_index AS
SELECT m.id,
       m.group_id,
       m.group_msg_id,
       m.sent_at,
       m.type,
       m.media_path,
       m.is_bot,
       m.member_category,
       s.in_stream,
       pub.public_id AS bridge_channel_public_id,
       CASE
           WHEN COALESCE(pub.anonymise, false)
                AND m.bridge_channel_name IS NOT NULL
                AND m.bridge_channel_name <> ''::text
           THEN NULL::text
           ELSE m.bridge_channel_name
       END AS bridge_channel_name,
       CASE
           WHEN COALESCE(pub.anonymise, false)
                AND m.bridge_channel_name IS NOT NULL
                AND m.bridge_channel_name <> ''::text
           THEN NULL::tsvector
           ELSE m.search
       END AS search
  FROM messages m
  JOIN message_publish_state s ON s.id = m.id
  LEFT JOIN LATERAL ( SELECT p.public_id, p.anonymise
                        FROM cinderella_bridge_channel_publication p
                       WHERE p.channel_key = m.bridge_channel_key ) pub
         ON m.bridge_channel_key IS NOT NULL
 WHERE s.published;

COMMENT ON VIEW published_message_index IS
  'Publication plus the columns a filter needs, and no content column (CCB-S5-051, D-236). '
  'Counts, hashes and distinct lists read THIS; published_messages answers what a message '
  'says and is asked only for the rows on screen. verify:cheap-queries enforces the split.';
