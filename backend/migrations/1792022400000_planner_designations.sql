-- Up Migration
-- ADR-0055 Decision 5: Planner designations, a player's named sets of buildings.
--
--   map.factory_designations   one row per designation. `members` is a jsonb array of { id, c, x, y } (the game's building
--                              id or null, its class, whole metres), at most 1000 entries. Matching a member against the
--                              live factory is a read-time computation and is never stored. No user id is stored (an audit
--                              event records who changed what). Gone with the server.
--
-- Additive: one new table in the existing map schema (default privileges already grant satis_app its DML).

CREATE TABLE map.factory_designations (
  server_id  uuid        NOT NULL REFERENCES servers.servers (id) ON DELETE CASCADE,
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  name       text        NOT NULL CHECK (length(name) BETWEEN 1 AND 64),
  mode       text        NOT NULL CHECK (mode = 'core'),
  members    jsonb       NOT NULL CHECK (jsonb_typeof(members) = 'array' AND jsonb_array_length(members) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, id)
);

-- Down Migration
-- Forward-only in production (ADR-0025): a rollback is the previous build plus the previous .env,
-- because schema changes are additive.
