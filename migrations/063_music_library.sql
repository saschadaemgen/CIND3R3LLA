-- 063: the music library (CCB-S5-044, D-216/D-217).
--
-- Tracks uploaded through the console, stored on disk under MUSIC_ROOT with the
-- database holding the path (the house rule since 001); playlists as the unit
-- of assignment; a cadence per (bot, playlist) assignment reusing the bridge's
-- proven shape; and one plays log that is BOTH the DJ sheet's source and the
-- first profile-class row source this product has.
--
-- ── WHY THE PLAYS LOG IS THE SCHEMA DECISION (D-217) ────────────────────────
--
-- The operator's profile requirement is deletable-in-parts: "delete only my
-- music preferences, and the rest stays". The shape that makes that cheap is
-- decided here, before the first row exists:
--
--   * `member_id` is NULLABLE and is written NULL by every caller this
--     briefing ships. A play is anonymous until the MEMORY work delivers the
--     per-member opt-in, because data accruing before the recital and the
--     deletion exist is the shape this season has paid for repeatedly. What
--     that defers, said plainly: member-linked requests, "play me something I
--     like", and audiobook resume all wait for the memory briefing.
--   * No stored aggregate: "most played", "popular now" and "which tastes" are
--     GROUP BY over these rows at read time, so deleting the rows leaves no
--     ghost of them. The one frozen field is `kind_at_play`, which records what
--     the BUDGET DECISION was taken on (a track's kind is operator-editable
--     later), the sanctions pattern: provenance of a decision, not a profile.
--   * The table is registered in `src/members/data-registry.ts` under category
--     'music', class 'profile', and `verify:member-data` fails if any table
--     with a member-identifying column is missing from that registry.
--
-- ── WHAT IS DELIBERATELY ABSENT ─────────────────────────────────────────────
--
-- No member-upload table: a member's own file is played back without being
-- stored (his decision inherited from the briefing default), so there is
-- nothing to keep. No budget counters: daily caps and gaps are derived from
-- this log per read, like the moderation window. No per-bot columns on
-- settings: the caps and the upload bounds are deployment-wide plugin settings
-- (D-175 question 3 - a safety bound with N values is a bound nobody can
-- state); enablement is per bot through `cinderella_plugin_overrides`, whose
-- CHECK constrains only `setting_key`, so the two new plugin ids need no
-- schema change (the 057 precedent).

-- ── THE TRACKS ──────────────────────────────────────────────────────────────
--
-- `kind` is the only place the library distinguishes music from a documentary,
-- an audiobook or an advertising spot: the send, the cadence and the budget
-- machinery are content-agnostic, and kind is consulted where a human reads it
-- (console labels, the DJ sheet, the archive category) and where the budget
-- class is frozen at play time.
CREATE TABLE cinderella_tracks (
  id               BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind             TEXT        NOT NULL DEFAULT 'music',
  title            TEXT        NOT NULL,
  artist           TEXT,
  genre            TEXT,
  duration_seconds INTEGER,
  file_path        TEXT        NOT NULL,
  file_size        BIGINT      NOT NULL,
  mime             TEXT        NOT NULL,
  -- The cover, extracted from the tag or uploaded separately. Absence is a
  -- normal state that changes the SEND SHAPE (two messages, bare voice player)
  -- rather than an error.
  cover_path       TEXT,
  -- The cached encode (the operator's decision: cached, storage is cheap and
  -- the first press already starts a transfer he cannot speed up). Keyed by
  -- recipe version so a recipe change re-encodes rather than serving stale.
  encoded_path     TEXT,
  encoded_at       TIMESTAMPTZ,
  encode_version   INTEGER,
  uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cinderella_tracks_kind_check
    CHECK (kind IN ('music', 'audiobook', 'documentary', 'spot')),
  -- A half-recorded encode is unrepresentable (the migration-032 rule).
  CONSTRAINT cinderella_tracks_encode_pair_check
    CHECK ((encoded_path IS NULL) = (encoded_at IS NULL)
       AND (encoded_path IS NULL) = (encode_version IS NULL))
);

-- ── THE PLAYLISTS ───────────────────────────────────────────────────────────
CREATE TABLE cinderella_playlists (
  id         BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       TEXT        NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A track can sit in several playlists; a playlist holds ordered tracks.
CREATE TABLE cinderella_playlist_tracks (
  playlist_id BIGINT  NOT NULL REFERENCES cinderella_playlists (id) ON DELETE CASCADE,
  track_id    BIGINT  NOT NULL REFERENCES cinderella_tracks (id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (playlist_id, track_id)
);

-- ── THE ASSIGNMENTS ─────────────────────────────────────────────────────────
--
-- A playlist can go to several bots and a bot can hold several playlists; the
-- assignment row carries what that bot DOES with it (the operator's decision:
-- on-request is the default for every new assignment, and a cadence is a
-- deliberate choice, never a default). The cadence is the bridge's shape:
-- an interval, a member-message count, whichever comes first.
CREATE TABLE cinderella_playlist_assignments (
  id               BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bot_profile_id   BIGINT      NOT NULL REFERENCES cinderella_bot_profiles (id) ON DELETE CASCADE,
  playlist_id      BIGINT      NOT NULL REFERENCES cinderella_playlists (id) ON DELETE CASCADE,
  mode             TEXT        NOT NULL DEFAULT 'on-request',
  dest_group_id    BIGINT,
  interval_minutes INTEGER,
  message_count    INTEGER,
  last_sent_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cinderella_playlist_assignments_unique
    UNIQUE (bot_profile_id, playlist_id),
  CONSTRAINT cinderella_playlist_assignments_mode_check
    CHECK (mode IN ('on-request', 'cadence')),
  -- A cadence with no trigger and nowhere to send is unrepresentable; an
  -- on-request assignment carries no cadence fields at all.
  CONSTRAINT cinderella_playlist_assignments_cadence_check
    CHECK (
      (mode = 'on-request'
        AND dest_group_id IS NULL
        AND interval_minutes IS NULL
        AND message_count IS NULL)
      OR
      (mode = 'cadence'
        AND dest_group_id IS NOT NULL
        AND (interval_minutes IS NOT NULL OR message_count IS NOT NULL))
    ),
  CONSTRAINT cinderella_playlist_assignments_bounds CHECK (
    (interval_minutes IS NULL OR interval_minutes BETWEEN 1 AND 10080)
    AND (message_count IS NULL OR message_count BETWEEN 1 AND 10000)
  )
);

-- ── THE PLAYS LOG ───────────────────────────────────────────────────────────
--
-- One row per send that reached a group: requested or on the cadence. The DJ
-- sheet aggregates over it; the budgets and the gap derive from it per read;
-- and it is the first 'profile'-class source (see the header - member_id is
-- written NULL until the memory work lands).
CREATE TABLE cinderella_track_plays (
  id             BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  track_id       BIGINT      NOT NULL REFERENCES cinderella_tracks (id) ON DELETE CASCADE,
  bot_profile_id BIGINT      NOT NULL,
  group_id       BIGINT      NOT NULL,
  assignment_id  BIGINT      REFERENCES cinderella_playlist_assignments (id) ON DELETE SET NULL,
  -- TRUE: a member asked and she answered. FALSE: the cadence spoke unbidden,
  -- which is what the budgets bound.
  requested      BOOLEAN     NOT NULL,
  -- The budget class this play was accounted under, frozen at play time
  -- because a track's kind is operator-editable afterwards.
  kind_at_play   TEXT        NOT NULL,
  member_id      TEXT,
  played_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cinderella_track_plays_kind_check
    CHECK (kind_at_play IN ('music', 'audiobook', 'documentary', 'spot'))
);

-- The budget question ("unbidden sends in this room today, this class") and
-- the DJ sheet's popularity windows both read this shape.
CREATE INDEX cinderella_track_plays_budget_idx
  ON cinderella_track_plays (group_id, kind_at_play, played_at DESC)
  WHERE NOT requested;
CREATE INDEX cinderella_track_plays_track_idx
  ON cinderella_track_plays (track_id, played_at DESC);

-- ── THE PUBLICATION CATEGORY (the 013/027/033/057 pattern) ──────────────────
--
-- Her sent announcements archive as bot rows under bot_category 'music',
-- shipped EXCLUDED. When the operator flips it, they publish through the
-- STANDARD bot branch (publish_bot AND the category) and appear in the
-- activity stream as her messages - text captions only, the same boundary as
-- the bridge (D-215): the media itself has no stripped derivative and is not
-- served. These defaults MUST match DEFAULT_ARCHIVE in src/archive/settings.ts;
-- verify:archive compares the two and fails if they drift.
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
  '{"consent": true,  "price": true,
    "search": false, "status": false, "help": false,
    "notUnderstood": false, "nickname": false, "disambiguation": false,
    "conversation": false, "lookup": false, "bridge": false,
    "music": false}'::jsonb
    || CASE
         WHEN jsonb_typeof(v -> 'categories') = 'object' THEN v -> 'categories'
         ELSE '{}'::jsonb
       END AS categories
FROM (SELECT (SELECT value FROM settings WHERE key = 'archive') AS v) t;
