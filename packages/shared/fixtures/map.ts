import type {
  ConveyorsWorldIngestRequest,
  ConveyorsWorldLayerResponse,
  DroneRoutesWorldIngestRequest,
  DroneRoutesWorldLayerResponse,
  MapLive,
  RailsWorldIngestRequest,
  RailsWorldLayerResponse,
  ResourceNodesWorldIngestRequest,
  ResourceNodesWorldLayerResponse,
  TrainRoutesWorldIngestRequest,
  TrainRoutesWorldLayerResponse,
} from "../src/index";

/**
 * ADR-0038 M1 (#352): fixtures projected from the #334-era captures
 * (docs-vault/raw-sources/captured-responses/frm-getTrainRails-2026-09-27-trimmed.json,
 * frm-getResourceNode-2026-09-27-trimmed.json, frm-getTrains-2026-09-27-full.json,
 * frm-getTrainStation-2026-09-27-full.json). Coordinates are the captures' `location`/`SplineData`
 * x/y, divided by 100 (the game unit is the centimetre, world-coordinates.md) and rounded to the
 * nearest whole metre — exactly what ADR-0038 M2's mapper will do, not this PR's job to build.
 */

/** The shortest captured rail segment (17 raw spline points), projected. The game's spline is far
 *  finer than a whole metre, so several adjacent points round to the same value — M2's mapper
 *  collapses those consecutive duplicates (architect follow-up on #367), leaving 13 of the 17. */
export const railsSample = {
  observedAt: "2026-09-27T04:54:27.000Z",
  data: [
    {
      id: "Build_RailroadTrack_C_2147304732",
      points: [
        [-1119, -1504], [-1118, -1504], [-1117, -1504], [-1116, -1504], [-1115, -1504], [-1114, -1504],
        [-1113, -1504], [-1112, -1504], [-1111, -1504], [-1110, -1504], [-1109, -1504], [-1108, -1504],
        [-1107, -1504],
      ],
    },
  ],
} satisfies RailsWorldIngestRequest;

export const railsWorldResponse = {
  layer: "rails",
  hash: "sha256-rails-sample",
  observedAt: railsSample.observedAt,
  truncated: false,
  count: railsSample.data.length,
  data: railsSample.data,
} satisfies RailsWorldLayerResponse;

/** No rails on this server (or the layer hasn't been read yet): an empty, still-valid response. */
export const railsWorldResponseEmpty = {
  layer: "rails",
  hash: "sha256-empty",
  observedAt: "2026-09-27T04:54:27.000Z",
  truncated: false,
  count: 0,
  data: [],
} satisfies RailsWorldLayerResponse;

/** SYNTHETIC: shows the shape of a response the backend truncated (e.g. a world with more rails
 *  than MAP_WORLD_MAX_ITEMS) — `data`/`count` are what SURVIVED the cut, not the original total;
 *  the schema has no field for how much was dropped, only that some was. */
export const railsWorldResponseTruncated = {
  ...railsWorldResponse,
  truncated: true,
  count: railsWorldResponse.data.length,
} satisfies RailsWorldLayerResponse;

/** Seven of the fourteen captured resource-type/purity/nodeType/exploited combinations, projected.
 *  Purity is lowercased from FRM's own Purity field (Normal, Impure, Pure — not the separate
 *  EnumPurity field, RP_Normal/RP_Inpure/RP_Pure, which lowercases to nothing anyone uses).
 *  nodeType is FRM's NodeType, camelCased ("Node" -> "node", "Fracking Satellite" ->
 *  "frackingSatellite"): six Node items plus one Fracking Satellite, since the capture has both
 *  from this one endpoint (architect, #352 follow-up). */
export const resourceNodesSample = {
  observedAt: "2026-09-27T04:54:27.000Z",
  data: [
    { type: "Crude Oil", purity: "normal", nodeType: "node", x: 1783, y: 2061, exploited: false, className: "Desc_LiquidOil_C" },
    { type: "SAM", purity: "impure", nodeType: "node", x: 1619, y: 1038, exploited: false, className: "Desc_SAM_C" },
    { type: "SAM", purity: "pure", nodeType: "node", x: 1629, y: 654, exploited: false, className: "Desc_SAM_C" },
    { type: "Limestone", purity: "normal", nodeType: "node", x: -2808, y: -421, exploited: false, className: "Desc_Stone_C" },
    { type: "Coal", purity: "normal", nodeType: "node", x: -996, y: -1468, exploited: true, className: "Desc_Coal_C" },
    { type: "Iron Ore", purity: "pure", nodeType: "node", x: -1106, y: -1352, exploited: true, className: "Desc_OreIron_C" },
    { type: "Nitrogen Gas", purity: "pure", nodeType: "frackingSatellite", x: 2125, y: 1381, exploited: false, className: "Desc_NitrogenGas_C" },
  ],
} satisfies ResourceNodesWorldIngestRequest;

export const resourceNodesWorldResponse = {
  layer: "resourceNodes",
  hash: "sha256-resource-nodes-sample",
  observedAt: resourceNodesSample.observedAt,
  truncated: false,
  count: resourceNodesSample.data.length,
  data: resourceNodesSample.data,
} satisfies ResourceNodesWorldLayerResponse;

export const resourceNodesWorldResponseEmpty = {
  layer: "resourceNodes",
  hash: "sha256-empty",
  observedAt: "2026-09-27T04:54:27.000Z",
  truncated: false,
  count: 0,
  data: [],
} satisfies ResourceNodesWorldLayerResponse;

/** From getTrains and getTrainStation: the one captured train, self-driving between the two
 *  captured stations, projected to whole metres. */
export const mapLiveSample = {
  trains: [
    { id: "BP_Train_C_2146471703", name: "Silica/Crystal - Computer Dropoff", x: -1026, y: -1473, status: "Self-Driving" },
  ],
  stations: [
    { id: "Build_TrainStation_C_2147412474", name: "Silica/Crstal Out ", x: -1043, y: -1473 },
    { id: "Build_TrainStation_C_2146503764", name: "Computer-Dropoff", x: -1952, y: -1144 },
  ],
} satisfies MapLive;

/** No trains or stations built yet. */
export const mapLiveEmpty = { trains: [], stations: [] } satisfies MapLive;

/**
 * ADR-0048 amendment (Decision 4): the conveyors layer projected from the 2026-10-21 captures
 * (docs-vault/raw-sources/captured-responses/frm-getBelts-2026-10-21-connections-trimmed.json, all 7 kept belts;
 * frm-getLifts-2026-10-21-trimmed.json, both lifts; frm-getPipes-2026-10-21-connections-trimmed.json, both pipes), the
 * way the amendment's PR 2 mapper will: `ConnectedTo0`/`ConnectedTo1` to `from`/`to` (`""` to null), each end's kind
 * from its class, `ItemsPerMinute` to `capacityPerMinute` (null for every pipe until G-B2), `Name` to `tier`, `location0`
 * x/y divided by 100 and rounded to whole metres, sorted by `id`. Covers: a miner-fed belt, a splitter to a constructor,
 * a belt-to-belt join seen from both belts, a Mk.4 merger to merger, a belt into a generator, an open end, a lift between
 * storages, a lift out of a refinery onto a belt, a pipe from a water extractor and a pipe with an open end.
 */
export const conveyorsSample = {
  observedAt: "2026-10-21T15:03:00.000Z",
  data: [
    {
      id: "Build_ConveyorBeltMk1_C_2146952248",
      kind: "belt",
      from: "Build_ConveyorAttachmentSplitter_C_2146955812",
      fromKind: "splitter",
      to: "Build_GeneratorBiomass_Automated_C_2146972747",
      toKind: "consumer",
      capacityPerMinute: 60,
      tier: "Conveyor Belt Mk.1",
      at: { x: -544, y: -1432 },
    },
    {
      id: "Build_ConveyorBeltMk1_C_2146953393",
      kind: "belt",
      from: "Build_ConveyorAttachmentSplitter_C_2146953396",
      fromKind: "splitter",
      to: null,
      toKind: null,
      capacityPerMinute: 60,
      tier: "Conveyor Belt Mk.1",
      at: { x: -600, y: -1431 },
    },
    {
      id: "Build_ConveyorBeltMk1_C_2146977182",
      kind: "belt",
      from: "Build_ConveyorBeltMk1_C_2146979166",
      fromKind: "conveyor",
      to: "Build_ConveyorBeltMk1_C_2146976023",
      toKind: "conveyor",
      capacityPerMinute: 60,
      tier: "Conveyor Belt Mk.1",
      at: { x: -534, y: -1270 },
    },
    {
      id: "Build_ConveyorBeltMk1_C_2146979166",
      kind: "belt",
      from: "Build_ConveyorAttachmentMerger_C_2146982118",
      fromKind: "merger",
      to: "Build_ConveyorBeltMk1_C_2146977182",
      toKind: "conveyor",
      capacityPerMinute: 60,
      tier: "Conveyor Belt Mk.1",
      at: { x: -553, y: -1260 },
    },
    {
      id: "Build_ConveyorBeltMk1_C_2146994301",
      kind: "belt",
      from: "Build_MinerMk1_C_2147011597",
      fromKind: "extractor",
      to: "Build_ConveyorAttachmentSplitter_C_2146996403",
      toKind: "splitter",
      capacityPerMinute: 60,
      tier: "Conveyor Belt Mk.1",
      at: { x: -556, y: -1286 },
    },
    {
      id: "Build_ConveyorBeltMk1_C_2146995466",
      kind: "belt",
      from: "Build_ConveyorAttachmentSplitter_C_2146996403",
      fromKind: "splitter",
      to: "Build_ConstructorMk1_C_2147002363",
      toKind: "machine",
      capacityPerMinute: 60,
      tier: "Conveyor Belt Mk.1",
      at: { x: -554, y: -1278 },
    },
    {
      id: "Build_ConveyorBeltMk4_C_2147211837",
      kind: "belt",
      from: "Build_ConveyorAttachmentMerger_C_2147222312",
      fromKind: "merger",
      to: "Build_ConveyorAttachmentMerger_C_2147381846",
      toKind: "merger",
      capacityPerMinute: 480,
      tier: "Conveyor Belt Mk.4",
      at: { x: 602, y: -630 },
    },
    {
      id: "Build_ConveyorLiftMk1_C_2146826510",
      kind: "lift",
      from: "Build_OilRefinery_C_2146845148",
      fromKind: "machine",
      to: "Build_ConveyorBeltMk3_C_2146694474",
      toKind: "conveyor",
      capacityPerMinute: 60,
      tier: "Conveyor Lift Mk.1",
      at: { x: -367, y: -1906 },
    },
    {
      id: "Build_ConveyorLiftMk3_C_2147447582",
      kind: "lift",
      from: "Build_StorageContainerMk2_C_2146542989",
      fromKind: "storage",
      to: "Build_CentralStorage_C_2147449429",
      toKind: "storage",
      capacityPerMinute: 270,
      tier: "Conveyor Lift Mk.3",
      at: { x: -402, y: -1448 },
    },
    {
      id: "Build_Pipeline_C_2146766654",
      kind: "pipe",
      from: "Build_PipelineJunction_Cross_C_2146766657",
      fromKind: "junction",
      to: null,
      toKind: null,
      capacityPerMinute: null,
      tier: "Pipeline Mk.1",
      at: { x: -371, y: -1879 },
    },
    {
      id: "Build_Pipeline_C_2147376300",
      kind: "pipe",
      from: "Build_WaterPump_C_2147439854",
      fromKind: "extractor",
      to: "Build_PipelineJunction_Cross_C_2147377123",
      toKind: "junction",
      capacityPerMinute: null,
      tier: "Pipeline Mk.1",
      at: { x: 100, y: 30 },
    },
  ],
} satisfies ConveyorsWorldIngestRequest;

export const conveyorsWorldResponse = {
  layer: "conveyors",
  hash: "sha256-conveyors-sample",
  observedAt: conveyorsSample.observedAt,
  truncated: false,
  count: conveyorsSample.data.length,
  data: conveyorsSample.data,
} satisfies ConveyorsWorldLayerResponse;

/**
 * ADR-0055 Decision 1: the trainRoutes layer. SYNTHETIC in shape; names follow the 2026-10-21 captures' habits (a
 * trailing space, two stations with the same name), which the mapper must keep as game text.
 */
export const trainRoutesSample = {
  observedAt: "2026-10-24T12:00:00.000Z",
  data: [
    { recordType: "station", id: "Build_TrainStation_C_1", name: "Ore Pickup ", platforms: [{ id: "Build_TrainDockingStation_C_1", mode: "load", items: ["Desc_OreIron_C"] }] },
    { recordType: "station", id: "Build_TrainStation_C_2", name: "Main Depot", platforms: [{ id: "Build_TrainDockingStation_C_2", mode: "unload", items: ["Desc_OreIron_C"] }, { id: "Build_TrainDockingStationLiquid_C_1", mode: "unload", items: [] }] },
    { recordType: "station", id: "Build_TrainStation_C_3", name: "Main Depot", platforms: [] },
    { recordType: "train", id: "Build_Train_C_1", name: "Ore Run", stops: ["Ore Pickup ", "Main Depot"], items: ["Desc_OreIron_C"] },
  ],
} satisfies TrainRoutesWorldIngestRequest;

export const trainRoutesWorldResponse = {
  layer: "trainRoutes",
  hash: "sha256-trainroutes-sample",
  observedAt: trainRoutesSample.observedAt,
  truncated: false,
  count: trainRoutesSample.data.length,
  data: trainRoutesSample.data,
} satisfies TrainRoutesWorldLayerResponse;

/**
 * ADR-0055 Decision 1: the droneRoutes layer, projected from the 2026-10-25 captures
 * (captured-responses/frm-getDroneStation-2026-10-25-paired-battery-cargo-trimmed.json for the pair,
 * frm-getDroneStation-2026-10-25-unpaired-trimmed.json for "FUEL 1"): positions divided by 100 and rounded, "None"
 * read as not paired, inventories as their distinct class names. The pairing names the partner on both ports.
 */
export const droneRoutesSample = {
  observedAt: "2026-10-25T15:15:00.000Z",
  data: [
    { id: "Build_DroneStation_C_2146556398", name: "FUEL 5", paired: "TestLand1", input: ["Desc_Battery_C"], output: [], fuel: ["Desc_Battery_C"], x: -2204, y: 503 },
    { id: "Build_DroneStation_C_2147451055", name: "TestLand1", paired: "FUEL 5", input: [], output: [], fuel: ["Desc_Battery_C"], x: -2146, y: 510 },
    { id: "Build_DroneStation_C_2146572476", name: "FUEL 1", paired: null, input: [], output: [], fuel: ["Desc_Battery_C"], x: -2204, y: 599 },
  ],
} satisfies DroneRoutesWorldIngestRequest;

export const droneRoutesWorldResponse = {
  layer: "droneRoutes",
  hash: "sha256-droneroutes-sample",
  observedAt: droneRoutesSample.observedAt,
  truncated: false,
  count: droneRoutesSample.data.length,
  data: droneRoutesSample.data,
} satisfies DroneRoutesWorldLayerResponse;

/** A server whose conveyors layer was read and holds no conveyors (nothing built yet). An older FRM without the
 *  connection fields sends no conveyors layer at all, so it has no response of this kind. */
export const conveyorsWorldResponseEmpty = {
  layer: "conveyors",
  hash: "sha256-empty",
  observedAt: "2026-10-21T15:03:00.000Z",
  truncated: false,
  count: 0,
  data: [],
} satisfies ConveyorsWorldLayerResponse;
