/**
 * The telemetry module's public API (ADR-0014): status, factory and power for one game
 * server. Its services depend on narrow port interfaces (the *AdapterLike types), which
 * the gameserver module's adapter satisfies; it never imports the adapter itself.
 */
import type { Router } from "express";
import type { ServerDirectory } from "../servers/index.js";
import { createStatusRouter } from "./routes/status.js";
import { createFactoryRouter } from "./routes/factory.js";
import { createPowerRouter } from "./routes/power.js";
import { ServerStatusService } from "./services/serverStatusService.js";
import type { ServerStatusAdapterLike } from "./services/serverStatusService.js";
import { ProductionService } from "./services/productionService.js";
import type { ProductionAdapterLike } from "./services/productionService.js";
import { PowerService } from "./services/powerService.js";
import type { PowerAdapterLike } from "./services/powerService.js";
import type { TelemetryScope, TelemetryServices } from "./telemetryServices.js";

export type { TelemetryScope, TelemetryServices } from "./telemetryServices.js";

export type TelemetryPorts = ServerStatusAdapterLike & ProductionAdapterLike & PowerAdapterLike;

/** ADR-0001: one set of services per registered game server. */
export function createTelemetryServices(ports: TelemetryPorts): TelemetryServices {
  return {
    status: new ServerStatusService(ports),
    production: new ProductionService(ports),
    power: new PowerService(ports),
  };
}

/** The data routes, scoped to :serverId through the directory. */
export function createTelemetryRouters(directory: ServerDirectory<TelemetryScope>): Router[] {
  return [createStatusRouter(directory), createFactoryRouter(directory), createPowerRouter(directory)];
}
