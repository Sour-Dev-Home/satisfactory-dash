-- Up Migration
-- ADR-0027 PR 5: the alert engine. A new `alerts` schema (ADR-0014: one schema per module). Additive only,
-- hand-written SQL, plain tables.
--
--   rules          one row per (server, kind): params, timing and severity. The presets are seeded by the app.
--   alert_state    the persisted state machine per (rule, subject): a restart reloads it and does not re-fire.
--   alert_events   the alert log: every fired / updated / renotify / resolved transition. Written in the SAME
--                  transaction as the state change (the transactional outbox of ADR-0027 decision 5 references it).
--   server_mutes   "mute this server's alerts until ...".
--
-- Nothing here is personal data: it describes the game world (ADR-0027).

CREATE SCHEMA IF NOT EXISTS alerts;

GRANT USAGE ON SCHEMA alerts TO satis_app;
ALTER DEFAULT PRIVILEGES FOR ROLE satis_migrator IN SCHEMA alerts
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO satis_app;
ALTER DEFAULT PRIVILEGES FOR ROLE satis_migrator IN SCHEMA alerts
  GRANT USAGE, SELECT ON SEQUENCES TO satis_app;

CREATE TABLE alerts.rules (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id      uuid        NOT NULL REFERENCES servers.servers (id) ON DELETE CASCADE,
  kind           text        NOT NULL CHECK (kind IN ('power_outage', 'fuse_trip', 'stopped_machines', 'server_unreachable')),
  -- Validated by a zod schema per kind on write AND on read; an unreadable rule is skipped, never a crash.
  params         jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(params) = 'object'),
  -- The condition must hold this long before the alert fires (0 = edge-triggered).
  for_seconds    integer     NOT NULL CHECK (for_seconds BETWEEN 0 AND 86400),
  -- ...and be false this long before a firing alert resolves.
  clear_seconds  integer     NOT NULL CHECK (clear_seconds BETWEEN 0 AND 86400),
  -- The shortest time between two notifications for one firing alert.
  repeat_seconds integer     NOT NULL CHECK (repeat_seconds BETWEEN 60 AND 604800),
  severity       text        NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  enabled        boolean     NOT NULL DEFAULT true,
  -- true = seeded by the app (at most one per server and kind, so seeding is idempotent).
  preset         boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX rules_one_preset_per_kind ON alerts.rules (server_id, kind) WHERE preset;
CREATE INDEX rules_server_idx ON alerts.rules (server_id);

CREATE TABLE alerts.alert_state (
  rule_id          uuid        NOT NULL REFERENCES alerts.rules (id) ON DELETE CASCADE,
  -- What the alert is about: "circuit:<id>", "group" (grouped machine alerts) or "server".
  subject          text        NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
  phase            text        NOT NULL CHECK (phase IN ('ok', 'pending', 'firing')),
  since            timestamptz,
  clear_since      timestamptz,
  last_notified_at timestamptz,
  last_condition   boolean     NOT NULL DEFAULT false,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rule_id, subject)
);

CREATE TABLE alerts.alert_events (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  server_id   uuid        NOT NULL REFERENCES servers.servers (id) ON DELETE CASCADE,
  -- Kept when the rule is deleted (the log outlives the rule); kind and severity are copied so it still reads.
  rule_id     uuid        REFERENCES alerts.rules (id) ON DELETE SET NULL,
  kind        text        NOT NULL,
  severity    text        NOT NULL,
  subject     text        NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
  transition  text        NOT NULL CHECK (transition IN ('fired', 'updated', 'renotify', 'resolved')),
  at          timestamptz NOT NULL,
  -- What to say: counts, top items, the circuit id. Game data only, never a secret or a name.
  summary     jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(summary) = 'object')
);
-- The alert log for one server, newest first.
CREATE INDEX alert_events_server_at_idx ON alerts.alert_events (server_id, at DESC);
-- Retention (90 days).
CREATE INDEX alert_events_at_idx ON alerts.alert_events (at);

CREATE TABLE alerts.server_mutes (
  server_id   uuid        PRIMARY KEY REFERENCES servers.servers (id) ON DELETE CASCADE,
  muted_until timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Down Migration
-- Forward-only in production (ADR-0025): a rollback is the previous build plus the previous .env,
-- because schema changes are additive.
