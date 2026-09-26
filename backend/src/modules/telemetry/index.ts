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
import { createPlayersRouter } from "./routes/players.js";
import { PlayersService } from "./services/playersService.js";
import type { PlayersAdapterLike } from "./services/playersService.js";
import { ServerStatusService } from "./services/serverStatusService.js";
import type { ServerStatusAdapterLike } from "./services/serverStatusService.js";
import { ProductionService } from "./services/productionService.js";
import type { UnitResolver } from "./services/productionService.js";
import { createUnitResolver } from "./itemForms.js";
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
import { BufferedHistoryRecorder, noopHistoryRecorder } from "./services/historyRecorder.js";
import type { HistoryRecorder } from "./services/historyRecorder.js";
import { FactoryHistoryPoller } from "./services/factoryHistoryPoller.js";
import { HistoryMaintenanceWorker } from "./services/historyMaintenanceWorker.js";
import { HistoryQueryService } from "./services/historyQueryService.js";
import { ObservationBoard } from "./services/observationBoard.js";
import type { HistoryDb } from "./services/historyQueryService.js";
import { createHistoryRouter } from "./routes/history.js";
import type { Queryable } from "../../platform/db/schemaVersion.js";
import type { Cadence } from "@satisfactory-dash/shared";
import { AgentIngest } from "./services/agentIngest.js";
import { LatestSnapshotStore } from "./services/agentSnapshotStore.js";
import type { TelemetryScope, TelemetryServices } from "./telemetryServices.js";

export type { TelemetryScope, TelemetryServices } from "./telemetryServices.js";
export type { BackgroundWorker } from "./services/powerHistoryPoller.js";
export type {
  MachineObservation,
  ObservationSnapshot,
  PowerCircuitObservation,
} from "./services/observationBoard.js";
export type { AgentSnapshotSink } from "./services/agentIngest.js";
export type { AutoPauseReading } from "./services/agentSnapshotStore.js";
export { createUnitResolver } from "./itemForms.js";

export type TelemetryPorts = ServerStatusAdapterLike & ProductionAdapterLike & PowerAdapterLike & PlayersAdapterLike;

export interface TelemetryOptions {
  /** Where the background workers log; silent when omitted. */
  logger?: Logger;
  /** Injectable clock, for tests on fake time. */
  now?: () => number;
  /** History window and sampling cadence; ADR-0022's 5 minutes at 5 seconds by default. */
  powerHistory?: { windowSeconds?: number; intervalSeconds?: number };
  /** ADR-0027: with a database, this server's samples are also written to durable history. Omitted: memory only. */
  history?: { db: Queryable & HistoryDb; serverPublicId: string };
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
  const logger = options.logger ?? createLogger({ level: "silent" });
  const workers: BackgroundWorker[] = [];
  let history: HistoryRecorder = noopHistoryRecorder;
  // ADR-0027 (alerts): with a database, the pollers also publish their last readings to this in-memory board.
  let observations: ObservationBoard | undefined;
  if (options.history) {
    const recorder = new BufferedHistoryRecorder(options.history.db, options.history.serverPublicId, { logger });
    history = recorder;
    observations = new ObservationBoard();
    workers.push(recorder, new FactoryHistoryPoller(ports, { logger, history: recorder, observations, now: options.now }));
  }
  const poller = new PowerHistoryPoller(ports, store, { logger, intervalSeconds, now: options.now, history, observations });
  workers.unshift(poller);
  return {
    status: new ServerStatusService(ports),
    production: new ProductionService(ports, resolveUnit),
    power: new PowerService(ports),
    powerHistory: new PowerHistoryService(store, poller, { intervalSeconds, now: options.now }),
    players: new PlayersService(ports),
    // ADR-0027: the same server's stored history, for the history routes (absent without a database).
    ...(observations ? { observations } : {}),
    ...(options.history
      ? { history: new HistoryQueryService(options.history.db, options.history.serverPublicId, { now: options.now }) }
      : {}),
    workers,
  };
}

export interface AgentTelemetryOptions {
  logger?: Logger;
  now?: () => number;
  /** The cadence the backend has set for the agent (also its answer to every snapshot); read on every use, so a change applies at once. */
  cadence: () => Cadence;
  /** ADR-0015: resolves an item's unit for the rates an agent sends without one; the composition root passes the shared resolver. */
  resolveUnit?: UnitResolver;
  /** History is written for an agent server exactly as for a polled one (a database is what makes agents possible at all). */
  history: { db: Queryable & HistoryDb; serverPublicId: string };
}

/**
 * ADR-0031 PR 5a: the services for a server reached through an edge agent. There is no game server to call: the live
 * routes serve the agent's last snapshot (its own time, stale after three intervals), and `agentIngest` is where each
 * snapshot arrives, feeding the same observation board, history and power chart the pollers feed. The only worker is
 * the history recorder's batch writer.
 */
export function createAgentTelemetryServices(options: AgentTelemetryOptions): TelemetryBundle {
  const now = options.now ?? Date.now;
  const logger = options.logger ?? createLogger({ level: "silent" });
  const store = new LatestSnapshotStore(options.cadence, now);
  const recorder = new BufferedHistoryRecorder(options.history.db, options.history.serverPublicId, { logger });
  const observations = new ObservationBoard({ agentStartedAt: now() });
  const intervalSeconds = options.cadence().powerSeconds;
  const powerStore = new InMemoryPowerHistoryStore({ intervalSeconds });
  const startedAt = now();
  return {
    status: { getStatus: async () => store.read("status") },
    production: { getFactoryOverview: async () => store.read("factory") },
    power: { getPowerOverview: async () => store.read("power") },
    powerHistory: new PowerHistoryService(powerStore, { startedAt: () => startedAt, lastSuccessAt: () => store.lastPowerAt() }, { intervalSeconds, now }),
    // Not listed by the agent yet is "no player list", the same answer a server without FRM gives.
    players: { getPlayers: async () => store.read("players", { available: false, players: [] }) },
    history: new HistoryQueryService(options.history.db, options.history.serverPublicId, { now: options.now }),
    observations,
    agentIngest: new AgentIngest({ store, cadence: options.cadence, observations, history: recorder, powerStore, resolveUnit: options.resolveUnit ?? createUnitResolver(() => {}) }),
    agentAutoPause: () => store.autoPause(),
    workers: [recorder],
  };
}

/** ADR-0027: the process-wide worker that rolls history up and purges it; start it once the database is up. */
export function createHistoryMaintenance(db: Queryable, logger: Logger): BackgroundWorker {
  return new HistoryMaintenanceWorker(db, { logger });
}

/** The data routes, scoped to :serverId through the directory. */
export function createTelemetryRouters(directory: ServerDirectory<TelemetryScope>): Router[] {
  return [
    createStatusRouter(directory),
    createFactoryRouter(directory),
    createPowerRouter(directory),
    createPowerHistoryRouter(directory),
    createHistoryRouter(directory),
    createPlayersRouter(directory),
  ];
}
