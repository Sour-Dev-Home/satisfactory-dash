/**
 * The telemetry module's public API (ADR-0014): status, factory, power and power history for one game server. Since
 * ADR-0066 every server is reached through the mod: its live reads serve the mod's last snapshot and its history is fed
 * by the snapshots (`createAgentTelemetryServices`). Nothing here calls a game server.
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
import type { UnitResolver } from "./itemForms.js";
import { createUnitResolver } from "./itemForms.js";
import type { BackgroundWorker } from "./services/backgroundWorker.js";
import { PowerHistoryService } from "./services/powerHistoryService.js";
import { InMemoryPowerHistoryStore } from "./services/powerHistoryStore.js";
import { BufferedHistoryRecorder } from "./services/historyRecorder.js";
import { HistoryMaintenanceWorker } from "./services/historyMaintenanceWorker.js";
import { HistoryQueryService } from "./services/historyQueryService.js";
import { ObservationBoard } from "./services/observationBoard.js";
import type { HistoryDb } from "./services/historyQueryService.js";
import { createHistoryRouter } from "./routes/history.js";
import { createBottlenecksRouter } from "./routes/bottlenecks.js";
import { createProductionGraphRouter } from "./routes/productionGraph.js";
import type { BottlenecksRouteDeps } from "./routes/bottlenecks.js";
import type { Queryable } from "../../platform/db/schemaVersion.js";
import type { Cadence } from "@satisfactory-dash/shared";
import { AgentIngest } from "./services/agentIngest.js";
import type { MapLiveSink } from "./services/agentIngest.js";
import { LatestSnapshotStore } from "./services/agentSnapshotStore.js";
import { createLatestSnapshotRepository } from "./repositories/latestSnapshotRepository.js";
import { LatestSnapshotWriter, loadLatestSnapshot } from "./services/latestSnapshotWriter.js";
import type { TelemetryScope, TelemetryServices } from "./telemetryServices.js";

export type { TelemetryScope, TelemetryServices } from "./telemetryServices.js";
export { createDesignationBuildings } from "./services/designationBuildings.js";
export type { BackgroundWorker } from "./services/backgroundWorker.js";
export type {
  MachineObservation,
  ObservationSnapshot,
  PowerCircuitObservation,
} from "./services/observationBoard.js";
export type { AgentSnapshotSink, MapLiveSink } from "./services/agentIngest.js";
export type { AutoPauseReading } from "./services/agentSnapshotStore.js";
export { createUnitResolver } from "./itemForms.js";

/** The services plus the background workers the composition root must start and stop. */
export type TelemetryBundle = TelemetryServices & { workers: BackgroundWorker[] };

export interface AgentTelemetryOptions {
  logger?: Logger;
  now?: () => number;
  /** The cadence the backend has set for the agent (also its answer to every snapshot); read on every use, so a change applies at once. */
  cadence: () => Cadence;
  /** ADR-0015: resolves an item's unit for the rates an agent sends without one; the composition root passes the shared resolver. */
  resolveUnit?: UnitResolver;
  /** History is written for an agent server exactly as for a polled one (a database is what makes agents possible at all). */
  history: { db: Queryable & HistoryDb; serverPublicId: string };
  /** ADR-0038 M3: where this server's `mapLive` (trains, stations) goes; absent when the map
   *  module isn't wired up. */
  mapLive?: MapLiveSink;
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
  // ADR-0052 2.3-2.4: the last snapshot is kept in one row. It is loaded once (reads wait for it, at most 2 s, then see
  // an empty store) and the writer upserts it on change; what was loaded is served stale until the agent reports.
  const latestSnapshots = createLatestSnapshotRepository(options.history.db);
  const loaded = loadLatestSnapshot(store, latestSnapshots, options.history.serverPublicId, logger);
  const writer = new LatestSnapshotWriter(store, latestSnapshots, options.history.serverPublicId, { logger, ready: loaded });
  return {
    status: { getStatus: async () => (await loaded, store.read("status")) },
    production: { getFactoryOverview: async () => (await loaded, store.read("factory")) },
    power: { getPowerOverview: async () => (await loaded, store.read("power")) },
    powerHistory: new PowerHistoryService(powerStore, { startedAt: () => startedAt, lastSuccessAt: () => store.lastPowerAt() }, { intervalSeconds, now }),
    // Not listed by the agent yet is "no player list", the same answer a server without FRM gives.
    players: { getPlayers: async () => (await loaded, store.read("players", { available: false, players: [] })) },
    history: new HistoryQueryService(options.history.db, options.history.serverPublicId, { now: options.now }),
    observations,
    agentIngest: new AgentIngest({ store, cadence: options.cadence, observations, history: recorder, powerStore, resolveUnit: options.resolveUnit ?? createUnitResolver(() => {}), mapLive: options.mapLive }),
    agentAutoPause: () => store.autoPause(),
    workers: [recorder, writer],
  };
}

/** ADR-0027: the process-wide worker that rolls history up and purges it; start it once the database is up. */
export function createHistoryMaintenance(db: Queryable, logger: Logger): BackgroundWorker {
  return new HistoryMaintenanceWorker(db, { logger });
}

/** The data routes, scoped to :serverId through the directory. */
export function createTelemetryRouters(directory: ServerDirectory<TelemetryScope>, bottlenecks?: BottlenecksRouteDeps): Router[] {
  return [
    createStatusRouter(directory),
    createFactoryRouter(directory),
    createBottlenecksRouter(directory, bottlenecks),
    createProductionGraphRouter(directory, bottlenecks),
    createPowerRouter(directory),
    createPowerHistoryRouter(directory),
    createHistoryRouter(directory),
    createPlayersRouter(directory),
  ];
}
