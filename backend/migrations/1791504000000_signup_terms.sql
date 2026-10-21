-- Up Migration
-- #528 (ADR-0046 task 6): open sign-up records what a new account accepted and when. Additive only:
-- existing accounts keep NULL (they were invited, not self-registered), and nothing is rewritten.
-- terms_version names the terms text accepted (a date string such as 2026-09-24); no personal data.
ALTER TABLE identity.users
  ADD COLUMN terms_version     text        CHECK (terms_version IS NULL OR length(terms_version) BETWEEN 1 AND 32),
  ADD COLUMN terms_accepted_at timestamptz,
  ADD CONSTRAINT users_terms_pair CHECK ((terms_version IS NULL) = (terms_accepted_at IS NULL));

-- C8 counts sign-ups by this column (only open sign-up sets it), so the count stays an index range scan
-- under the sign-up lock however large the table grows.
CREATE INDEX users_terms_accepted_at_idx ON identity.users (terms_accepted_at) WHERE terms_accepted_at IS NOT NULL;

-- The terms version the person ticked on the sign-in page, carried through the Google round trip
-- on the single-use login attempt (never trusted from the callback's query string).
ALTER TABLE identity.login_attempts
  ADD COLUMN terms_version text CHECK (terms_version IS NULL OR length(terms_version) BETWEEN 1 AND 32);
