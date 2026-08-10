-- Different bots, different capabilities (CCB-S5-021, D-175).
--
-- ── THE DEFECT ───────────────────────────────────────────────────────────────
--
-- Plugin state lives under a single `plugins` settings key, so enabling Web Search enabled
-- it for EVERY hosted bot. It is not in CCB-S5-006's scope inventory because it is not in
-- `InteractionSettings` at all, which is precisely why nothing pointed at it: the sweep that
-- placed every interaction setting could not see a key that lives somewhere else.
--
-- That is the fifth thing this season that was correct before multi-bot and silently stopped
-- being correct - after the three call sites that were five, the wake word, the onboarding
-- steps and the primary flag - and it is the one that matters most, because CAPABILITY is
-- what makes a second bot worth having. One bot that searches and one that does not is the
-- operator's stated product direction, and today it is one switch for all of them.
--
-- ── ONE MECHANISM, NOT A THIRD ONE ───────────────────────────────────────────
--
-- Shared defaults with per-bot deviations, exactly as 045 established for the laws and 047
-- reused for the interaction settings. D-155's reasoning applies unchanged and is not
-- restated here: a value the operator has not set for a bot is INHERITED, so editing the
-- shared value still reaches every bot that has not deviated, and "what is this setting" has
-- one answer plus a list of departures from it rather than N answers.
--
-- ── WHY plugin_id AND setting_key, RATHER THAN AN `enabled` COLUMN ───────────
--
-- Today exactly one plugin setting is per bot: `enabled`. A BOOLEAN column would express
-- that and nothing else, and the next capability is already known - a knowledge base over
-- the operator's own documents, given to one bot and not another - whose per-bot dimension
-- is WHICH DOCUMENTS, not a boolean. A key/value shape carries that with a CHECK edit and an
-- inventory row instead of a second table, which is the whole point of choosing a pattern
-- rather than a one-off.
--
-- `plugin_id` is deliberately NOT a foreign key. Plugins are declared in code by
-- `definePlugin`, not in a table, and a plugin removed from a build must not take an
-- operator's decisions with it: an override for a plugin this build does not have is
-- ignored on read (see `applyPluginOverrides`) and comes back if the plugin does.

CREATE TABLE cinderella_plugin_overrides (
  bot_profile_id BIGINT      NOT NULL
                   REFERENCES cinderella_bot_profiles (id) ON DELETE CASCADE,
  -- The plugin's stable slug: `web-search`, `crypto-prices`. The same string
  -- `definePlugin` registers and the settings key is built from.
  plugin_id      TEXT        NOT NULL,
  -- `enabled` today. A dotted path into the plugin's own settings document when a later
  -- capability places one per bot.
  setting_key    TEXT        NOT NULL,
  -- JSON, for the reason 047 gives: plugin settings are of every shape, and a column per
  -- type would be several columns with all but one always null.
  value          JSONB       NOT NULL,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (bot_profile_id, plugin_id, setting_key),

  -- ONLY THESE MAY BE SET PER BOT, and the reasons are in the inventory in
  -- `src/plugins/scope.ts`. The two that matter most are the two the briefing settled in
  -- advance and this refuses to let drift: the provider API KEY is shared, because it is one
  -- account and asking an operator to paste a credential once per bot is an invitation to
  -- leak it; and the search BUDGETS are shared, because they are the operator's bill and
  -- because the untrusted-text ceilings are the size of the injection surface, which must be
  -- one number or nobody can say how much stranger's text can reach any bot.
  --
  -- A CHECK rather than a trigger, for 047's reason: the per-bot set is STATIC, so a CHECK
  -- is both sufficient and cheaper. It follows 035's precedent for fixed vocabularies.
  CONSTRAINT cinderella_plugin_overrides_key_check
    CHECK (setting_key IN ('enabled'))
);

CREATE INDEX cinderella_plugin_overrides_plugin_idx
  ON cinderella_plugin_overrides (plugin_id, setting_key);

COMMENT ON TABLE cinderella_plugin_overrides IS
  'Per-bot deviations from the shared plugin state (CCB-S5-021). Absence means inherit. '
  'Only the keys in the CHECK may be set per bot; the rest are deployment-wide, and the '
  'reasons are in src/plugins/scope.ts.';

COMMENT ON COLUMN cinderella_plugin_overrides.plugin_id IS
  'The plugin slug from definePlugin. Deliberately not a foreign key: plugins live in code, '
  'and an override for a plugin this build does not carry is ignored on read rather than '
  'refused on write, so removing a plugin does not destroy the operator''s decisions.';

COMMENT ON CONSTRAINT cinderella_plugin_overrides_key_check
  ON cinderella_plugin_overrides IS
  'The per-bot set, duplicated from PLUGIN_SETTING_SCOPES in src/plugins/scope.ts. '
  'verify:plugin-scope asserts the two agree, so the duplication cannot drift.';

/* ── The backfill is EMPTY, and that is the backfill ─────────────────────────── */

-- 047 had to write rows, because a bot created between CCB-S5-001 and that briefing was
-- actively answering to the primary's wake word and inheritance would have preserved the
-- defect. Here inheritance IS the correct outcome: absence means inherit, so every bot
-- hosted today keeps every plugin that is enabled today, including the bots created since
-- multi-bot arrived. Nothing changes on the existing deployment, which is what the briefing
-- asks for, and it is achieved by writing nothing rather than by writing N rows that would
-- then have to be kept in step with the shared value.
--
-- Stated rather than left as an absence, because "no backfill" and "the backfill was
-- forgotten" look identical in a migration file.
