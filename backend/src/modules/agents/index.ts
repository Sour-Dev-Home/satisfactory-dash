/**
 * The agents module's public API (ADR-0014, ADR-0031 PR 5a): the edge agent's enrolment, credentials and snapshot
 * ingest, and the owner's side of it (creating a code, seeing the agent, revoking it). It owns the `agents` schema.
 * It hands each snapshot to the telemetry module's agent-backed services (through their index) and switches a server's
 * connection kind through the servers module's index; it knows nothing about how a game server is read.
 */
import type { RequestHandler, Router } from "express";
import type { Logger } from "pino";
import type { Queryable } from "../../platform/db/schemaVersion.js";
import type { withTransaction } from "../../platform/db/transaction.js";
import type { ServerDirectory } from "../servers/index.js";
import type { TelemetryScope } from "../telemetry/index.js";
import { AGENT_CADENCE } from "./config.js";
import { setAgentVersion } from "./repositories/agentRepository.js";
import { createAgentApiRouter } from "./routes/agentApi.js";
import { createAgentUserRouter } from "./routes/agentUser.js";
import { createPairingApiRouter } from "./routes/pairingApi.js";
import { createCompatRouter, createPairingUserRouter } from "./routes/pairingUser.js";
import type { PairingUserRouterOptions } from "./routes/pairingUser.js";
import { PairingSweeper } from "./services/pairingSweeper.js";
import type { PairingService } from "./services/pairingService.js";
import { CommandSweeper } from "./services/commandSweeper.js";
import type { AgentCommandsService, CommandsService } from "./services/commandsService.js";
import { createEnrollmentService } from "./services/enrollmentService.js";
import type { AgentsService } from "./services/agentsService.js";

export { AGENT_CADENCE, loadEnrollmentCodesPerHour } from "./config.js";
export { createAgentsService } from "./services/agentsService.js";
export type { AgentsService, AgentsServiceDeps } from "./services/agentsService.js";
export { createCommandsService } from "./services/commandsService.js";
export type { AgentCommandsService, CommandsService, CommandsServiceDeps } from "./services/commandsService.js";
export { CommandNotifier } from "./services/commandNotifier.js";
export { releaseAgentServer } from "./services/releaseAgent.js";
// ADR-0046 C3: "has this server ever enrolled", injected into the servers module's self-serve create by the composition root.
export { enrolledServerIds } from "./repositories/agentRepository.js";
export type { ReleasedAgent } from "./services/releaseAgent.js";
export { createAgentSettingsServices } from "./services/agentSettings.js";
export type { AgentSettingsServices } from "./services/agentSettings.js";
// ADR-0038 M3 (#353): the map module's own agent-authed ingest route needs the SAME credential
// check, injected as a plain RequestHandler (its own AgentWorldRoutesDeps.auth) rather than an
// import edge — server.ts (which already imports both modules) builds a second instance with this.
export { createAgentAuth } from "./services/agentAuth.js";
export type { AgentAuthOptions, AgentIdentity } from "./services/agentAuth.js";

/** The process-wide worker that expires stale commands and purges old ones; start it once the database is up. */
export function createCommandSweeper(db: Queryable, logger: Logger): { start(): void; stop(): Promise<void> } {
  return new CommandSweeper(db, { logger });
}

// ADR-0051 section 1: device-code pairing. The service is built by the composition root (it needs the servers module's
// self-serve create, injected as a port) and handed to the routers below.
export { createPairingService } from "./services/pairingService.js";
export type { PairingService, PairingServiceDeps } from "./services/pairingService.js";

/** Deletes pairing rows an hour after they expire; start it once the database is up. */
export function createPairingSweeper(db: Queryable, logger: Logger): { start(): void; stop(): Promise<void> } {
  return new PairingSweeper(db, { logger });
}

/** The agent's unauthenticated pairing routes (`POST /agent/v1/pairings`, `.../poll`), for createApp's `agentRouters`. */
export function createPairingApiRouters(service: PairingService, isReady?: () => boolean): Router[] {
  return [createPairingApiRouter({ service, isReady })];
}

/** The owner's pairing routes (`POST /api/pairings/lookup` and `/approve`): signed-in, so a protected router. */
export function createPairingUserRouters(service: PairingService, options: PairingUserRouterOptions): Router[] {
  return [createPairingUserRouter(service, options)];
}

/** `GET /api/compat` (ADR-0057): the version policy, for any signed-in account; needs no database. */
export function createCompatRouters(): Router[] {
  return [createCompatRouter()];
}

/** The owner's routes under /api/servers/:serverId (enrolment code, agent status, revoke, a command's status). Mount them
 *  AFTER the servers router, whose membership check covers these paths. */
export function createAgentUserRouters(service: AgentsService, commands: Pick<CommandsService, "getCommand">): Router[] {
  return [createAgentUserRouter(service, commands)];
}

export interface AgentApiModuleDeps {
  db: Queryable & Parameters<typeof withTransaction>[0];
  logger: Logger;
  /** The agent-facing commands service (poll, report, pending), built with the SAME notifier as the settings services. */
  commands: AgentCommandsService;
  directory: ServerDirectory<TelemetryScope>;
  /** Replaces a server's running entry with an agent-backed one; idempotent. Called after enrolment commits, and by the
   *  first snapshot of a server that has none. */
  attachAgentRuntime: (publicId: string) => Promise<void>;
  isReady?: () => boolean;
  /** The one `createAgentAuth` instance of the process, shared with the world-layer routes (#562): a second instance
   *  would double the failure budgets and the per-credential lookup budget. */
  auth: RequestHandler;
}

/** The agent's own API, to be mounted at /agent/v1 (createApp's `agentRouters`): no session, its own credential. */
export function createAgentApiRouters(deps: AgentApiModuleDeps): Router[] {
  const cadence = () => AGENT_CADENCE;
  return [
    createAgentApiRouter({
      auth: deps.auth,
      enrollment: createEnrollmentService({ db: deps.db, cadence, attachAgentRuntime: deps.attachAgentRuntime, logger: deps.logger }),
      commands: deps.commands,
      directory: deps.directory,
      attachAgentRuntime: deps.attachAgentRuntime,
      recordVersion: (serverUuid, agentVersion) => setAgentVersion(deps.db, serverUuid, agentVersion),
      cadence,
      isReady: deps.isReady,
    }),
  ];
}
