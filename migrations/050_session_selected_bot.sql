-- Which bot the operator is currently editing (CCB-S5-011, D-169).
--
-- ── WHY THIS IS ON THE SESSION AND NOT ON THE DEPLOYMENT ─────────────────────
--
-- The console grew four separate `?bot=` controls, one per page family, so the operator had
-- to re-state which bot he meant on every page and could not tell at a glance which one a
-- form belonged to. The replacement is one switcher in the sidebar, and it needs somewhere
-- to remember the choice.
--
-- Not `settings`: that table is global and has no operator dimension, so two people signed
-- in would fight over one value, and the choice would outlive the person who made it. Not a
-- new preferences table either, for a single nullable id. It belongs to THIS operator's
-- session, and `admin_sessions` is exactly that: created at sign-in, pruned on idle and on
-- absolute lifetime, destroyed on sign-out. The value dies with the session, which is the
-- lifetime the choice actually has.
--
-- It is deliberately NOT the primary flag (`cinderella_bot_profiles.selected_for_runtime`).
-- The primary is a property of the deployment; this is a property of a browsing session, and
-- conflating them is what made the primary feel like a setting an operator should think
-- about. CCB-S5-011 does not remove the flag; it removes the reason an operator ever looked
-- at it.
--
-- ── ON DELETE SET NULL, WHICH IS THE ONE THING THAT MATTERS HERE ─────────────
--
-- An operator can delete a bot from the console while a session is pointing at it. Without
-- the cascade the session would hold a dangling id and every page would resolve to a bot that
-- does not exist; with it, the selection quietly falls back to "none", which every reader
-- already treats as "the first bot". A stale pointer is the only way this column can hurt
-- anybody, and the database is the right place to make it unrepresentable.

ALTER TABLE admin_sessions
  ADD COLUMN selected_bot_profile_id BIGINT
    REFERENCES cinderella_bot_profiles (id) ON DELETE SET NULL;

COMMENT ON COLUMN admin_sessions.selected_bot_profile_id IS
  'The bot this operator is currently editing (CCB-S5-011). NULL means no choice has been '
  'made, which every page reads as the first bot. A property of the SESSION, never of the '
  'deployment: it is not the primary flag and must not be confused with it. Cleared '
  'automatically if that bot is deleted.';
