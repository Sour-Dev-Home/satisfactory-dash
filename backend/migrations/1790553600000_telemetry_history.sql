-- Up Migration
-- ADR-0027 PR 3: production history. A new `telemetry` schema (ADR-0014: one schema per module) holding raw samples,
-- rollups and building-state transitions. Additive only. Hand-written SQL, plain tables, no partitioning yet (ADR-0027
-- decision 3: about 86k power rows and 150-300k item rows per server per day, raw data kept 48 hours).
--
--   power_samples       every 5 s per circuit         raw, kept 48 h
--   item_samples        every 30 s per item (factory-wide sum)   raw, kept 48 h
--   power_rollups / item_rollups   1 minute (kept 30 d) and 1 hour (kept 1 y), written by an idempotent job
--   building_transitions  events (a machine changed state), kept 30 d
--
-- Nothing here is personal data: it describes the game world (ADR-0027, privacy page).

CREATE SCHEMA IF NOT EXISTS telemetry;

GRANT USAGE ON SCHEMA telemetry TO satis_app;
ALTER DEFAULT PRIVILEGES FOR ROLE satis_migrator IN SCHEMA telemetry
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO satis_app;
ALTER DEFAULT PRIVILEGES FOR ROLE satis_migrator IN SCHEMA telemetry
  GRANT USAGE, SELECT ON SEQUENCES TO satis_app;

-- `session` is a 32-bit hash of the game session's name: FRM's circuit ids are not known to survive a reload
-- (ADR-0006), so a series must never span a session change.
CREATE TABLE telemetry.power_samples (
  server_id      uuid             NOT NULL REFERENCES servers.servers (id) ON DELETE CASCADE,
  session        integer          NOT NULL,
  circuit        integer          NOT NULL,
  at             timestamptz      NOT NULL,
  production_mw  double precision NOT NULL,
  consumption_mw double precision NOT NULL,
  capacity_mw    double precision NOT NULL,
  battery_pct    double precision NOT NULL,
  fuse_tripped   boolean          NOT NULL,
  PRIMARY KEY (server_id, session, circuit, at)
);
CREATE INDEX power_samples_at_idx ON telemetry.power_samples (at);

CREATE TABLE telemetry.power_rollups (
  server_id       uuid             NOT NULL REFERENCES servers.servers (id) ON DELETE CASCADE,
  session         integer          NOT NULL,
  circuit         integer          NOT NULL,
  -- Bucket length in seconds: 60 or 3600.
  resolution      smallint         NOT NULL CHECK (resolution IN (60, 3600)),
  bucket          timestamptz      NOT NULL,
  samples         integer          NOT NULL CHECK (samples > 0),
  production_min  double precision NOT NULL,
  production_avg  double precision NOT NULL,
  production_max  double precision NOT NULL,
  consumption_min double precision NOT NULL,
  consumption_avg double precision NOT NULL,
  consumption_max double precision NOT NULL,
  capacity_avg    double precision NOT NULL,
  battery_min     double precision NOT NULL,
  battery_avg     double precision NOT NULL,
  battery_max     double precision NOT NULL,
  -- How many of the samples had the fuse tripped (0 = never in this bucket).
  fuse_samples    integer          NOT NULL CHECK (fuse_samples >= 0),
  PRIMARY KEY (server_id, session, circuit, resolution, bucket)
);
CREATE INDEX power_rollups_bucket_idx ON telemetry.power_rollups (resolution, bucket);

CREATE TABLE telemetry.item_samples (
  server_id       uuid             NOT NULL REFERENCES servers.servers (id) ON DELETE CASCADE,
  item            text             NOT NULL CHECK (length(item) BETWEEN 1 AND 200),
  at              timestamptz      NOT NULL,
  -- Factory-wide sums of the per-minute rates over every building that produces the item.
  current_per_min double precision NOT NULL CHECK (current_per_min >= 0),
  max_per_min     double precision NOT NULL CHECK (max_per_min >= 0),
  PRIMARY KEY (server_id, item, at)
);
CREATE INDEX item_samples_at_idx ON telemetry.item_samples (at);

CREATE TABLE telemetry.item_rollups (
  server_id       uuid             NOT NULL REFERENCES servers.servers (id) ON DELETE CASCADE,
  item            text             NOT NULL,
  resolution      smallint         NOT NULL CHECK (resolution IN (60, 3600)),
  bucket          timestamptz      NOT NULL,
  samples         integer          NOT NULL CHECK (samples > 0),
  current_min     double precision NOT NULL,
  current_avg     double precision NOT NULL,
  current_max     double precision NOT NULL,
  max_avg         double precision NOT NULL,
  PRIMARY KEY (server_id, item, resolution, bucket)
);
CREATE INDEX item_rollups_bucket_idx ON telemetry.item_rollups (resolution, bucket);

-- Events, not samples: a machine moved from one state to another. building_id is FRM's opaque id (only meaningful
-- within a game session; ADR-0006), kept with the class name so an event can be read on its own.
CREATE TABLE telemetry.building_transitions (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  server_id   uuid        NOT NULL REFERENCES servers.servers (id) ON DELETE CASCADE,
  at          timestamptz NOT NULL,
  building_id text        NOT NULL CHECK (length(building_id) BETWEEN 1 AND 200),
  class_name  text        NOT NULL CHECK (length(class_name) BETWEEN 1 AND 200),
  from_state  text        CHECK (from_state IS NULL OR length(from_state) BETWEEN 1 AND 40),
  to_state    text        NOT NULL CHECK (length(to_state) BETWEEN 1 AND 40)
);
CREATE INDEX building_transitions_server_at_idx ON telemetry.building_transitions (server_id, at DESC);
CREATE INDEX building_transitions_at_idx ON telemetry.building_transitions (at);

-- Down Migration
-- Forward-only in production (ADR-0025): a rollback is the previous build plus the previous .env,
-- because schema changes are additive.
