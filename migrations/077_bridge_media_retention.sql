-- Bridge media gets a retention bound (CCB-S5-064, D-262).
--
-- ── THE RULE, AND WHY IT SIMPLIFIED ──────────────────────────────────────────
--
-- The operator's rule: an unpublished channel file is deleted after 30 days; a published
-- one is kept. Thirty days because the relays expire their own copies in about 48 hours,
-- so everything past that is a copy kept for the operator's convenience, not for delivery.
--
-- Established before building (CCB-S5-064 stage 0): NO bridge file is ever published. The
-- archived announcement row is hardcoded text-only, no public route can serve a bridge
-- file, and serving one would bypass the metadata-stripping pipeline every published image
-- goes through. So the published-file exception is structurally EMPTY today and the rule
-- simplifies - but the reasoning is recorded here rather than dropped, because it is the
-- load-bearing half the day bridge media does publish: a published announcement's file
-- must never disappear because a timer ran out. A picture vanishing from a live public
-- page is worse than a full disk. If that day comes, the sweep predicate MUST gain the
-- publication exception before the first published file ages past the bound.
--
-- The exception that IS operative is in-chat: a repeat or digest send reads the stored
-- file at send time, so the sweep never touches a file whose post can still send. Only a
-- post that is terminally resolved or source-deleted, and older than the bound, loses its
-- bytes - and orphaned files (rows cascaded away by Clear record, mapping deletes or bot
-- deletes, which never unlinked the bytes) are swept by age, because nothing can ever
-- reference them again.
--
-- ── THE TOMBSTONE STATE ──────────────────────────────────────────────────────
--
-- 'swept' is the D-240 shape: the content is gone, the fact that a file existed is not.
-- A swept row keeps its mime and size as the record of what was held; the pair CHECK
-- makes a swept row that still points at bytes unrepresentable.

ALTER TABLE cinderella_bridge_posts
  DROP CONSTRAINT cinderella_bridge_posts_media_state_check;
ALTER TABLE cinderella_bridge_posts
  ADD CONSTRAINT cinderella_bridge_posts_media_state_check
  CHECK (media_state IN ('none', 'pending', 'stored', 'failed', 'too-large', 'swept'));

ALTER TABLE cinderella_bridge_posts
  ADD CONSTRAINT cinderella_bridge_posts_swept_pathless_check
  CHECK (media_state <> 'swept' OR media_path IS NULL);

COMMENT ON CONSTRAINT cinderella_bridge_posts_swept_pathless_check
  ON cinderella_bridge_posts IS
  'A swept file is gone: a row claiming both the swept state and a path would be a '
  'tombstone still holding content, the exact shape migration 070 forbids for the '
  'archive (CCB-S5-064).';

-- The sweep is bounded to files whose posts can never send again; the partial index is
-- the sweep's own read, and like 070's unswept index it SHRINKS as the sweep does its
-- work, which is the point.
CREATE INDEX cinderella_bridge_posts_sweepable_idx
  ON cinderella_bridge_posts (posted_at)
  WHERE media_state = 'stored' AND (resolved_at IS NOT NULL OR deleted_at IS NOT NULL);
