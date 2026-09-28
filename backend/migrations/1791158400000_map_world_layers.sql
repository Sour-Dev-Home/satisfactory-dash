-- Up Migration
-- ADR-0038 M3 (#353): the map's slow-changing "world" layers (rails, resourceNodes; more added as
-- their captures land), one row per (server, layer), LATEST ONLY — a new ingest overwrites the row,
-- it does not append history (unlike metrics.series_hourly or telemetry's history tables). Additive
-- only, new `map` schema (ADR-0014: one schema per module).
--
--   world_layers   `data` is the M1 contract's projected JSON (packages/shared/src/map.ts:
--                   RailsLayerDataSchema / ResourceNodesLayerDataSchema), already validated and
--                   capped (MAP_WORLD_MAX_ITEMS items, MAP_WORLD_LAYER_MAX_BYTES bytes) by the
--                   ingest route before it ever reaches this table. `hash` is the backend's content
--                   hash of `data`, reused as the GET route's ETag, so a 304 needs no re-read; a new
--                   ingest with the SAME hash writes nothing (`ON CONFLICT ... WHERE ... IS DISTINCT
--                   FROM ...` in the repository, not enforced here). `truncated` records whether this
--                   ingest's incoming item count was cut to the cap; it does NOT mean the row is
--                   incomplete forever, just that this reading was.
--
-- `mapLive` (trains, stations) is NOT stored here or anywhere: it is read-through only (ADR-0004,
-- same as status/power/factory), kept in memory and served fresh by GET .../map/live. Nothing in
-- this table is personal data: rail and resource-node geometry has no player-chosen names at all.

CREATE SCHEMA map;

GRANT USAGE ON SCHEMA map TO satis_app;
ALTER DEFAULT PRIVILEGES FOR ROLE satis_migrator IN SCHEMA map
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO satis_app;

CREATE TABLE map.world_layers (
  server_id   uuid        NOT NULL REFERENCES servers.servers (id) ON DELETE CASCADE,
  layer       text        NOT NULL CHECK (length(layer) BETWEEN 1 AND 40),
  hash        text        NOT NULL CHECK (length(hash) BETWEEN 1 AND 128),
  observed_at timestamptz NOT NULL,
  truncated   boolean     NOT NULL,
  count       integer     NOT NULL CHECK (count >= 0),
  data        jsonb       NOT NULL CHECK (jsonb_typeof(data) = 'array'),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, layer)
);

-- Down Migration
-- Forward-only in production (ADR-0025): a rollback is the previous build plus the previous .env,
-- because schema changes are additive.
