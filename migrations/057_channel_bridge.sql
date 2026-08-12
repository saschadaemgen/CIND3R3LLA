-- 057: the channel bridge (CCB-S5-032, D-187).
--
-- A SimpleX channel post becomes a standing announcement the bot brings into a
-- group on a cadence. Five tables and one view replacement.
--
-- ── WHY A CHANNEL POST IS NOT A MESSAGE ROW ─────────────────────────────────
--
-- A channel item arrives with direction `channelRcv`, which carries NO member:
-- no memberId, no display name, no role. The whole consent machinery is keyed
-- per member, so a channel post CANNOT travel the consent path, and putting it
-- into `messages` would give it publication semantics nothing can govern. It
-- gets its own table, with no path to `published_messages`. What CAN publish is
-- the bot's own forwarded ANNOUNCEMENT, which is her message like any other,
-- captured under the new 'bridge' category - excluded by default, below.
--
-- ── WHAT IS DELIBERATELY ABSENT ─────────────────────────────────────────────
--
-- No `cinderella_plugin_overrides` change: its CHECK constrains `setting_key`
-- only ('enabled'), and plugin_id is free text, so a new plugin's per-bot
-- switch needs no schema change (the knowledge base proved this in 052).

-- ── THE CHANNELS A BOT KNOWS ────────────────────────────────────────────────
--
-- One row per (bot, source group) the bot has seen behave as a channel: filled
-- by the intake when a `channelRcv` item arrives, and by the console's connect
-- action when the core reports a joined group's type. A mapping's source must
-- reference a row here, which makes "the source is a channel" STRUCTURAL: the
-- loop guard's kind check cannot be bypassed by saving a mapping directly.
--
-- `link` is nullable because the core does not always retain `viaGroupLinkUri`;
-- when present it is what makes the structured origin's channelKey portable
-- (two deployments derive the same key from the same link).
CREATE TABLE cinderella_bridge_channels (
  bot_profile_id  BIGINT      NOT NULL REFERENCES cinderella_bot_profiles (id) ON DELETE CASCADE,
  source_group_id BIGINT      NOT NULL,
  channel_name    TEXT        NOT NULL,
  link            TEXT,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_post_at    TIMESTAMPTZ,
  PRIMARY KEY (bot_profile_id, source_group_id)
);

-- ── THE MAPPINGS ────────────────────────────────────────────────────────────
--
-- Many to many by construction: a channel can feed several groups and a group
-- can receive from several channels, each pair its own row with its own cadence,
-- switchable without deletion (`enabled`).
--
-- The trigger CHECK makes a mapping that can never fire unrepresentable: at
-- least one of the two cadence triggers must be set. "Whichever comes first"
-- is the composition (cadence.ts states why).
CREATE TABLE cinderella_bridge_mappings (
  id               BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bot_profile_id   BIGINT      NOT NULL,
  source_group_id  BIGINT      NOT NULL,
  dest_group_id    BIGINT      NOT NULL,
  enabled          BOOLEAN     NOT NULL DEFAULT TRUE,
  interval_minutes INTEGER,
  message_count    INTEGER,
  max_age_hours    INTEGER     NOT NULL DEFAULT 24,
  max_repeats      INTEGER     NOT NULL DEFAULT 3,
  last_sent_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The source must be a KNOWN CHANNEL of this bot; deleting the channel row
  -- takes its mappings with it.
  FOREIGN KEY (bot_profile_id, source_group_id)
    REFERENCES cinderella_bridge_channels (bot_profile_id, source_group_id) ON DELETE CASCADE,
  CONSTRAINT cinderella_bridge_mappings_unique
    UNIQUE (bot_profile_id, source_group_id, dest_group_id),
  CONSTRAINT cinderella_bridge_mappings_trigger_check
    CHECK (interval_minutes IS NOT NULL OR message_count IS NOT NULL),
  CONSTRAINT cinderella_bridge_mappings_not_self
    CHECK (source_group_id <> dest_group_id),
  CONSTRAINT cinderella_bridge_mappings_bounds CHECK (
    (interval_minutes IS NULL OR interval_minutes BETWEEN 1 AND 10080)
    AND (message_count IS NULL OR message_count BETWEEN 1 AND 10000)
    AND max_age_hours BETWEEN 1 AND 720
    AND max_repeats BETWEEN 1 AND 50
  )
);

-- ── THE POSTS ───────────────────────────────────────────────────────────────
--
-- One row per channel post the intake saw, keyed by the source's SHARED message
-- id where the wire supplied one, so an edit or a deletion finds its copy and a
-- repeated announcement is recognisably the same post rather than a new one.
-- `item_id` is kept beside it because the `groupChatItemsDeleted` event carries
-- bare numeric item ids and nothing else.
--
-- `resolution` is the post's terminal state, and the CHECK makes a half-resolved
-- row unrepresentable (the migration-032 lesson: a row claiming neither success
-- nor failure is a row nobody can read). 'completed' means announced at least
-- once and stopped, which is the feature working; the other three stopped a post
-- that was never shown, and each of those writes a suppression row below.
CREATE TABLE cinderella_bridge_posts (
  id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bot_profile_id  BIGINT      NOT NULL,
  source_group_id BIGINT      NOT NULL,
  shared_msg_id   TEXT,
  item_id         BIGINT      NOT NULL,
  text_body       TEXT        NOT NULL,
  posted_at       TIMESTAMPTZ NOT NULL,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at       TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  repeats_done    INTEGER     NOT NULL DEFAULT 0,
  dismissed_at    TIMESTAMPTZ,
  resolution      TEXT,
  resolved_at     TIMESTAMPTZ,
  -- Media: the bytes live under BRIDGE_MEDIA_ROOT (never in the DB, never under
  -- MEDIA_ROOT - the destruction sweeper walks that whole tree); the row holds
  -- the path and an honest state. 'too-large' and 'failed' are states a member
  -- can see explained on the console, never silent gaps.
  media_path      TEXT,
  media_mime      TEXT,
  media_size      BIGINT,
  media_state     TEXT        NOT NULL DEFAULT 'none',
  media_error     TEXT,
  FOREIGN KEY (bot_profile_id, source_group_id)
    REFERENCES cinderella_bridge_channels (bot_profile_id, source_group_id) ON DELETE CASCADE,
  CONSTRAINT cinderella_bridge_posts_shared_unique
    UNIQUE (bot_profile_id, source_group_id, shared_msg_id),
  CONSTRAINT cinderella_bridge_posts_item_unique
    UNIQUE (bot_profile_id, source_group_id, item_id),
  CONSTRAINT cinderella_bridge_posts_resolution_check
    CHECK (resolution IN ('completed', 'aged-out', 'dismissed', 'loop-refused')),
  CONSTRAINT cinderella_bridge_posts_resolved_pair_check
    CHECK ((resolution IS NULL) = (resolved_at IS NULL)),
  CONSTRAINT cinderella_bridge_posts_media_state_check
    CHECK (media_state IN ('none', 'pending', 'stored', 'failed', 'too-large'))
);

CREATE INDEX cinderella_bridge_posts_pending_idx
  ON cinderella_bridge_posts (bot_profile_id, source_group_id)
  WHERE resolution IS NULL;

-- ── THE FORWARD LOG ─────────────────────────────────────────────────────────
--
-- One row per post per announcement (or per propagation act). This is the log
-- the console filters by channel, by destination and by time - the same
-- question the website's activity stream will ask, which is why `origin` is
-- STRUCTURED (jsonb, shape in src/plugins/channel-bridge/origin.ts) rather
-- than a rendered sentence: a rendered line cannot be filtered.
--
--   kind 'featured'    the post was the digest's full rendering
--   kind 'summarized'  the post rode along as an excerpt line
--   kind 'edit'        a source edit was propagated into the sent message
--   kind 'withdrawal'  the copy was removed because the source post was deleted
--
-- `sent_item_id` / `sent_shared_msg_id` identify HER sent message in the dest
-- group: the first is what edit and deletion propagation act through, the
-- second is the loop guard's readback (an arriving channel post whose shared id
-- matches a recorded send is the bridge's own product). `message_id` links the
-- archived bot row so a later consumer can join the public archive - nullable,
-- because archiving her side must never block the forward.
CREATE TABLE cinderella_bridge_forwards (
  id                 BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mapping_id         BIGINT      NOT NULL REFERENCES cinderella_bridge_mappings (id) ON DELETE CASCADE,
  post_id            BIGINT      NOT NULL REFERENCES cinderella_bridge_posts (id) ON DELETE CASCADE,
  kind               TEXT        NOT NULL,
  sent_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_item_id       BIGINT,
  sent_shared_msg_id TEXT,
  origin             JSONB       NOT NULL,
  message_id         BIGINT      REFERENCES messages (id) ON DELETE SET NULL,
  CONSTRAINT cinderella_bridge_forwards_kind_check
    CHECK (kind IN ('featured', 'summarized', 'edit', 'withdrawal'))
);

CREATE INDEX cinderella_bridge_forwards_mapping_idx
  ON cinderella_bridge_forwards (mapping_id, sent_at DESC);
CREATE INDEX cinderella_bridge_forwards_post_idx
  ON cinderella_bridge_forwards (post_id);
-- The console's channel filter reads the structured field, which is the proof
-- the field is fit before the site depends on it.
CREATE INDEX cinderella_bridge_forwards_channel_idx
  ON cinderella_bridge_forwards ((origin ->> 'channelKey'), sent_at DESC);

-- ── THE SUPPRESSION RECORD ──────────────────────────────────────────────────
--
-- "Never suppress a post silently" is the briefing's bar, so a post that stops
-- with ZERO announcements writes a row here, and `verify:bridge` proves a
-- suppression cannot happen without one. `mapping_id` is null for
-- 'loop-refused', which happens at intake before any mapping is consulted.
CREATE TABLE cinderella_bridge_suppressions (
  id         BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mapping_id BIGINT      REFERENCES cinderella_bridge_mappings (id) ON DELETE CASCADE,
  post_id    BIGINT      NOT NULL REFERENCES cinderella_bridge_posts (id) ON DELETE CASCADE,
  reason     TEXT        NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cinderella_bridge_suppressions_reason_check
    CHECK (reason IN ('aged-out', 'dismissed', 'loop-refused'))
);

CREATE INDEX cinderella_bridge_suppressions_at_idx
  ON cinderella_bridge_suppressions (at DESC);

-- ── THE PUBLICATION CATEGORY (the 013/027/033 pattern) ──────────────────────
--
-- Her forwarded announcements are captured as bot rows under bot_category
-- 'bridge'. The category ships EXCLUDED from publication: channel content
-- carries no member consent semantics of its own, and whether the operator's
-- announcements belong on the public archive is his switch to flip, on the
-- Archive page, the day the site work wants them.
--
-- These category defaults MUST match DEFAULT_ARCHIVE in
-- src/archive/settings.ts; verify:archive compares the two and fails if they
-- drift (which is exactly how 027 and 033 were each caught).
-- Copied from 033 verbatim with ONE key added, including its expression forms:
-- the boolean is a JSON comparison rather than a cast, because a cast can RAISE
-- and take the archive down with it.
CREATE OR REPLACE VIEW bot_publish_settings AS
SELECT
  CASE
    WHEN v -> 'publishBotMessages' IS NULL THEN TRUE
    ELSE v -> 'publishBotMessages' = 'true'::jsonb
  END AS publish_bot,
  CASE
    WHEN v ->> 'mentionGuard' = 'withhold' THEN 'withhold'
    ELSE 'redact'
  END AS mention_guard,
  -- These MUST match DEFAULT_ARCHIVE in src/archive/settings.ts; the
  -- admin-views harness compares the two and fails if they drift.
  '{"consent": true,  "price": true,
    "search": false, "status": false, "help": false,
    "notUnderstood": false, "nickname": false, "disambiguation": false,
    "conversation": false, "lookup": false, "bridge": false}'::jsonb
    || CASE
         WHEN jsonb_typeof(v -> 'categories') = 'object' THEN v -> 'categories'
         ELSE '{}'::jsonb
       END AS categories
FROM (SELECT (SELECT value FROM settings WHERE key = 'archive') AS v) t;
