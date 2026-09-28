import { z } from "zod";

/**
 * ADR-0038 build card M1 (#352, Refs #330): the map's world-layer contract. "World" layers are the
 * slow-changing geography an agent or poller reads on-change or every 10-30 min (rails today;
 * resource nodes; more as their captures land, ADR-0038 §1) — distinct from `mapLive` below, which
 * carries fast-changing positions at the snapshot/live-poll cadence.
 *
 * SCOPE (per #352's comment, after the #360 captures): this PR covers `rails` and `resourceNodes`
 * only; belts, pipes, cables and wells are captured (docs-vault/raw-sources/captured-responses/) but
 * not yet built into a layer. `getResourceGeyser`'s empty `[]` capture is now explained (M2, #353
 * follow-up): geysers arrive through `getResourceNode` too, with `NodeType: "Geyser"` — the
 * `resourceNodes` layer already covers them, so there is no separate geyser layer to build.
 *
 * PROJECTION: every coordinate here is a WHOLE METRE (the game's own unit is the centimetre,
 * docs-vault/raw-sources/world-coordinates.md), rounded by whichever mapper produced the data
 * (`packages/game-adapter`, ADR-0038 M2 — not this PR). The contract only bounds the projected
 * shape; it does not do the projecting.
 *
 * DEPLOY SKEW: `layer`, `type` and `purity` below are plain strings with known values in
 * `.describe()`, never an enum, for the same reason as `agent.ts`'s response fields — an older
 * frontend must still parse a response naming a layer or a resource it doesn't yet recognize.
 *
 * SIZE (#352 addition b): the 2 MB per-layer cap (`MAP_WORLD_LAYER_MAX_BYTES`) is measured on the
 * serialized projected JSON (this contract's shapes, uncompressed) by the sender — the agent for an
 * agent server, the backend's own poller for a local one — and enforced again at ingest (ADR-0038
 * M3, `POST /api/agent/world/:layer`). It is a body-size guard on the raw bytes, not a schema
 * `.refine()`: measuring `JSON.stringify(...).length` inside zod would duplicate, and be slower
 * than, a plain pre-parse `Content-Length`/byte check the route handler already needs for any
 * capped body (compare `agent.ts`'s snapshot size limit). This module's own caps (item counts,
 * string lengths) are the schema-level defence in depth: even a body under 2 MB is refused if it
 * tries to smuggle an oversized string or an implausible item count.
 *
 * `docs-vault/wiki/frm-endpoint-volumes.md`'s watch item: simplify belts (Douglas-Peucker at about
 * 2 m) if a future belts layer's projected size passes about 1.5 MB — not needed for rails
 * (65 segments, 17-127 points each, in the captured world) or resourceNodes (608 items).
 */

export const KNOWN_MAP_WORLD_LAYERS = ["rails", "resourceNodes"] as const;
export type MapWorldLayer = (typeof KNOWN_MAP_WORLD_LAYERS)[number];

/** Measured on the serialized projected JSON, uncompressed, by the sender; enforced again at ingest (see above). */
export const MAP_WORLD_LAYER_MAX_BYTES = 2_000_000;

/** Well above the captured world's 127-point longest rail segment (docs-vault/raw-sources/
 *  captured-responses/frm-getTrainRails-2026-09-27-trimmed.json) — a sanity cap, not a tight fit. */
export const MAP_WORLD_MAX_POLYLINE_POINTS = 1_000;
/** Well above the captured world's 65 rails and 608 resource nodes (frm-endpoint-volumes.md) — a
 *  sanity cap on a single ingest, not a prediction of how big a factory's world data can get. */
export const MAP_WORLD_MAX_ITEMS = 5_000;

const WholeMetreSchema = z.number().int().finite().min(-1_000_000).max(1_000_000);
/** [x, y], whole metres, world space (+x east, +y south — world-coordinates.md). An array, not
 *  {x, y}: half the bytes per point, which matters once belts/pipes/cables (dc, #352a) reuse this
 *  for a layer with thousands of points. */
export const PolylinePointSchema = z.tuple([WholeMetreSchema, WholeMetreSchema]);
/** #352 addition (a): one shared Polyline schema. Rails use it now; belts, pipes and cables (each
 *  point pair) reuse it later. At least 2 points: a line needs two ends. */
export const PolylineSchema = z.array(PolylinePointSchema).min(2).max(MAP_WORLD_MAX_POLYLINE_POINTS);

const boundedString = z.string().max(200);

/** A projected rail segment: an id (for a React key / re-render diffing) and its polyline. Connection
 *  state and the game's own Length are FRM-source facts the map doesn't need to draw a line; M2
 *  decides whether a later layer wants them, not this contract. */
export const RailSegmentSchema = z.object({
  id: boundedString,
  points: PolylineSchema,
});
export const RailsLayerDataSchema = z.array(RailSegmentSchema).max(MAP_WORLD_MAX_ITEMS);

/** A resource node, a fracking satellite or a geyser: one point on the map. `type` is the resource's
 *  name (Iron Ore, Crude Oil, SAM, ...; FRM's `Name`). `nodeType` is a 6th field added after #352's
 *  initial `{type, purity, x, y, exploited}`: the architect's own `getResourceNode` capture
 *  (docs-vault/raw-sources/captured-responses/frm-getResourceNode-2026-09-27-trimmed.json) already
 *  returns `NodeType: "Node"` and `"Fracking Satellite"` from this ONE endpoint, and the map needs
 *  to draw them differently (a different icon; only a Node is a "miner" buildable) — without the
 *  field there is no way to tell them apart. A live server also returns `NodeType: "Geyser"` here
 *  (M2, #353 follow-up: the endpoint-volumes capture just never sampled one), which explains why
 *  `getResourceGeyser` answered `[]` — geysers were never missing, just reached through this
 *  endpoint instead. */
export const ResourceNodeSchema = z.object({
  type: boundedString.describe("The resource's name, e.g. Iron Ore, Crude Oil, SAM. Grows with the game's resource list."),
  purity: z.string().max(40).describe("Known: impure, normal, pure (FRM's Purity field, lowercased; its 'Inpure' typo is corrected to 'impure')"),
  nodeType: z.string().max(40).describe("Known: node, frackingSatellite, geyser (FRM's NodeType, camelCased)"),
  x: WholeMetreSchema,
  y: WholeMetreSchema,
  exploited: z.boolean(),
});
export const ResourceNodesLayerDataSchema = z.array(ResourceNodeSchema).max(MAP_WORLD_MAX_ITEMS);

/** Keyed by `MapWorldLayer`, so M3's route (`:layer` is a runtime string) can look up the right
 *  schema without a growing if/else. */
export const MAP_WORLD_LAYER_DATA_SCHEMAS = {
  rails: RailsLayerDataSchema,
  resourceNodes: ResourceNodesLayerDataSchema,
} satisfies Record<MapWorldLayer, z.ZodType>;

const IsoTimeSchema = z.iso.datetime({ offset: true });

/** POST /api/agent/world/:layer (ADR-0038 M3): what the agent or the local-server poller sends for
 *  one layer. No `layer` field in the body — the URL's `:layer` says which, and `hash`/`truncated`/
 *  `count` are the BACKEND's job to compute at ingest, not the sender's to assert. */
export const RailsWorldIngestRequestSchema = z.strictObject({ observedAt: IsoTimeSchema, data: RailsLayerDataSchema });
export const ResourceNodesWorldIngestRequestSchema = z.strictObject({ observedAt: IsoTimeSchema, data: ResourceNodesLayerDataSchema });

/**
 * GET /api/servers/:id/map/world/:layer (ADR-0038 M3): one wrapper shape, reused for every layer
 * (matches `envelope.ts`'s `snapshotEnvelope` pattern). `hash` is the backend's content hash of
 * `data` (also served as the route's ETag, so a 304 needs no re-send); `truncated` is true when
 * `data` was cut to `MAP_WORLD_MAX_ITEMS`, so the client knows the layer is incomplete rather than
 * assuming the world really has that few items; `count` is `data.length`, a convenience so a client
 * can show a count without holding `data` itself while it's still loading.
 */
export function worldLayerResponseSchema<T extends z.ZodType>(dataSchema: T) {
  return z.object({
    layer: z.string().describe("Known: rails, resourceNodes; more are added as their captures land (ADR-0038)"),
    hash: z.string().min(1),
    observedAt: IsoTimeSchema,
    truncated: z.boolean(),
    count: z.number().int().min(0),
    data: dataSchema,
  });
}
export const RailsWorldLayerResponseSchema = worldLayerResponseSchema(RailsLayerDataSchema);
export const ResourceNodesWorldLayerResponseSchema = worldLayerResponseSchema(ResourceNodesLayerDataSchema);

// ---------------------------------------------------------------------------------------------------------------------
// mapLive: fast-changing positions, part of the AGENT's snapshot (agent.ts's SnapshotRequestSchema), not the world
// layers above. ADR-0038 M4 sends it; M6 (frontend) polls GET .../map/live, which reuses this same shape.
// ---------------------------------------------------------------------------------------------------------------------

export const MAP_LIVE_MAX_TRAINS = 2_000;
export const MAP_LIVE_MAX_STATIONS = 2_000;

/** From getTrains (docs-vault/raw-sources/captured-responses/frm-getTrains-2026-09-27-full.json):
 *  one self-driving train's position and status. `status` passes FRM's own `Status` field through
 *  as-is (Self-Driving, Manual, ... — a game-defined string, not one this contract enumerates). */
export const MapTrainSchema = z.object({
  id: boundedString,
  name: boundedString.describe("The train's in-game name, player-chosen"),
  x: WholeMetreSchema,
  y: WholeMetreSchema,
  status: boundedString.describe("FRM's own Status field, passed through (e.g. Self-Driving, Manual)"),
});

/** From getTrainStation: a station's position and label, for the map to place a marker (docking
 *  platform detail, cargo and power are not the map's concern). */
export const MapTrainStationSchema = z.object({
  id: boundedString,
  name: boundedString.describe("The station's in-game name, player-chosen"),
  x: WholeMetreSchema,
  y: WholeMetreSchema,
});

export const MapLiveSchema = z.object({
  trains: z.array(MapTrainSchema).max(MAP_LIVE_MAX_TRAINS),
  stations: z.array(MapTrainStationSchema).max(MAP_LIVE_MAX_STATIONS),
});

export type RailSegment = z.infer<typeof RailSegmentSchema>;
export type RailsLayerData = z.infer<typeof RailsLayerDataSchema>;
export type ResourceNode = z.infer<typeof ResourceNodeSchema>;
export type ResourceNodesLayerData = z.infer<typeof ResourceNodesLayerDataSchema>;
export type RailsWorldIngestRequest = z.input<typeof RailsWorldIngestRequestSchema>;
export type ResourceNodesWorldIngestRequest = z.input<typeof ResourceNodesWorldIngestRequestSchema>;
export type RailsWorldLayerResponse = z.infer<typeof RailsWorldLayerResponseSchema>;
export type ResourceNodesWorldLayerResponse = z.infer<typeof ResourceNodesWorldLayerResponseSchema>;
export type MapTrain = z.infer<typeof MapTrainSchema>;
export type MapTrainStation = z.infer<typeof MapTrainStationSchema>;
export type MapLive = z.infer<typeof MapLiveSchema>;
