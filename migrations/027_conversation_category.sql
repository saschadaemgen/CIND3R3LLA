-- Free conversation gets its own publication switch (CCB-S4-027, D-131).
--
-- `bot_publish_settings` carries the shipped category defaults as a literal, and says in
-- 013 that they MUST match DEFAULT_ARCHIVE in src/archive/settings.ts because the
-- harness compares the two. Adding a category in TypeScript alone therefore drifts them
-- apart, and `verify:archive` caught exactly that. This is the other half.
--
-- CREATE OR REPLACE rather than a new view: the column list is unchanged, only the
-- default literal gains a key, so every view built on top of this one keeps working
-- without being touched.
--
-- `conversation: false`, and the default matters more here than for any other category:
-- it is the only one whose words the application did not decide. A member talking to her
-- casually has not consented to that exchange being republished, and the operator turns
-- it on deliberately or not at all.

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
    "conversation": false}'::jsonb
    || CASE
         WHEN jsonb_typeof(v -> 'categories') = 'object' THEN v -> 'categories'
         ELSE '{}'::jsonb
       END AS categories
FROM (SELECT (SELECT value FROM settings WHERE key = 'archive') AS v) t;
