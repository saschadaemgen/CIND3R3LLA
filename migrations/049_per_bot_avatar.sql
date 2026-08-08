-- A face per bot (CCB-S5-007, D-161).
--
-- ── THE DEFECT ───────────────────────────────────────────────────────────────
--
-- `AVATAR_PATH` is one image in the environment. CCB-S5-001 hosts every enabled bot and
-- applied that one image to the PRIMARY only, deliberately and with a log line saying so:
-- writing it onto every profile would have given every bot the same face, which looks
-- intentional and is not, where a second bot with no picture at least looks unfinished.
--
-- So a second bot could have no picture, or the first one's. Neither is what an operator
-- wants when the point of the bot is that it is a different character.
--
-- ── THE MODEL: A PATH PER BOT, NULL MEANING THE DEFAULT ──────────────────────
--
-- One nullable column, and NULL is a real answer rather than a missing one: it means "use
-- the shipped default", which is `AVATAR_PATH`. That makes the fallback the same mechanism
-- for every bot including the first, so there is no special primary case anywhere in the
-- code, and an existing deployment keeps exactly the picture it has: the primary has no
-- upload, so it falls back to the file the operator already set.
--
-- The BYTES are not here. The path is, exactly as the media tree and the recital chapter
-- images do it (CLAUDE.md: the DB stores the path, never the bytes). The file lives beside
-- the chapter images under the asset root, re-encoded through the same `sharp` pipeline, and
-- is budgeted into the SimpleX profile envelope by `buildAvatarDataUri` at boot like every
-- other avatar.

ALTER TABLE cinderella_bot_profiles
  ADD COLUMN IF NOT EXISTS avatar_path TEXT;

COMMENT ON COLUMN cinderella_bot_profiles.avatar_path IS
  'Relative path under the asset root to this bot''s own avatar, or NULL to use the '
  'deployment default from AVATAR_PATH. Never the image bytes: the DB stores the path.';
