import type { ServerDirectory } from "../../servers/index.js";
import type { DesignationBuilding } from "../../map/index.js";
import type { TelemetryScope } from "../telemetryServices.js";

/**
 * ADR-0055 Decision 5: the port the map module's designation routes read buildings through (map never imports telemetry, so
 * the composition root hands it this). The server's buildings from its latest snapshot, with their positions; a building
 * without a position is left out (it can still be named by its id, but there is nothing to match it by). Null when there is
 * no snapshot yet or it cannot be read: designations then show every member as missing and nothing is ever deleted.
 */
export function createDesignationBuildings(directory: ServerDirectory<TelemetryScope>): (serverId: string) => Promise<DesignationBuilding[] | null> {
  return async (serverId) => {
    const scope = directory.get(serverId);
    if (scope === undefined) return null;
    try {
      const factory = await scope.telemetry.production.getFactoryOverview();
      return factory.buildings.flatMap((b) =>
        b.location !== undefined && Number.isFinite(b.location.xM) && Number.isFinite(b.location.yM)
          ? [{ id: b.id, c: b.className, x: b.location.xM, y: b.location.yM }]
          : [],
      );
    } catch {
      return null;
    }
  };
}
