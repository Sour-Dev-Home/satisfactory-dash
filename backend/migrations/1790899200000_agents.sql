-- Up Migration
-- ADR-0031 PR 5a: the edge agent's enrolment and credentials. A new `agents` schema (ADR-0014: one schema per module).
-- Additive only, hand-written SQL, plain tables. Nothing here is personal data.
--
--   enrollment_codes   one-time codes an owner or admin creates for a server. Only the SHA-256 of the code is stored
--                      (a code is 40 bits and lives 10 minutes, so it is a short-lived secret, not a password).
--   agent_credentials  one row per enrolled server: the SHA-256 of the agent's 256-bit secret (the secret itself is
--                      shown once and never stored), what version it reports, when it was last heard, and whether it
--                      was revoked. A revoked or unknown secret is the same 401 for the agent.

CREATE SCHEMA IF NOT EXISTS agents;

GRANT USAGE ON SCHEMA agents TO satis_app;
ALTER DEFAULT PRIVILEGES FOR ROLE satis_migrator IN SCHEMA agents
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO satis_app;
ALTER DEFAULT PRIVILEGES FOR ROLE satis_migrator IN SCHEMA agents
  GRANT USAGE, SELECT ON SEQUENCES TO satis_app;

CREATE TABLE agents.enrollment_codes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id   uuid        NOT NULL REFERENCES servers.servers (id) ON DELETE CASCADE,
  code_hash   bytea       NOT NULL UNIQUE CHECK (length(code_hash) = 32),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  -- Who created it. Not a foreign key, like the audit trail's actor: an id that stops resolving is fine.
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX enrollment_codes_server_idx ON agents.enrollment_codes (server_id);

CREATE TABLE agents.agent_credentials (
  server_id     uuid        PRIMARY KEY REFERENCES servers.servers (id) ON DELETE CASCADE,
  secret_hash   bytea       NOT NULL UNIQUE CHECK (length(secret_hash) = 32),
  agent_version text        NOT NULL CHECK (length(agent_version) BETWEEN 1 AND 32),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz,
  revoked_at    timestamptz
);

-- Down Migration
-- Forward-only in production (ADR-0025): a rollback is the previous build plus the previous .env,
-- because schema changes are additive.
