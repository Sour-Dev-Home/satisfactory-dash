- 2026-09-28 — ADR-0038 M3 (#353): the map's world layers now have a home on the backend. A new
  `map` schema (`map.world_layers`, latest only, one row per server+layer) stores rails and
  resourceNodes; `POST /agent/v1/world/:layer` (agent-authed, gzip, capped at
  `MAP_WORLD_LAYER_MAX_BYTES` decompressed) and a new local-server poller (rails every 10 min
  jittered, resourceNodes every 30 min, mapLive at the 30 s factory cadence) both feed it through
  one shared `WorldIngestService`: an over-cap item count is truncated (never rejected), each
  surviving item is re-validated against its per-item schema as defense in depth (a drop is
  counted and logged at warn), and a hash match with what's already stored writes nothing.
  `GET /api/servers/:serverId/map/world/:layer` serves it with an ETag/304 (no stored row yet is a
  200 synthetic empty response, not a 404); `GET .../map/live` serves `mapLive` (trains, stations)
  read-through from a new in-memory `MapLiveStore`, fed either by the local poller or, for an
  agent-backed server, by a narrow port telemetry's `AgentIngest` now calls into — no module edge
  to `map` was needed for that. `packages/game-adapter` gained `getTrains`/`getTrainStations`
  adapter methods and their mappers (M2's rails/resourceNodes pattern, extended), grounded in the
  `frm-getTrains`/`frm-getTrainStation` captures. `packages/shared` gained the per-item and
  ingest-response schemas the ingest service and routes need, plus the three new endpoint entries
  (and now exports `IsoTimeSchema`, used to reject a non-ISO `observedAt` before it can reach the
  database as an invalid `timestamptz` cast). The world-ingest route is rate-limited per credential
  across every layer (20/10 min, same 429+Retry-After convention as the snapshot route) — a review
  finding, since a valid credential could otherwise loop 2 MB upserts. Fresh-eyes test-hunter (2
  rounds) found and fixed two real bugs: that missing `observedAt` format check, and `MapLiveStore`
  storing a reading with no validation at all (an oversized train/station name from the local poller
  could later break `GET .../map/live` for everyone); it now conforms a reading before storing it,
  same drop-and-count pattern `WorldIngestService` already uses for world layers.
