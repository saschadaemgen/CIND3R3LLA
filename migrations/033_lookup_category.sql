-- Web search answers get their own publication switch (CCB-S4-037, D-141).
--
-- The same correction 027 made for free conversation, for the same reason and caught the
-- same way. `bot_publish_settings` carries the shipped category defaults as a LITERAL,
-- 013 says it must match DEFAULT_ARCHIVE in src/archive/settings.ts, and `verify:archive`
-- compares the two. Adding a category in TypeScript alone drifts them apart, and that is
-- precisely what happened here: the harness failed on `category default for "lookup"`
-- with everything else green. This is the other half.
--
-- CREATE OR REPLACE rather than a new view: the column list is unchanged and only the
-- default literal gains a key, so everything built on top of this keeps working.
--
-- `lookup: false`, and the reasoning is the conversation category's plus one more. Free
-- conversation is excluded because the WORDS are the model's rather than the
-- application's. A lookup answer is that, and the MATERIAL behind it came from outside
-- the group entirely: it is a summary of somebody else's web page. A consent-first
-- archive of what members said is not the obvious home for that, so an operator turns it
-- on deliberately or not at all.

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
    "conversation": false, "lookup": false}'::jsonb
    || CASE
         WHEN jsonb_typeof(v -> 'categories') = 'object' THEN v -> 'categories'
         ELSE '{}'::jsonb
       END AS categories
FROM (SELECT (SELECT value FROM settings WHERE key = 'archive') AS v) t;
