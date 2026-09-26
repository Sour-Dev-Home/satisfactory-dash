-- Up Migration
-- ADR-0031 PR 5b: commands to an edge agent, and the `agent_offline` alert kind. Additive only.
--
--   agents.commands   what the dashboard asks an agent to do (today: set_auto_pause). The agent long-polls for them,
--                     runs them and reports a result CODE (never free text). A command lives 60 seconds: after that it
--                     is `expired` and must not be run. Only the target value (a boolean) is stored: nothing personal.
--   alerts.rules.kind gains 'agent_offline' (no snapshot for two minutes). The CHECK only gains a value, so every
--                     existing row stays valid and the previous build keeps working (it skips a rule whose kind it
--                     cannot read).

CREATE TABLE agents.commands (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id    uuid        NOT NULL REFERENCES servers.servers (id) ON DELETE CASCADE,
  type         text        NOT NULL CHECK (type IN ('set_auto_pause')),
  params       jsonb       NOT NULL CHECK (jsonb_typeof(params) = 'object'),
  status       text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'succeeded', 'failed', 'expired')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  sent_at      timestamptz,
  completed_at timestamptz,
  -- The agent's failure code (a fixed vocabulary), null on success and when the agent gave none.
  result_code  text        CHECK (result_code IS NULL OR result_code IN ('unsupported', 'upstream_unreachable', 'upstream_auth_rejected', 'upstream_error')),
  -- Who asked. Not a foreign key, like the audit trail's actor: an id that stops resolving is fine.
  created_by   uuid
);
-- The agent's poll (a server's open commands) and the settings read (a server's newest commands).
CREATE INDEX commands_server_status_idx ON agents.commands (server_id, status, expires_at);
CREATE INDEX commands_server_created_idx ON agents.commands (server_id, created_at DESC);

ALTER TABLE alerts.rules DROP CONSTRAINT rules_kind_check;
ALTER TABLE alerts.rules ADD CONSTRAINT rules_kind_check
  CHECK (kind IN ('power_outage', 'fuse_trip', 'stopped_machines', 'server_unreachable', 'production_below_target', 'agent_offline'));

-- Down Migration
-- Forward-only in production (ADR-0025): a rollback is the previous build plus the previous .env,
-- because schema changes are additive.
