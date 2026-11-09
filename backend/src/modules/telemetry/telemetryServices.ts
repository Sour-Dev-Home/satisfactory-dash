import type { Factory, Power, ServerPlayersResponse, Status } from "@satisfactory-dash/shared";
import type { PowerHistoryService } from "./services/powerHistoryService.js";
import type { HistoryQueryService } from "./services/historyQueryService.js";
import type { ObservationBoard } from "./services/observationBoard.js";
import type { AgentSnapshotSink } from "./services/agentIngest.js";
import type { AutoPauseReading } from "./services/agentSnapshotStore.js";

/** The services the data routes need for one game server. Narrow, so route tests can supply stubs. Since ADR-0066 the one
 *  implementation is `createAgentTelemetryServices`: the live reads serve the mod's last snapshot. */
export interface TelemetryServices {
  status: { getStatus(): Promise<Status> };
  production: { getFactoryOverview(): Promise<Factory> };
  power: { getPowerOverview(): Promise<Power> };
  powerHistory: Pick<PowerHistoryService, "getPowerHistory">;
  players: { getPlayers(): Promise<ServerPlayersResponse> };
  /** ADR-0027: stored history for this server. Absent without a database (the history routes answer 503). */
  history?: Pick<HistoryQueryService, "power" | "items" | "transitions">;
  /** ADR-0027 (alerts): the last readings, read by the alert evaluator. Absent without a database. */
  observations?: Pick<ObservationBoard, "snapshot">;
  /** ADR-0031 PR 5a: where each snapshot from the mod arrives; the agents module hands it over. */
  agentIngest?: AgentSnapshotSink;
  /** The auto-pause value the mod last reported; the composition root hands it to the settings service. */
  agentAutoPause?: () => AutoPauseReading | undefined;
}

/** What the telemetry routes read from a server directory entry. The composition root
 *  bundles it with other modules' services (settings, later); the servers module never
 *  looks inside. */
export interface TelemetryScope {
  telemetry: TelemetryServices;
}
