-- Incoming contact requests for an onboarding bot (CCB-S4-023, D-127).
--
-- Step two of four. Step one (024) produced the contact address; a member using that
-- link makes the core raise a `receivedContactRequest` event, and until now nothing
-- listened, so the operator's SimpleX app sat on "connecting" forever.
--
-- A TABLE RATHER THAN COLUMNS ON THE PROFILE, for one reason that is not tidiness: a
-- public contact address can be used by anyone who has it, so more than one request can
-- be outstanding at once. Columns would hold the newest and silently lose the rest, and
-- an operator would accept whichever one the row happened to be showing. Rows let the
-- page list them and the operator accept the intended one.
--
-- The request id is the CORE's `contactRequestId`, not one of ours. Acceptance is issued
-- with it, so a row carrying anything else would accept the wrong request or none.

CREATE TABLE cinderella_bot_contact_requests (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bot_profile_id        BIGINT      NOT NULL
                          REFERENCES cinderella_bot_profiles (id) ON DELETE CASCADE,
  -- The core's own id for the request. Acceptance is issued with exactly this.
  contact_request_id    BIGINT      NOT NULL,
  -- The SimpleX user the request arrived on, so a request can never be accepted
  -- against a record belonging to another identity in the same core database.
  simplex_user_id       BIGINT      NOT NULL,
  requester_name        TEXT        NOT NULL,
  received_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  state                 TEXT        NOT NULL DEFAULT 'pending',
  resolved_at           TIMESTAMPTZ,
  -- Set when accepted: the contact the core created.
  contact_id            BIGINT,
  contact_name          TEXT,
  -- Set when the core later says the contact actually connected. Accepting and
  -- connecting are two different facts and the console must not present the first as
  -- the second: the operator's app shows "connecting" in between.
  connected_at          TIMESTAMPTZ,

  CONSTRAINT cinderella_bot_contact_requests_state_check
    CHECK (state IN ('pending', 'accepted', 'rejected')),
  -- A resolved row states when, and an accepted row states what it produced. A row that
  -- says "accepted" with no contact is a claim with nothing behind it.
  CONSTRAINT cinderella_bot_contact_requests_resolution_check
    CHECK (
      (state = 'pending' AND resolved_at IS NULL AND contact_id IS NULL)
      OR (state = 'rejected' AND resolved_at IS NOT NULL AND contact_id IS NULL)
      OR (state = 'accepted' AND resolved_at IS NOT NULL AND contact_id IS NOT NULL)
    ),
  -- The same request arriving twice (a reconnect, a restart) must not become two rows
  -- the operator has to choose between.
  CONSTRAINT cinderella_bot_contact_requests_unique
    UNIQUE (bot_profile_id, contact_request_id)
);

CREATE INDEX cinderella_bot_contact_requests_pending_idx
  ON cinderella_bot_contact_requests (bot_profile_id, state, received_at DESC);

COMMENT ON COLUMN cinderella_bot_contact_requests.contact_request_id IS
  'The SimpleX core''s contactRequestId. apiAcceptContactRequest is issued with this exact value (CCB-S4-023).';
COMMENT ON COLUMN cinderella_bot_contact_requests.connected_at IS
  'When the core reported contactConnected. Accepted is not the same fact as connected.';
