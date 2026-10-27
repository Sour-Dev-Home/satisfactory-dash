import type { DroneRoutesWorldLayerResponse } from "@satisfactory-dash/shared";
import { droneRoutesWorldResponse } from "@satisfactory-dash/shared/fixtures";

/**
 * GET .../map/world/droneRoutes in the states the shared fixtures don't carry (ADR-0055 Decision 1, #330): none built
 * yet, the layer cut to its item cap, and a pairing that names two ports. Built here, from the shared fixture only, for
 * the unit mocks and the e2e scenarios alike (the same way as powerLinesResponses.ts).
 */
export const droneRoutesWorldResponseEmpty = {
  ...droneRoutesWorldResponse,
  hash: "sha256-empty",
  count: 0,
  data: [],
} satisfies DroneRoutesWorldLayerResponse;

/** The ingest cut the layer to its item cap and flagged it (as railsWorldResponseTruncated does, on the sample data). */
export const droneRoutesWorldResponseTruncated = {
  ...droneRoutesWorldResponse,
  hash: "sha256-droneroutes-truncated",
  truncated: true,
} satisfies DroneRoutesWorldLayerResponse;

/**
 * Two ports share the name the first port is paired with (player names repeat), so that pairing can't be matched to one
 * port: no route is drawn for it, and the text counts it. The sample's unpaired "FUEL 1" is renamed to the partner's name.
 */
export const droneRoutesWorldResponseAmbiguous = {
  ...droneRoutesWorldResponse,
  hash: "sha256-droneroutes-ambiguous",
  data: [
    droneRoutesWorldResponse.data[0],
    droneRoutesWorldResponse.data[1],
    { ...droneRoutesWorldResponse.data[2], name: droneRoutesWorldResponse.data[1].name },
  ],
} satisfies DroneRoutesWorldLayerResponse;
