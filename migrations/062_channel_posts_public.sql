-- 062: channel posts on the website (CCB-S5-043, D-215).
--
-- Her bridged channel announcements become publishable: in the activity stream
-- beside members' messages, and separately as a block of its own a site can
-- embed without the stream. Two audiences, two promises, so two surfaces over
-- ONE set of records.
--
-- ── PART 1: THE ORIGIN MOVES ONTO THE ARCHIVED RECORD ───────────────────────
--
-- The structured origin has lived only on `cinderella_bridge_forwards`, which is
-- OPERATIONAL state with its own lifecycle: `deleteBridgeChannel` (the Capture
-- page's Clear record, D-204) cascades channels -> mappings -> forwards. So
-- clearing a channel record would strip a PUBLISHED item of its provenance while
-- it was still online and readable, and the page would go on serving an
-- announcement nobody could attribute.
--
-- That is the D-205 shape exactly: a public claim derived from a table a console
-- action can remove. The claim moves onto the record it is a claim about. From
-- here `messages.bridge_channel_key` / `bridge_channel_name` are written at
-- INSERT, in the same statement as the announcement itself, and no console
-- action can take them away.
--
-- `channelKey` rather than the group id, for the reason `origin.ts` already
-- states in full: the core's numeric group id is local to one profile and a
-- rejoin gives the same room a new one, while the key is derived from the
-- channel's LINK and therefore survives both a rejoin and a rename.
--
-- ── PART 2: PUBLICATION IS KEYED ON THE CHANNEL, NOT ON THE CHANNEL RECORD ──
--
-- `cinderella_bridge_channel_publication` is keyed on `channel_key` and has NO
-- foreign key to `cinderella_bridge_channels`. That is deliberate and it is the
-- same argument as Part 1 one step further out: if the operator's decision to
-- publish a channel hung off the operational record, then clearing that record
-- (or a rejoin replacing it) would silently unpublish a live public block. Keyed
-- on what the channel IS, one rejoin later the same link yields the same key and
-- the same decision still stands.
--
-- The consequence is stated rather than discovered: a publication row OUTLIVES
-- the channel record, so an operator who clears a channel and never bridges it
-- again keeps a row saying "published". Its posts stay published, which is the
-- honest reading of "I published these", and the console lists such a row as
-- orphaned so it can be switched off.
--
-- ── ONE SWITCH DECIDES PUBLICATION, AND `categories.bridge` IS NOT IT ───────
--
-- Migration 057 shipped the 'bridge' publication category excluded, saying the
-- decision was the operator's "the day the site work wants them". That day is
-- this briefing, and the answer turned out not to be one deployment-wide switch:
-- he wants one channel public and another private, which a category cannot say.
--
-- So publication is decided by the PER-CHANNEL switch alone, and `publish_bot`
-- is deliberately NOT in that chain: "do not publish her replies" is a statement
-- about her conversation, and an announcement is the operator's own text that she
-- only carried. A second master switch here would reproduce the defect this
-- repository has bled over most (D-162, D-201): a control that is pressed and
-- appears to do nothing.
--
-- `categories.bridge` keeps a real job, and it is the briefing's own
-- distinction: it decides whether published announcements ALSO appear in the
-- community activity stream, beside members' messages. That is the `in_stream`
-- column below. Publication and stream visibility are two questions and both
-- controls are live; neither is a duplicate of the other.
--
-- ── WHAT THE BACKFILL CANNOT RECOVER, AND WHERE IT SAYS SO ──────────────────
--
-- The only surviving source of a past announcement's origin is
-- `cinderella_bridge_forwards.origin`. Where a forward row has already been
-- cascaded away - the channel cleared, the mapping deleted - that provenance is
-- gone and cannot be reconstructed from anything, because the local group id it
-- would have to start from is exactly what does not survive.
--
-- Such a row keeps both columns NULL, which means it can never publish (the
-- predicate below requires a key), so the failure direction is closed rather
-- than open. The COUNT is reported live on the Bridge console, derived from the
-- rows themselves rather than stored: a `RAISE NOTICE` here would scroll past in
-- a deploy log and be gone, and a stored number would be a second source that
-- goes stale. See `countBridgeMessagesWithoutOrigin`.
--
-- ── WHAT THIS MIGRATION NEEDS FROM THE SERVER, SAID BECAUSE PGLITE HIDES IT ──
--
-- NO EXTENSION and NO SUPERUSER. `sha256()` (PG11+), `convert_to()` and
-- `gen_random_uuid()` (PG13+) are all core built-ins, so this needs exactly the
-- table, index and view privileges the application role has already used 61
-- times. That is worth stating rather than assuming: PGlite runs as a superuser
-- with everything available, which is precisely what hid migration 052's
-- `permission denied to create extension vector` until it reached the host
-- (D-178). Production is PostgreSQL 17, comfortably past both floors.

/* ── the origin on the archived record ─────────────────────────────────────── */

ALTER TABLE messages
  ADD COLUMN bridge_channel_key  TEXT,
  ADD COLUMN bridge_channel_name TEXT;

-- A half-filled pair is unrepresentable (the migration-032 rule: a row that
-- claims neither one thing nor the other is a row nobody can read). The key is
-- what publication and filtering are derived from; the name is what renders.
ALTER TABLE messages
  ADD CONSTRAINT messages_bridge_origin_pair_check
    CHECK ((bridge_channel_key IS NULL) = (bridge_channel_name IS NULL));

-- ONLY a bridge row may wear a channel origin. A member's message carrying one
-- would be a member message published under an operator's channel switch, which
-- is the one thing the two surfaces must never be able to do to each other.
ALTER TABLE messages
  ADD CONSTRAINT messages_bridge_origin_only_bridge_check
    CHECK (
      bridge_channel_key IS NULL
      OR (is_bot AND bot_category = 'bridge')
    );

-- The standalone block's whole query, and the stream's channel filter.
CREATE INDEX messages_bridge_channel_idx
  ON messages (bridge_channel_key, sent_at DESC)
  WHERE bridge_channel_key IS NOT NULL;

/* ── the key on the operational channel record ─────────────────────────────── */
--
-- Written by `upsertBridgeChannel` from `channelKeyFor`, which stays the ONE
-- authority for the derivation: the console needs to get from a channel the bot
-- knows to that channel's publication row, and deriving it a second time in a
-- view would be two answers to one question with the drift running in the worst
-- direction (a published block silently emptying).
--
-- The backfill below is the one place SQL derives it, because the TypeScript has
-- never run over these rows. The two derivations are asserted IDENTICAL by
-- `verify:bridge` over a real link and a link-less channel, and that check can go
-- red - so this expression is proven rather than assumed.
--
-- Not unique: two bots subscribed to one channel hold two records with the same
-- key, which is the reason publication is keyed on the key rather than on either
-- record.

ALTER TABLE cinderella_bridge_channels ADD COLUMN channel_key TEXT;

UPDATE cinderella_bridge_channels c
   SET channel_key = CASE
     WHEN c.link IS NOT NULL AND btrim(c.link) <> ''
       THEN 'link:' || substr(encode(sha256(convert_to(btrim(c.link), 'UTF8')), 'hex'), 1, 16)
     ELSE 'local:' || c.bot_profile_id || ':' || c.source_group_id
   END;

ALTER TABLE cinderella_bridge_channels ALTER COLUMN channel_key SET NOT NULL;

CREATE INDEX cinderella_bridge_channels_key_idx
  ON cinderella_bridge_channels (channel_key);

/* ── the backfill of the archived records ──────────────────────────────────── */
--
-- `DISTINCT ON (message_id)` with 'featured' preferred: one sent message can
-- carry several posts (a digest), every one of them from the SAME mapping and
-- therefore the same source channel, so any of its forward rows answers - but the
-- featured row is the one whose post the message leads with, and preferring it
-- keeps the choice deterministic rather than incidental.

UPDATE messages m
   SET bridge_channel_key  = f.channel_key,
       bridge_channel_name = f.channel_name
  FROM (
    SELECT DISTINCT ON (message_id)
           message_id,
           origin ->> 'channelKey'  AS channel_key,
           origin ->> 'channelName' AS channel_name
      FROM cinderella_bridge_forwards
     WHERE message_id IS NOT NULL
       AND origin ->> 'channelKey'  IS NOT NULL
       AND origin ->> 'channelKey'  <> ''
       AND origin ->> 'channelName' IS NOT NULL
       AND origin ->> 'channelName' <> ''
     ORDER BY message_id,
              CASE kind WHEN 'featured' THEN 0 ELSE 1 END,
              sent_at
  ) f
 WHERE m.id = f.message_id
   AND m.is_bot
   AND m.bot_category = 'bridge';

/* ── the publication record ────────────────────────────────────────────────── */
--
-- `public_id` is the identifier the PUBLIC surfaces expose, and it is random
-- rather than derived. `channel_key` is `link:<sha256 of the join link>`, and for
-- a channel whose link is public - which a bridged channel's is - anybody holding
-- that link can recompute the key and confirm which channel an "anonymised" post
-- came from. An anonymised channel that is still identifiable by its identifier
-- is not anonymised, so the two identities are separate: the key is operational,
-- the public id is publishable.
--
-- Minted in TypeScript for new rows (`randomBytes(12).toString('base64url')`);
-- the seeds below mint theirs from `gen_random_uuid()`, which the CHECK accepts
-- as the same alphabet.
--
-- ALLOW-LIST, not a deny-list (D-201): the CHECK states the characters a public
-- id may contain, so anything else is refused rather than admitted. This value
-- lands in URLs and in an embed snippet, and both are places a surprising byte
-- costs more than a refusal.

CREATE TABLE cinderella_bridge_channel_publication (
  channel_key  TEXT        PRIMARY KEY,
  public_id    TEXT        NOT NULL UNIQUE,
  -- The name as last seen, so the console can still say WHAT a switch acts on
  -- after the channel record itself has been cleared.
  channel_name TEXT        NOT NULL,
  -- OFF by default. Nothing this system holds becomes public because a migration
  -- ran; that is the one rule.
  publish      BOOLEAN     NOT NULL DEFAULT FALSE,
  -- OFF by default, because naming the source is the honest state and is the
  -- reason the origin is structured at all.
  anonymise    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   TEXT,
  CONSTRAINT cinderella_bridge_channel_publication_public_id_check
    CHECK (public_id ~ '^[A-Za-z0-9_-]{16,64}$')
);

CREATE INDEX cinderella_bridge_channel_publication_public_idx
  ON cinderella_bridge_channel_publication (public_id)
  WHERE publish;

-- One row per channel the deployment knows about, from BOTH directions: the
-- channels a bot currently holds, and the keys that survive only on archived
-- announcements whose channel record is already gone. The second half is what
-- gives the operator a switch for content that is already in his archive.
INSERT INTO cinderella_bridge_channel_publication (channel_key, public_id, channel_name)
SELECT DISTINCT ON (c.channel_key)
       c.channel_key,
       replace(gen_random_uuid()::text, '-', ''),
       c.channel_name
  FROM cinderella_bridge_channels c
 ORDER BY c.channel_key, c.first_seen_at
ON CONFLICT (channel_key) DO NOTHING;

INSERT INTO cinderella_bridge_channel_publication (channel_key, public_id, channel_name)
SELECT DISTINCT ON (m.bridge_channel_key)
       m.bridge_channel_key,
       replace(gen_random_uuid()::text, '-', ''),
       m.bridge_channel_name
  FROM messages m
 WHERE m.bridge_channel_key IS NOT NULL
 ORDER BY m.bridge_channel_key, m.sent_at DESC
ON CONFLICT (channel_key) DO NOTHING;

/* ── the views ─────────────────────────────────────────────────────────────── */
--
-- Both are dropped and recreated rather than replaced: `message_publish_state`
-- gains an output column (`in_stream`), which `CREATE OR REPLACE` cannot do, and
-- `published_messages` depends on it. Migration 015 did the same for the same
-- reason.

DROP VIEW published_messages;
DROP VIEW message_publish_state;

-- Migration 022's derivation, with three changes and nothing else:
--
--   1. The bot MENTION GUARD moves out of the CASE. It applied to every bot row
--      already; hoisting it means the new bridge branch inherits it instead of
--      restating the subquery, so a bridge row that somehow carried a mention of
--      a non-consenting member is withheld exactly as one of her replies is.
--   2. A bridge row consults the per-channel switch, and only that.
--   3. `in_stream` is emitted beside `published`.
CREATE VIEW message_publish_state AS
WITH base AS (
  SELECT
    m.id,
    m.group_id,
    m.group_msg_id,
    m.sender_member_id,
    m.sent_at,
    m.is_bot,
    m.bot_category,
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
      -- THE MENTION GUARD, for every row of hers whatever its category.
      AND (
        NOT m.is_bot
        OR (
          m.mentions_scanned
          AND (b.mention_guard <> 'withhold' OR NOT EXISTS (
                SELECT 1
                FROM message_mentions mm
                LEFT JOIN consent mc ON mc.member_id = mm.member_id
                WHERE mm.message_id = m.id
                  AND (mm.member_id IS NULL OR mc.member_id IS NULL OR mc.revoked_at IS NOT NULL)
              ))
        )
      )
      AND CASE
        -- A CHANNEL ANNOUNCEMENT: the per-channel switch, and nothing else.
        -- No `publish_bot`, no category: see the header. A row with no origin can
        -- never publish, which is where an unrecoverable backfill lands.
        WHEN m.is_bot AND m.bot_category = 'bridge' THEN
          m.bridge_channel_key IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM cinderella_bridge_channel_publication p
            WHERE p.channel_key = m.bridge_channel_key
              AND p.publish
          )
        WHEN m.is_bot THEN
          b.publish_bot
          AND m.bot_category IS NOT NULL
          AND b.categories -> m.bot_category = 'true'::jsonb
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
    ) AS self_published,
    -- WHETHER A PUBLISHED ROW BELONGS IN THE COMMUNITY STREAM.
    --
    -- True for everything that is not a channel announcement, so the members'
    -- half of the stream is untouched by any of this. For an announcement it is
    -- `categories.bridge`, which is the operator's answer to "do my announcements
    -- belong beside what my members said". The standalone block ignores it: that
    -- block IS the announcements, and filtering it by a stream setting would make
    -- the block empty for the default deployment with nothing saying why.
    --
    -- `IS DISTINCT FROM` rather than `<>`, and the reason is three-valued logic:
    -- `bot_category` is nullable, so `NOT (is_bot AND bot_category = 'bridge')`
    -- evaluates to NULL for one of her rows that no handler classified, and a
    -- NULL here would reach the stream's `WHERE m.in_stream` and quietly exclude
    -- the row. Such a row does not publish anyway (the bot branch above requires
    -- a category), so nothing is broken today - which is exactly why it would sit
    -- there unnoticed until something else changed. Total by construction instead.
    (
      NOT m.is_bot
      OR m.bot_category IS DISTINCT FROM 'bridge'
      OR b.categories -> 'bridge' = 'true'::jsonb
    ) AS in_stream
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
  ) AS published,
  base.in_stream
FROM base;

-- Migration 019's projection, with the channel origin added and ANONYMISATION
-- applied here rather than in a renderer.
--
-- ── WHY THE VIEW AND NOT THE FRONT ──────────────────────────────────────────
--
-- The same reason the quarantine moves files rather than hiding rows: redaction
-- that exists only in a renderer is not redaction. Every public read in this
-- codebase goes through this view, so this is the only place that can promise it.
--
-- ── WHAT ANONYMISATION TOUCHES, AND WHAT IT MUST NOT MISS ───────────────────
--
-- The channel's name is not only a column: the application's own attribution line
-- ("📣 From the channel {channel}, {when}") is part of the announcement TEXT, and
-- so is a digest's remainder line. Hiding the column and leaving the text would
-- be a switch that changes a label and nothing a reader sees. So four things move
-- together, and every one of them is a place the name would otherwise survive:
--
--   text_body       the name replaced by the persona's own placeholder
--   search_body     the same, because this is what the visitor's search reads
--   search          NULL, because the stored tsvector holds the name and cannot
--                   be re-derived per row without losing the GIN index; an
--                   anonymised post is therefore not full-text findable, which is
--                   stated on the console rather than left to be discovered
--   formatted_text  NULL, because the structured runs carry the UNREDACTED text -
--                   exactly the hole migration 019 closed for mention redaction
--
-- `replace()` and not `regexp_replace()`: the channel name is a literal, a
-- literal replacement cannot be defeated by a metacharacter in it, and a rule
-- compiled from data at runtime is how D-164's validation failed open.
CREATE VIEW published_messages AS
SELECT
  m.id,
  m.group_id,
  m.group_msg_id,
  m.shared_msg_id,
  m.sender_member_id,
  m.sender_display_name,
  m.sent_at,
  m.type,
  CASE WHEN anon.hide THEN replace(mr.body, m.bridge_channel_name, anon.placeholder)
       ELSE mr.body END AS text_body,
  -- Structured formatting runs (CCB-S3-025), suppressed to NULL whenever either
  -- redaction could alter the text, so the runs can never carry a redacted name
  -- to the public.
  CASE
    WHEN m.is_bot AND r.pattern IS NOT NULL THEN NULL
    WHEN anon.hide THEN NULL
    WHEN jsonb_typeof(m.raw_json -> 'chatItem' -> 'formattedText') = 'array' THEN (
      SELECT jsonb_agg(
               jsonb_build_object('f', e.value -> 'format' ->> 'type', 't', e.value ->> 'text')
               ORDER BY e.ord
             )
      FROM jsonb_array_elements(m.raw_json -> 'chatItem' -> 'formattedText')
        WITH ORDINALITY AS e(value, ord)
    )
    ELSE NULL
  END AS formatted_text,
  m.links_text,
  m.media_path,
  m.media_mime,
  m.media_size,
  m.media_derived_path,
  m.media_strip_skipped,
  m.deleted,
  m.group_deleted,
  m.moderation_state,
  m.media_error,
  m.captured_at,
  m.is_bot,
  m.bot_category,
  m.member_category,
  m.reply_to_id,
  m.video_provider,
  m.video_id,
  m.video_start,
  m.video_title,
  m.bot_lang,
  CASE WHEN anon.hide THEN replace(m.search_body, m.bridge_channel_name, anon.placeholder)
       ELSE m.search_body END AS search_body,
  CASE WHEN anon.hide THEN NULL ELSE m.search END AS search,
  -- `redacted` now means "either redaction altered this body": a mentioned member's
  -- name, or an anonymised channel's. Nothing reads this column today (it has had no
  -- consumer since migration 019 exposed it), and a future one should know it answers
  -- the general question rather than the mention-only one it used to.
  (m.text_body IS DISTINCT FROM
    CASE WHEN anon.hide THEN replace(mr.body, m.bridge_channel_name, anon.placeholder)
         ELSE mr.body END) AS redacted,
  -- THE CHANNEL ORIGIN, as the public may see it. The public id is present
  -- whether or not the channel is anonymised, because it is what both surfaces
  -- filter and group by and it discloses nothing; the NAME is present only when
  -- the operator has not asked for it to be hidden.
  pub.public_id AS bridge_channel_public_id,
  CASE WHEN anon.hide THEN NULL ELSE m.bridge_channel_name END AS bridge_channel_name,
  s.in_stream
FROM messages m
JOIN message_publish_state s ON s.id = m.id
LEFT JOIN LATERAL (
  SELECT '(?<![[:alnum:]_])(' || string_agg(
           mm.display_pattern,
           '|'
           ORDER BY length(mm.display_pattern) DESC, mm.display_pattern
         ) || ')(?![[:alnum:]_])' AS pattern
  FROM message_mentions mm
  LEFT JOIN consent mc ON mc.member_id = mm.member_id
  WHERE mm.message_id = m.id
    AND mm.display_name <> ''
    AND (mm.member_id IS NULL OR mc.member_id IS NULL OR mc.revoked_at IS NOT NULL)
) r ON m.is_bot
CROSS JOIN (
  SELECT (SELECT value -> 'persona' FROM settings WHERE key = 'interaction') AS persona
) pj
-- The mention-redacted body, computed ONCE. Migration 019 repeated this
-- expression, and anonymisation would have made it three copies of the same
-- twenty lines; a third copy is a third place to forget an edit.
LEFT JOIN LATERAL (
  SELECT CASE
    WHEN m.is_bot AND r.pattern IS NOT NULL AND m.text_body IS NOT NULL
      THEN regexp_replace(
             m.text_body,
             r.pattern,
             replace(
               COALESCE(
                 pj.persona -> m.bot_lang ->> 'redactedMember',
                 pj.persona -> 'en' ->> 'redactedMember',
                 'that member'
               ),
               '\', '\\'
             ),
             'g'
           )
    ELSE m.text_body
  END AS body
) mr ON TRUE
LEFT JOIN LATERAL (
  SELECT p.public_id, p.anonymise
  FROM cinderella_bridge_channel_publication p
  WHERE p.channel_key = m.bridge_channel_key
) pub ON m.bridge_channel_key IS NOT NULL
LEFT JOIN LATERAL (
  SELECT
    COALESCE(pub.anonymise, FALSE)
      AND m.bridge_channel_name IS NOT NULL
      AND m.bridge_channel_name <> '' AS hide,
    COALESCE(
      pj.persona -> m.bot_lang ->> 'bridgeAnonymousChannel',
      pj.persona -> 'en' ->> 'bridgeAnonymousChannel',
      '(not named)'
    ) AS placeholder
) anon ON TRUE
WHERE s.published;
