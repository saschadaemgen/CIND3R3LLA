-- Every knob the knowledge base has (CCB-S5-023, D-177).
--
-- Two columns, and both exist because a control the briefing asks for cannot be honest
-- without them.
--
-- ── THE PER-DOCUMENT WEIGHT ─────────────────────────────────────────────────
--
-- "So the operator's protocol work can outrank an old season protocol." It multiplies the
-- fused score, so it changes ORDER and never membership: a weight cannot push a chunk past
-- the relevance floor, because the floor is on cosine similarity and the weight is not.
-- That separation is deliberate. A weight that could drag an irrelevant chunk over the floor
-- would be a control for defeating the one guarantee this feature makes.
--
-- On the DOCUMENT rather than on the grant. A document is more or less authoritative because
-- of what it is, not because of which bot is reading it, and a weight per bot per document
-- would be N times the controls for a distinction nobody has asked for.
--
-- ── THE INGEST SIGNATURE, WHICH IS HOW STALENESS IS KNOWN ───────────────────
--
-- Changing chunk size, overlap, the ceiling or contextual prefixing changes what is IN the
-- store, so every chunk cut under the old settings is a chunk somebody else's settings
-- produced. The briefing requires that the operator be told BEFORE the change and that the
-- fate of existing documents be stated.
--
-- This column records the settings each document was actually ingested under. Staleness is
-- then DERIVED - the stored signature differs from the current one - rather than a boolean
-- somebody has to remember to set. A flag would drift the first time a document was
-- re-ingested by a path that forgot to clear it, and it would drift silently.
--
-- WHAT HAPPENS TO A STALE DOCUMENT, stated here because it is a decision and not an
-- accident: it stays RETRIEVABLE and is shown as stale, with a one-click rebuild. Two
-- alternatives were rejected.
--
--   Re-ingesting automatically would spend minutes of GPU on every slider nudge, and an
--   operator trying four chunk sizes would queue four full rebuilds of the whole corpus.
--
--   Making stale chunks unretrievable would silently switch the knowledge base off the
--   moment somebody touched a setting, which is the failure mode this project spends its
--   time removing.
--
-- A stale chunk is not WRONG. It is the operator's verbatim text, correctly stored, cut to a
-- different length. The honest response to that is to show it, loudly, and let him decide
-- when to spend the GPU time.

ALTER TABLE cinderella_kb_documents
  ADD COLUMN weight REAL NOT NULL DEFAULT 1.0,
  ADD COLUMN ingest_signature TEXT;

ALTER TABLE cinderella_kb_documents
  ADD CONSTRAINT cinderella_kb_documents_weight_check
    CHECK (weight > 0 AND weight <= 10);

COMMENT ON COLUMN cinderella_kb_documents.weight IS
  'Multiplies the fused retrieval score, so it changes ORDER and never membership '
  '(CCB-S5-023). It cannot lift a chunk over the relevance floor: the floor is on cosine '
  'similarity, which the weight does not touch.';

COMMENT ON COLUMN cinderella_kb_documents.ingest_signature IS
  'The ingest settings this document was actually chunked under (CCB-S5-023). Staleness is '
  'derived by comparing it with the current settings, rather than stored as a flag that '
  'could drift. NULL means it was ingested before this column existed.';

-- Existing documents get NULL rather than a guessed signature. NULL reads as "ingested
-- before this was recorded", which the console shows as unknown rather than as current:
-- claiming they match the present settings would be a claim nothing checked.
