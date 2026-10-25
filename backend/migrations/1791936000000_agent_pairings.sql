-- Up Migration
-- ADR-0051 section 1 + ADR-0057 D6: device-code pairing. An agent asks for a pairing, shows its code to the owner, the owner
-- approves it in the dashboard, and the agent's next poll mints its credential (the same one enrolment mints).
--
--   agents.pairings   one row per pairing request. Only the SHA-256 of the 128-bit pairing secret is stored (the agent
--                     holds the secret; it travels in request bodies only). `user_code` is the 60-bit code the owner
--                     types; it is no secret on its own (it needs a signed-in approver) and is unique across the rows
--                     kept. Holds the session name and agent version the agent reported (untrusted text, shown to the
--                     approver) and nothing else personal: `approved_by` is a user id, like `enrollment_codes.created_by`
--                     (not a foreign key). Rows are deleted one hour after they expire (the sweeper), so they live at most
--                     about 75 minutes.
--
-- Additive: one new table in the existing schema (default privileges already grant satis_app its DML).

CREATE TABLE agents.pairings (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_hash           bytea       NOT NULL UNIQUE CHECK (length(secret_hash) = 32),
  user_code             text        NOT NULL UNIQUE CHECK (user_code ~ '^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$'),
  server_name           text        CHECK (server_name IS NULL OR length(server_name) BETWEEN 1 AND 200),
  agent_version         text        NOT NULL CHECK (length(agent_version) BETWEEN 1 AND 32),
  created_at            timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL,
  last_poll_at          timestamptz,
  -- The interval the agent is expected to poll at; grows by 5 s on every slow_down (RFC 8628 section 3.5), at most 60.
  poll_interval_seconds integer     NOT NULL DEFAULT 5 CHECK (poll_interval_seconds BETWEEN 1 AND 60),
  approved_by           uuid,
  approved_at           timestamptz,
  -- The server the approval is for (a new one, or the one being re-paired). Gone with the server.
  server_id             uuid        REFERENCES servers.servers (id) ON DELETE CASCADE,
  consumed_at           timestamptz
);
CREATE INDEX pairings_expires_idx ON agents.pairings (expires_at);

-- Down Migration
-- Forward-only in production (ADR-0025): a rollback is the previous build plus the previous .env,
-- because schema changes are additive.
