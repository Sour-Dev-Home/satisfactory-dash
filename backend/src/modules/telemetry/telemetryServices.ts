import type { ServerStatusService } from "./services/serverStatusService.js";
import type { ProductionService } from "./services/productionService.js";
import type { PowerService } from "./services/powerService.js";

/** The services the data routes need for one game server. Narrowed with Pick so route
 *  tests can supply stubs. */
export interface TelemetryServices {
  status: Pick<ServerStatusService, "getStatus">;
  production: Pick<ProductionService, "getFactoryOverview">;
  power: Pick<PowerService, "getPowerOverview">;
}

/** What the telemetry routes read from a server directory entry. The composition root
 *  bundles it with other modules' services (settings, later); the servers module never
 *  looks inside. */
export interface TelemetryScope {
  telemetry: TelemetryServices;
}
