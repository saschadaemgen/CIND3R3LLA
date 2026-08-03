-- The contact address the onboarding wizard creates (CCB-S4-022, D-126).
--
-- Step one of four in the SimpleX onboarding journey. The wizard has described this
-- step since CCB-S4-00x and nothing behind it existed: the page said "Create the
-- SimpleX contact address" and there was no control, because the onboarding work
-- built the persistent model and never executed an SDK action. These columns are
-- where the result of the real action lands.
--
-- THE LINK IS RECORDED WITH THE PROFILE IT WAS CREATED ON, and the three columns move
-- together or not at all. A contact link on its own cannot be checked against
-- anything: the operator cannot tell, from a bare string, whether the address belongs
-- to the bot the runtime is actually hosting or to some other identity in the same
-- core database. Storing `simplex_user_id` alongside it makes that answerable, and the
-- CHECK makes a half-written row impossible rather than merely unlikely.

ALTER TABLE cinderella_bot_profiles
  ADD COLUMN contact_address_link       TEXT,
  ADD COLUMN contact_address_user_id    BIGINT,
  ADD COLUMN contact_address_created_at TIMESTAMPTZ;

ALTER TABLE cinderella_bot_profiles
  ADD CONSTRAINT cinderella_bot_profiles_contact_address_check
  CHECK (
    (
      contact_address_link IS NULL
      AND contact_address_user_id IS NULL
      AND contact_address_created_at IS NULL
    )
    OR (
      contact_address_link IS NOT NULL
      AND contact_address_user_id IS NOT NULL
      AND contact_address_created_at IS NOT NULL
    )
  );

COMMENT ON COLUMN cinderella_bot_profiles.contact_address_link IS
  'The SimpleX contact link, as returned by the core. NULL until the create-address action has actually succeeded (CCB-S4-022).';
COMMENT ON COLUMN cinderella_bot_profiles.contact_address_user_id IS
  'The SimpleX user id the address was created on, so the link can be checked against the profile the runtime hosts.';
