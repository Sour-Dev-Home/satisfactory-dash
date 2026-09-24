/**
 * The telemetry module's public API (ADR-0014): status, factory, power and power history
 * for one game server. Its services depend on narrow port interfaces (the *AdapterLike
 * types), which the gameserver module's adapter satisfies; it never imports the adapter
 * itself.
 */
import type { Router } from "express";
import type { Logger } from "pino";
import type { ServerDirectory } from "../servers/index.js";
import { createLogger } from "../../platform/logger.js";
import { createStatusRouter } from "./routes/status.js";
import { createFactoryRouter } from "./routes/factory.js";
import { createPowerRouter } from "./routes/power.js";
import { createPowerHistoryRouter } from "./routes/powerHistory.js";
import { ServerStatusService } from "./services/serverStatusService.js";
import type { ServerStatusAdapterLike } from "./services/serverStatusService.js";
import { ProductionService } from "./services/productionService.js";
import type { UnitResolver } from "./services/productionService.js";
import type { ProductionAdapterLike } from "./services/productionService.js";
import { PowerService } from "./services/powerService.js";
import type { PowerAdapterLike } from "./services/powerService.js";
import { PowerHistoryPoller } from "./services/powerHistoryPoller.js";
import type { BackgroundWorker } from "./services/powerHistoryPoller.js";
import { PowerHistoryService } from "./services/powerHistoryService.js";
import {
  InMemoryPowerHistoryStore,
  POWER_HISTORY_INTERVAL_SECONDS,
  POWER_HISTORY_WINDOW_SECONDS,
} from "./services/powerHistoryStore.js";
import type { TelemetryScope, TelemetryServices } from "./telemetryServices.js";

export type { TelemetryScope, TelemetryServices } from "./telemetryServices.js";
export type { BackgroundWorker } from "./services/powerHistoryPoller.js";
export { createUnitResolver } from "./itemForms.js";

export type TelemetryPorts = ServerStatusAdapterLike & ProductionAdapterLike & PowerAdapterLike;

export interface TelemetryOptions {
  /** Where the background workers log; silent when omitted. */
  logger?: Logger;
  /** Injectable clock, for tests on fake time. */
  now?: () => number;
  /** History window and sampling cadence; ADR-0022's 5 minutes at 5 seconds by default. */
  powerHistory?: { windowSeconds?: number; intervalSeconds?: number };
}

/** The services plus the background workers the composition root must start and stop. */
export type TelemetryBundle = TelemetryServices & { workers: BackgroundWorker[] };

/**
 * ADR-0001: one set of services per registered game server. The power history poller is
 * created here but NOT started: the composition root starts every worker once the server
 * is listening, and stops them on shutdown (ADR-0022).
 */
export function createTelemetryServices(
  ports: TelemetryPorts,
  resolveUnit?: UnitResolver,
  options: TelemetryOptions = {},
): TelemetryBundle {
  const windowSeconds = options.powerHistory?.windowSeconds ?? POWER_HISTORY_WINDOW_SECONDS;
  const intervalSeconds = options.powerHistory?.intervalSeconds ?? POWER_HISTORY_INTERVAL_SECONDS;
  const store = new InMemoryPowerHistoryStore({ windowSeconds, intervalSeconds });
  const poller = new PowerHistoryPoller(ports, store, {
    logger: options.logger ?? createLogger({ level: "silent" }),
    intervalSeconds,
    now: options.now,
  });
  return {
    status: new ServerStatusService(ports),
    production: new ProductionService(ports, resolveUnit),
    power: new PowerService(ports),
    powerHistory: new PowerHistoryService(store, poller, { intervalSeconds, now: options.now }),
    workers: [poller],
  };
}

/** The data routes, scoped to :serverId through the directory. */
export function createTelemetryRouters(directory: ServerDirectory<TelemetryScope>): Router[] {
  return [
    createStatusRouter(directory),
    createFactoryRouter(directory),
    createPowerRouter(directory),
    createPowerHistoryRouter(directory),
  ];
}
