-- Up Migration
-- ADR-0052 PR 2: the last snapshot an agent sent for a server, so a backend restart (every deploy) does not blank the
-- dashboard. ONE row per server, overwritten in place (INSERT ... ON CONFLICT DO UPDATE in the repository): a cache, not
-- history (history stays in the ADR-0027 tables). A new table in the existing `telemetry` schema, so expand-only
-- (ADR-0049 D6); its grants come from the schema's default privileges.
--
-- There is deliberately NO players column: player names are never written to the database (privacy page, ADR-0052 2.2).
-- `status` holds only the player COUNT and limit. The `factory` part is capped at 2,000,000 bytes by the writer; over
-- it the column is NULL, never truncated.

CREATE TABLE telemetry.latest_snapshots (
  server_id              uuid        PRIMARY KEY REFERENCES servers.servers (id) ON DELETE CASCADE,
  reachable              boolean     NOT NULL,
  unreachable_since      timestamptz,
  last_received_at       timestamptz NOT NULL,
  status                 jsonb,
  status_observed_at     timestamptz,
  power                  jsonb,
  power_observed_at      timestamptz,
  factory                jsonb,
  factory_observed_at    timestamptz,
  auto_pause             boolean,
  auto_pause_pending     boolean,
  auto_pause_observed_at timestamptz,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Down Migration
-- Forward-only in production (ADR-0025): a rollback is the previous build plus the previous .env,
-- because schema changes are additive.
