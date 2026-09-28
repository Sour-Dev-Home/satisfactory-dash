import type {
  MapLive,
  RailsWorldIngestRequest,
  RailsWorldLayerResponse,
  ResourceNodesWorldIngestRequest,
  ResourceNodesWorldLayerResponse,
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
    { type: "Crude Oil", purity: "normal", nodeType: "node", x: 1783, y: 2061, exploited: false },
    { type: "SAM", purity: "impure", nodeType: "node", x: 1619, y: 1038, exploited: false },
    { type: "SAM", purity: "pure", nodeType: "node", x: 1629, y: 654, exploited: false },
    { type: "Limestone", purity: "normal", nodeType: "node", x: -2808, y: -421, exploited: false },
    { type: "Coal", purity: "normal", nodeType: "node", x: -996, y: -1468, exploited: true },
    { type: "Iron Ore", purity: "pure", nodeType: "node", x: -1106, y: -1352, exploited: true },
    { type: "Nitrogen Gas", purity: "pure", nodeType: "frackingSatellite", x: 2125, y: 1381, exploited: false },
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
