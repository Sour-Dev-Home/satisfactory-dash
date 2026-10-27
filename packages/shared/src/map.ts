import { z } from "zod";
import { snapshotEnvelope } from "./envelope";

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
 * ADR-0048's amendment adds `conveyors` (belts, lifts and pipes as connection edges, not geometry), see below.
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

export const KNOWN_MAP_WORLD_LAYERS = ["rails", "resourceNodes", "conveyors", "trainRoutes", "droneRoutes", "mapMarkers"] as const;
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
  className: z.string().max(200).optional().describe("ADR-0053 Decision 5: FRM's ClassName, e.g. Desc_OreIron_C; absent on an older layer"),
});
export const ResourceNodesLayerDataSchema = z.array(ResourceNodeSchema).max(MAP_WORLD_MAX_ITEMS);

// ---------------------------------------------------------------------------------------------------------------------
// conveyors (ADR-0048 amendment, Decision 4): every belt, lift and pipe as one edge between the two ids at its ends, for
// the bottleneck finder's connection graph. From FRM 1.5.4's getBelts/getLifts/getPipes `ConnectedTo0`/`ConnectedTo1`
// (docs-vault/raw-sources/captured-responses/frm-get{Belts,Lifts,Pipes}-2026-10-21-*.json). The game-adapter projects
// it (ADR-0048 amendment PR 2, not this contract): geometry and paint dropped, edges sorted by `id`, `at` rounded to whole
// metres, so the backend's content hash (ADR-0038: an unchanged hash writes nothing) is stable between reads.
// ---------------------------------------------------------------------------------------------------------------------

/** The conveyors layer's own item cap (ADR-0048 amendment, Decision 2): the shared `MAP_WORLD_MAX_ITEMS` (5,000) is too
 *  small for a bigger factory (the owner's tier-6 save already has about 2,400 edges). The 2 MB byte cap
 *  (`MAP_WORLD_LAYER_MAX_BYTES`, about 7,400 edges at the measured ~270 bytes an edge) still binds first; this is the
 *  schema-level sanity cap, sized for the interned or chain-folded form the ADR's 1.5 MB trigger would switch to. */
export const CONVEYORS_MAX_EDGES = 50_000;

/** What sits at one end of a conveyor, typed by the adapter from the end id's class (ADR-0048 amendment, Decision 3):
 *  `consumer` is a generator, the sink or the space elevator; `junction` a pipe junction or a pipeline pump; `conveyor`
 *  another belt, lift or pipe joined directly; `other` any class the adapter does not recognise, so a new game building
 *  never drops an edge. */
export const CONVEYOR_NODE_KINDS = [
  "machine",
  "splitter",
  "merger",
  "storage",
  "station",
  "extractor",
  "consumer",
  "junction",
  "conveyor",
  "other",
] as const;
export const ConveyorNodeKindSchema = z.enum(CONVEYOR_NODE_KINDS);

export const CONVEYOR_KINDS = ["belt", "lift", "pipe"] as const;
export const ConveyorKindSchema = z.enum(CONVEYOR_KINDS);

const conveyorEndId = z.string().min(1).max(128);
/** `{x, y}` whole metres (the layer's end-0 position, for the UI's "near (x, y)"), the same bounds as every other map
 *  coordinate in this module. */
export const ConveyorPointSchema = z.object({ x: WholeMetreSchema, y: WholeMetreSchema });

/**
 * One belt, lift or pipe. `from` is end 0 and `to` end 1 (FRM's `ConnectedTo0`/`ConnectedTo1`); `null` is an open end
 * (FRM's `""`), and an end's kind is null exactly when its id is. Belts and lifts are oriented (items enter at end 0);
 * pipes are not, so the finder reads a pipe as an arc each way (Decision 3), never from this shape.
 *
 * `capacityPerMinute` is the tier's speed (FRM's `ItemsPerMinute`: 60/120/270/480), not the flow on the conveyor. It is
 * null when the capacity is not trusted: every pipe until G-B2 settles the unit of FRM's pipe `Speed` (Risks: "pipe arcs
 * are topology only"). The contract does not force pipes to null, so G-B2 passing needs no contract change.
 */
export const ConveyorEdgeSchema = z
  .object({
    id: conveyorEndId,
    kind: ConveyorKindSchema,
    from: conveyorEndId.nullable().describe("End 0's building or conveyor id; null = open end"),
    fromKind: ConveyorNodeKindSchema.nullable(),
    to: conveyorEndId.nullable().describe("End 1's building or conveyor id; null = open end"),
    toKind: ConveyorNodeKindSchema.nullable(),
    capacityPerMinute: z
      .number()
      .finite()
      .min(0)
      .nullable()
      .describe("The tier's speed per minute (not the flow); null = not trusted (pipes until G-B2)"),
    tier: z.string().min(1).max(64).describe('The tier\'s display name, e.g. "Conveyor Belt Mk.1", "Pipeline Mk.1"'),
    at: ConveyorPointSchema.describe("End 0's position, whole metres"),
  })
  .refine((edge) => (edge.from === null) === (edge.fromKind === null) && (edge.to === null) === (edge.toKind === null), {
    message: "an end's kind is null exactly when its id is (an open end)",
  });
export const ConveyorsLayerDataSchema = z.array(ConveyorEdgeSchema).max(CONVEYORS_MAX_EDGES);

// ---------------------------------------------------------------------------------------------------------------------
// trainRoutes (ADR-0055 Decision 1): train stations with their platforms' cargo, and trains with their timetable stops
// and cargo, from getTrainStation + getTrains. Item classes only (no amounts), so the hash is stable between reads. The
// world-layer pipeline carries `data` as an array (count, truncate, per-item re-validation), so the two record types
// share one array, told apart by `recordType`. A record with an unknown `recordType` fails its item schema and is
// dropped at ingest (conform, don't reject); a new record type is therefore a new field value and not a new layer.
// ---------------------------------------------------------------------------------------------------------------------

/** Sanity cap on stations plus trains in one layer; each half matches `MAP_LIVE_MAX_*`. */
export const TRAIN_ROUTES_MAX_ITEMS = 4_000;
export const TRAIN_ROUTES_MAX_PLATFORMS = 64;
export const TRAIN_ROUTES_MAX_ITEM_CLASSES = 64;
export const TRAIN_ROUTES_MAX_STOPS = 200;

const ItemClassNames = z.array(z.string().min(1).max(200)).max(TRAIN_ROUTES_MAX_ITEM_CLASSES);

export const TrainRoutePlatformSchema = z.object({
  id: boundedString,
  mode: z.string().max(40).describe("Known: load, unload (the platform's transfer direction); a plain string so a newer mode never breaks a parse"),
  items: ItemClassNames.describe("Distinct cargo classes the platform handles; empty when unknown"),
});

export const TrainRouteStationSchema = z.object({
  recordType: z.literal("station"),
  id: boundedString,
  name: boundedString.describe("The station's in-game name, player-chosen; game text, rendered as text only. May repeat across stations."),
  platforms: z.array(TrainRoutePlatformSchema).max(TRAIN_ROUTES_MAX_PLATFORMS),
});

export const TrainRouteTrainSchema = z.object({
  recordType: z.literal("train"),
  id: boundedString,
  name: boundedString.describe("The train's in-game name, player-chosen"),
  stops: z.array(boundedString).max(TRAIN_ROUTES_MAX_STOPS).describe("Timetable stops as station names, in order"),
  items: ItemClassNames.describe("Distinct cargo classes the train carries; empty when unknown"),
});

export const TrainRouteRecordSchema = z.discriminatedUnion("recordType", [TrainRouteStationSchema, TrainRouteTrainSchema]);
export const TrainRoutesLayerDataSchema = z.array(TrainRouteRecordSchema).max(TRAIN_ROUTES_MAX_ITEMS);

// ---------------------------------------------------------------------------------------------------------------------
// droneRoutes (ADR-0055 Decision 1): drone ports with their pairing and cargo, from getDroneStation. FRM reports the
// pairing on both ports as the partner's name, not its id (raw-sources/captured-responses/
// frm-getDroneStation-2026-10-25-paired-*.json, added by PR #659), so `paired` is a name and may match more than one port. Item classes
// only, no amounts or trip rates, so the hash is stable between reads (the rates move on every trip).
// ---------------------------------------------------------------------------------------------------------------------

/** Sanity cap on drone ports in one layer, as `MAP_LIVE_MAX_STATIONS`. */
export const DRONE_ROUTES_MAX_ITEMS = 2_000;

export const DronePortSchema = z.object({
  id: boundedString,
  name: boundedString.describe("The port's in-game name, player-chosen; game text, rendered as text only. May repeat across ports."),
  paired: boundedString.nullable().describe("The paired port's name as the game reports it; null when the port is not paired. Names may repeat, so a name matching more than one port is ambiguous"),
  input: ItemClassNames.describe("Distinct item classes in the port's input inventory: the cargo it sends to its pair"),
  output: ItemClassNames.describe("Distinct item classes in the port's output inventory: the cargo it received"),
  fuel: ItemClassNames.describe("Distinct item classes in the port's fuel inventory: consumed by the drone, not carried"),
  x: WholeMetreSchema,
  y: WholeMetreSchema,
});
export const DroneRoutesLayerDataSchema = z.array(DronePortSchema).max(DRONE_ROUTES_MAX_ITEMS);

// ---------------------------------------------------------------------------------------------------------------------
// mapMarkers (ADR-0038 §1, #330): the players' map markers and stamps, from getMapMarkers
// (raw-sources/captured-responses/frm-getMapMarkers-2026-09-27-full.json; frm-read-api.md lists the endpoint as not
// game-thread). ADR-0038 keeps `{name ≤ 60 chars, icon, x, y}`; its 2026-10-26 amendment adds `id`, `kind` and `color`.
// Dropped from FRM's item: z (the map is 2-D), `Category` ("" on every captured item), `Scale` and
// `CompassViewDistance` (how the game's own HUD draws the marker, not where or what it is).
// Names are player-written text: shown only to the server's members (every map route is members-only, as station
// names are), rendered as text, and not logged by the ingest or serve paths (they never echo a body or its schema
// issues; the logger has no redaction for world-layer data, so keep it that way).
// ---------------------------------------------------------------------------------------------------------------------

/** Sanity cap on markers in one layer: the captured save has 4. Over it, the ingest truncates (conform, don't reject). */
export const MAP_MARKERS_MAX_ITEMS = 1_000;
/** ADR-0038 §1: a marker's name is kept to 60 characters (the mapper trims and cuts it). */
export const MAP_MARKER_NAME_MAX_CHARS = 60;

/**
 * Mapped from FRM's `MapMarkerType`. The capture shows exactly two values: "RT_Stamp" -> stamp and "RT_MapMarker" ->
 * marker. Any other `MapMarkerType` [NEEDS VERIFICATION: none is captured or documented] is the mapper's job to fold
 * into "marker", so this stays a closed set of what the capture evidences.
 */
export const MAP_MARKER_KINDS = ["stamp", "marker"] as const;
export const MapMarkerKindSchema = z.enum(MAP_MARKER_KINDS);

export const MapMarkerSchema = z.object({
  id: z.string().min(1).max(200).describe("FRM's `ID` (32 hex characters in the capture); stable for a React key"),
  name: z
    .string()
    .max(MAP_MARKER_NAME_MAX_CHARS)
    .describe("Player-written label, trimmed and cut to 60 characters by the mapper; may be empty. Members only, text only, not logged by the ingest or serve paths"),
  kind: MapMarkerKindSchema,
  icon: z.number().int().min(0).max(1_000_000).describe("FRM's `IconID`, the game's icon number (660 and 349 in the capture)"),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/)
    .describe(
      "#rrggbb from FRM's `ColorSlot` (8 hex digits, e.g. 6EA37BFF), read as RRGGBBAA with the alpha dropped [NEEDS VERIFICATION: byte order]; the colour players pick to tell their markers apart",
    ),
  x: WholeMetreSchema,
  y: WholeMetreSchema,
});
export const MapMarkersLayerDataSchema = z.array(MapMarkerSchema).max(MAP_MARKERS_MAX_ITEMS);

/** Each layer's item cap: what the ingest truncates an over-cap `data` array to (conform, don't reject). */
export const MAP_WORLD_LAYER_MAX_ITEMS = {
  rails: MAP_WORLD_MAX_ITEMS,
  resourceNodes: MAP_WORLD_MAX_ITEMS,
  conveyors: CONVEYORS_MAX_EDGES,
  trainRoutes: TRAIN_ROUTES_MAX_ITEMS,
  droneRoutes: DRONE_ROUTES_MAX_ITEMS,
  mapMarkers: MAP_MARKERS_MAX_ITEMS,
} satisfies Record<MapWorldLayer, number>;

/** Keyed by `MapWorldLayer`, so M3's route (`:layer` is a runtime string) can look up the right
 *  schema without a growing if/else. */
export const MAP_WORLD_LAYER_DATA_SCHEMAS = {
  rails: RailsLayerDataSchema,
  resourceNodes: ResourceNodesLayerDataSchema,
  conveyors: ConveyorsLayerDataSchema,
  trainRoutes: TrainRoutesLayerDataSchema,
  droneRoutes: DroneRoutesLayerDataSchema,
  mapMarkers: MapMarkersLayerDataSchema,
} satisfies Record<MapWorldLayer, z.ZodType>;

/** The PER-ITEM schema for one layer (a single `RailSegment`/`ResourceNode`, not the capped array).
 *  M3's ingest route re-validates each item against this after truncating an over-cap `data` array
 *  to `MAP_WORLD_MAX_ITEMS` (conform, don't reject: an item that still fails is dropped and counted,
 *  logged at warn with the layer and server id as labels — defense in depth, since the game-adapter
 *  mappers already filter bad items before the wire). */
export const MAP_WORLD_LAYER_ITEM_SCHEMAS = {
  rails: RailSegmentSchema,
  resourceNodes: ResourceNodeSchema,
  conveyors: ConveyorEdgeSchema,
  trainRoutes: TrainRouteRecordSchema,
  droneRoutes: DronePortSchema,
  mapMarkers: MapMarkerSchema,
} satisfies Record<MapWorldLayer, z.ZodType>;

/** Exported (test-hunter, PR #374): the ingest route validates a body's `observedAt` FORMAT against
 *  this directly, without parsing the whole body against `MAP_WORLD_LAYER_INGEST_SCHEMAS[layer]`
 *  (whose `.max(MAP_WORLD_MAX_ITEMS)` would reject an over-cap body outright, defeating "truncate,
 *  don't reject" for item count) — a non-ISO string must not sail through to the database as an
 *  invalid `::timestamptz` cast, turning one bad field into a hard failure of the whole ingest. */
export const IsoTimeSchema = z.iso.datetime({ offset: true });

/** POST /api/agent/world/:layer (ADR-0038 M3): what the agent or the local-server poller sends for
 *  one layer. No `layer` field in the body — the URL's `:layer` says which, and `hash`/`truncated`/
 *  `count` are the BACKEND's job to compute at ingest, not the sender's to assert. */
export const RailsWorldIngestRequestSchema = z.strictObject({ observedAt: IsoTimeSchema, data: RailsLayerDataSchema });
export const ResourceNodesWorldIngestRequestSchema = z.strictObject({ observedAt: IsoTimeSchema, data: ResourceNodesLayerDataSchema });
export const ConveyorsWorldIngestRequestSchema = z.strictObject({ observedAt: IsoTimeSchema, data: ConveyorsLayerDataSchema });
export const TrainRoutesWorldIngestRequestSchema = z.strictObject({ observedAt: IsoTimeSchema, data: TrainRoutesLayerDataSchema });
export const DroneRoutesWorldIngestRequestSchema = z.strictObject({ observedAt: IsoTimeSchema, data: DroneRoutesLayerDataSchema });
export const MapMarkersWorldIngestRequestSchema = z.strictObject({ observedAt: IsoTimeSchema, data: MapMarkersLayerDataSchema });

/** Why the conveyors projection has no layer this cycle (game-adapter's `mapConveyors` `skip`): an FRM without connection
 *  fields, or a graph over `CONVEYORS_MAX_EDGES`. */
export const CONVEYORS_SKIP_REASONS = ["unsupportedFrm", "tooManyEdges"] as const;
export const ConveyorsSkipReasonSchema = z.enum(CONVEYORS_SKIP_REASONS);

/** Additive (ADR-0007, #577): the alternative conveyors ingest body, `skipped` in place of `data`. Deliberately NO `data`
 *  field, so a backend that predates this answers 400 (its body check needs a `data` array) instead of storing an empty
 *  graph as if it were a real one. The backend stores it as a row with no edges, replacing any older layer. */
export const ConveyorsSkippedIngestRequestSchema = z.strictObject({ observedAt: IsoTimeSchema, skipped: ConveyorsSkipReasonSchema });

/** Keyed by `MapWorldLayer`, same reason as `MAP_WORLD_LAYER_DATA_SCHEMAS` above. This is the FULL
 *  ingest schema (its `data` still carries `.max(MAP_WORLD_MAX_ITEMS)`): the route uses it once an
 *  incoming body is already known to be within the item cap (after its own truncate-and-count-
 *  dropped pass against `MAP_WORLD_LAYER_ITEM_SCHEMAS`), not to parse the raw body directly. */
export const MAP_WORLD_LAYER_INGEST_SCHEMAS = {
  rails: RailsWorldIngestRequestSchema,
  resourceNodes: ResourceNodesWorldIngestRequestSchema,
  conveyors: ConveyorsWorldIngestRequestSchema,
  trainRoutes: TrainRoutesWorldIngestRequestSchema,
  droneRoutes: DroneRoutesWorldIngestRequestSchema,
  mapMarkers: MapMarkersWorldIngestRequestSchema,
} satisfies Record<MapWorldLayer, z.ZodType>;

/** 200/202. What POST /agent/v1/world/:layer answers: `unchanged` is true when the content hash
 *  matched what was already stored, so nothing was written (ADR-0038 M3's "an unchanged hash writes
 *  nothing"). Never the hash itself: the sender doesn't need it back. */
export const WorldIngestResponseSchema = z.object({ accepted: z.boolean(), unchanged: z.boolean() });

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
    layer: z.string().describe("Known: rails, resourceNodes, conveyors, trainRoutes, droneRoutes, mapMarkers; more are added as their captures land (ADR-0038)"),
    hash: z.string().min(1),
    observedAt: IsoTimeSchema,
    truncated: z.boolean(),
    count: z.number().int().min(0),
    data: dataSchema,
  });
}
export const RailsWorldLayerResponseSchema = worldLayerResponseSchema(RailsLayerDataSchema);
export const ResourceNodesWorldLayerResponseSchema = worldLayerResponseSchema(ResourceNodesLayerDataSchema);
export const ConveyorsWorldLayerResponseSchema = worldLayerResponseSchema(ConveyorsLayerDataSchema);
export const TrainRoutesWorldLayerResponseSchema = worldLayerResponseSchema(TrainRoutesLayerDataSchema);
export const DroneRoutesWorldLayerResponseSchema = worldLayerResponseSchema(DroneRoutesLayerDataSchema);
export const MapMarkersWorldLayerResponseSchema = worldLayerResponseSchema(MapMarkersLayerDataSchema);
/** For the endpoint registry (endpoints.ts), which needs one static schema per route: the client
 *  re-validates against the specific layer's schema via `MAP_WORLD_LAYER_DATA_SCHEMAS`, same as the
 *  route itself does at write time. */
export const MapWorldLayerResponseSchema = z.union([
  RailsWorldLayerResponseSchema,
  ResourceNodesWorldLayerResponseSchema,
  ConveyorsWorldLayerResponseSchema,
  TrainRoutesWorldLayerResponseSchema,
  DroneRoutesWorldLayerResponseSchema,
  MapMarkersWorldLayerResponseSchema,
]);

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

/** GET /api/servers/:serverId/map/live (ADR-0038 M3/M6): the ADR-0004 snapshot envelope around
 *  `MapLiveSchema` — read-through only, never stored (unlike the world layers above). */
export const MapLiveResponseSchema = snapshotEnvelope(MapLiveSchema);

export type RailSegment = z.infer<typeof RailSegmentSchema>;
export type RailsLayerData = z.infer<typeof RailsLayerDataSchema>;
export type ResourceNode = z.infer<typeof ResourceNodeSchema>;
export type ResourceNodesLayerData = z.infer<typeof ResourceNodesLayerDataSchema>;
export type RailsWorldIngestRequest = z.input<typeof RailsWorldIngestRequestSchema>;
export type ResourceNodesWorldIngestRequest = z.input<typeof ResourceNodesWorldIngestRequestSchema>;
export type RailsWorldLayerResponse = z.infer<typeof RailsWorldLayerResponseSchema>;
export type ResourceNodesWorldLayerResponse = z.infer<typeof ResourceNodesWorldLayerResponseSchema>;
export type ConveyorKind = z.infer<typeof ConveyorKindSchema>;
export type ConveyorNodeKind = z.infer<typeof ConveyorNodeKindSchema>;
export type ConveyorEdge = z.infer<typeof ConveyorEdgeSchema>;
export type ConveyorsLayerData = z.infer<typeof ConveyorsLayerDataSchema>;
export type ConveyorsWorldIngestRequest = z.input<typeof ConveyorsWorldIngestRequestSchema>;
export type ConveyorsSkipReason = z.infer<typeof ConveyorsSkipReasonSchema>;
export type ConveyorsSkippedIngestRequest = z.input<typeof ConveyorsSkippedIngestRequestSchema>;
export type ConveyorsWorldLayerResponse = z.infer<typeof ConveyorsWorldLayerResponseSchema>;
export type TrainRoutePlatform = z.infer<typeof TrainRoutePlatformSchema>;
export type TrainRouteStation = z.infer<typeof TrainRouteStationSchema>;
export type TrainRouteTrain = z.infer<typeof TrainRouteTrainSchema>;
export type TrainRouteRecord = z.infer<typeof TrainRouteRecordSchema>;
export type TrainRoutesLayerData = z.infer<typeof TrainRoutesLayerDataSchema>;
export type TrainRoutesWorldIngestRequest = z.input<typeof TrainRoutesWorldIngestRequestSchema>;
export type TrainRoutesWorldLayerResponse = z.infer<typeof TrainRoutesWorldLayerResponseSchema>;
export type DronePort = z.infer<typeof DronePortSchema>;
export type DroneRoutesLayerData = z.infer<typeof DroneRoutesLayerDataSchema>;
export type DroneRoutesWorldIngestRequest = z.input<typeof DroneRoutesWorldIngestRequestSchema>;
export type DroneRoutesWorldLayerResponse = z.infer<typeof DroneRoutesWorldLayerResponseSchema>;
export type MapMarkerKind = z.infer<typeof MapMarkerKindSchema>;
export type MapMarker = z.infer<typeof MapMarkerSchema>;
export type MapMarkersLayerData = z.infer<typeof MapMarkersLayerDataSchema>;
export type MapMarkersWorldIngestRequest = z.input<typeof MapMarkersWorldIngestRequestSchema>;
export type MapMarkersWorldLayerResponse = z.infer<typeof MapMarkersWorldLayerResponseSchema>;
export type MapTrain = z.infer<typeof MapTrainSchema>;
export type MapTrainStation = z.infer<typeof MapTrainStationSchema>;
export type MapLive = z.infer<typeof MapLiveSchema>;
export type MapLiveResponse = z.infer<typeof MapLiveResponseSchema>;
export type MapWorldLayerResponse = z.infer<typeof MapWorldLayerResponseSchema>;
export type WorldIngestResponse = z.infer<typeof WorldIngestResponseSchema>;
