-- 060: she greets a new member once (CCB-S5-041).
--
-- ── THE KEY IS THE MEMBER'S WIRE ID, AND THAT IS THE WHOLE ONCE-RULE ─────────
--
-- D-190 established that a member's wire id is SCOPED TO THE ROOM: that is precisely why two
-- `groups` records are one room exactly when their member sets intersect, measured at 941/830/1
-- within rooms and 0 across. So `member_id` already means "this person, in this room". One
-- UNIQUE constraint on it therefore buys both halves of the briefing's requirement at once:
--
--   once per member per group   a rejoin, a reconnect or a client resync finds the row
--   one greeting per room       a second bot in the room finds the SAME row, not its own
--
-- The second is worth stating plainly because it is the shape that cost 1,255 duplicated
-- messages under capture and every post arriving twice under the bridge. Here it needs no
-- election and no room index: the bots share a key because the ROOM gave the member that id,
-- so whichever bot gets there first records it and the others find it taken. There is nothing
-- to elect and therefore nothing to elect WRONGLY.
--
-- ── WHAT IS DELIBERATELY NOT THE KEY ────────────────────────────────────────
--
-- NOT the room key. `Room.key` in `capture/rooms.ts` says it of itself: "Stable within a
-- process and derived, never stored ... so nothing depends on this surviving a membership
-- change." It is the smallest `simplexUserId:groupId` in the room, so it moves when membership
-- moves, which is the D-205 failure this season paid for twice.
--
-- NOT the local group id, for the same reason: it is local to one profile's database and does
-- not survive a rejoin. His group moved 4 -> 8 and a channel 7 -> 9 in a single day. The group
-- id IS recorded below, because a human reading the diagnostics needs to know where it
-- happened, but nothing keys on it.
--
-- NOT (bot, member). That would let every bot in the room greet the same person once EACH,
-- which is the defect rather than the rule.

CREATE TABLE IF NOT EXISTS cinderella_welcome_greetings (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- THE KEY. Room-scoped by SimpleX's own construction; see the header.
  member_id        TEXT        NOT NULL,

  -- Who did it and where, for the diagnostics page. Descriptive, never load-bearing:
  -- `group_id` is a per-profile handle and is recorded for a reader, not for a lookup.
  bot_profile_id   BIGINT      NOT NULL REFERENCES cinderella_bot_profiles(id) ON DELETE CASCADE,
  group_id         BIGINT      NOT NULL,
  group_name       TEXT        NOT NULL,
  member_name      TEXT        NOT NULL,

  -- Which greeting was chosen. `returning` is the buildable distinction: incognito is NOT
  -- observable on a received member (every `incognito` in @simplex-chat/types is either an
  -- error type about our own connections or `AutoAccept.acceptIncognito`, our own setting),
  -- and it is unobservable BY DESIGN, since a bot that could tell would break the feature.
  -- NOT `returning`: that is a Postgres reserved word (the RETURNING clause) and the
  -- CREATE TABLE fails to parse with it.
  is_returning     BOOLEAN     NOT NULL DEFAULT FALSE,

  -- Where it went, or why it did not.
  --   group | support | direct   it was sent, by this route
  --   suppressed                 nothing was sent; `reason` says why
  route            TEXT        NOT NULL,

  -- Only for `route = 'suppressed'`, and never NULL when it is. The three refusals a private
  -- route can give are kept APART because they are three different facts about the
  -- deployment, and CCB-S3-023 forbids rendering "not configured" and "configured but
  -- failing" the same way:
  --   no-contact        the member has no `memberContactId`; no private route EXISTS
  --   prohibited        the core answered `directMessagesProhibited`; the group's rule
  --                     refuses it for this bot's ROLE (`directMessages` is a
  --                     RoleGroupPreference: allowed from a role upwards, not a flat switch)
  --   send-failed       something else broke. A FAULT, and the only one of the three that
  --                     reaches `status.error`.
  --   no-text           the operator has not written a greeting for this case
  --   disabled          the capability is off for this bot
  reason           TEXT,

  greeted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT cinderella_welcome_greetings_route CHECK (
    route IN ('group', 'support', 'direct', 'suppressed')
  ),
  -- A suppression with no reason is unrepresentable, and a send with one is too. The same
  -- shape as migration 032's arming CHECK: make the dishonest row impossible rather than
  -- trusting every writer to fill it in.
  CONSTRAINT cinderella_welcome_greetings_reason CHECK (
    (route = 'suppressed' AND reason IS NOT NULL) OR
    (route <> 'suppressed' AND reason IS NULL)
  )
);

-- THE ONCE-RULE ITSELF. Not merely an index: the guarantee. A second bot, a rejoin, a
-- reconnect and a resync all collide here.
CREATE UNIQUE INDEX IF NOT EXISTS cinderella_welcome_greetings_member
  ON cinderella_welcome_greetings (member_id);

-- The diagnostics page reads newest-first per bot.
CREATE INDEX IF NOT EXISTS cinderella_welcome_greetings_bot_at
  ON cinderella_welcome_greetings (bot_profile_id, greeted_at DESC);

/* ── The per-bot key set grows by five (CCB-S5-041) ──────────────────────────── */
--
-- 051's CHECK listed exactly one per-bot key, `enabled`, because at the time every plugin's
-- only per-bot setting was its switch. The Welcome plugin is the first whose CONTENT is per
-- bot too: the greeting is this bot's voice in this bot's words, and nothing about it is a
-- deployment cost, so nothing about it is shared.
--
-- This duplication with `PLUGIN_SETTING_SCOPES` in `src/plugins/scope.ts` is DELIBERATE and
-- `verify:plugin-scope` asserts the two agree - it read the list out of this constraint and
-- went red the moment the code gained five keys the database did not have, which is exactly
-- what it is for.

ALTER TABLE cinderella_plugin_overrides
  DROP CONSTRAINT IF EXISTS cinderella_plugin_overrides_key_check;

ALTER TABLE cinderella_plugin_overrides
  ADD CONSTRAINT cinderella_plugin_overrides_key_check
  CHECK (setting_key IN (
    'enabled',
    -- Welcome (CCB-S5-041): the words, and how they are addressed.
    'text',
    'returningText',
    'separateReturning',
    'destination',
    'fallback'
  ));

COMMENT ON CONSTRAINT cinderella_plugin_overrides_key_check
  ON cinderella_plugin_overrides IS
  'The per-bot set, duplicated from PLUGIN_SETTING_SCOPES in src/plugins/scope.ts. '
  'verify:plugin-scope asserts the two agree, so the duplication cannot drift.';
