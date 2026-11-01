import type { ConveyorsWorldLayerResponse } from "@satisfactory-dash/shared";
import { conveyorsWorldResponse } from "@satisfactory-dash/shared/fixtures";

/**
 * GET .../map/world/conveyors in the state the shared fixtures don't carry (#330): the layer cut to its item cap. The
 * empty layer is the shared `conveyorsWorldResponseEmpty`. Built here, from the shared fixture only, for the unit mocks
 * and the e2e scenarios alike (the same way as powerLinesResponses.ts).
 */
export const conveyorsWorldResponseTruncated = {
  ...conveyorsWorldResponse,
  hash: "sha256-conveyors-truncated",
  truncated: true,
} satisfies ConveyorsWorldLayerResponse;
