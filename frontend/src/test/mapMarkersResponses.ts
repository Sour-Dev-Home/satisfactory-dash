import type { MapMarkersWorldLayerResponse } from "@satisfactory-dash/shared";
import { mapMarkersWorldResponse } from "@satisfactory-dash/shared/fixtures";

/**
 * GET .../map/world/mapMarkers in the states the shared fixtures don't carry (ADR-0038 §1, #330): none placed yet,
 * and the layer cut to its item cap. Built here, from the shared fixture only, for the unit mocks and the e2e
 * scenarios alike (the same way as mapLiveResponses.ts).
 */
export const mapMarkersWorldResponseEmpty = {
  ...mapMarkersWorldResponse,
  hash: "sha256-empty",
  count: 0,
  data: [],
} satisfies MapMarkersWorldLayerResponse;

/** The ingest cut the layer to its item cap and flagged it (as railsWorldResponseTruncated does, on the sample data). */
export const mapMarkersWorldResponseTruncated = {
  ...mapMarkersWorldResponse,
  hash: "sha256-mapmarkers-truncated",
  truncated: true,
} satisfies MapMarkersWorldLayerResponse;
