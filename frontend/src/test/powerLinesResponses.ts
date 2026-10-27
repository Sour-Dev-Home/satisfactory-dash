import type { PowerLinesWorldLayerResponse } from "@satisfactory-dash/shared";
import { powerLinesWorldResponse } from "@satisfactory-dash/shared/fixtures";

/**
 * GET .../map/world/powerLines in the states the shared fixtures don't carry (ADR-0038 §1, #330): none built yet,
 * and the layer cut to its item cap. Built here, from the shared fixture only, for the unit mocks and the e2e
 * scenarios alike (the same way as mapMarkersResponses.ts).
 */
export const powerLinesWorldResponseEmpty = {
  ...powerLinesWorldResponse,
  hash: "sha256-empty",
  count: 0,
  data: [],
} satisfies PowerLinesWorldLayerResponse;

/** The ingest cut the layer to its item cap and flagged it (as railsWorldResponseTruncated does, on the sample data). */
export const powerLinesWorldResponseTruncated = {
  ...powerLinesWorldResponse,
  hash: "sha256-powerlines-truncated",
  truncated: true,
} satisfies PowerLinesWorldLayerResponse;
