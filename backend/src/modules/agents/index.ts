/**
 * The agents module's public API (ADR-0014, ADR-0031 PR 5a): the edge agent's enrolment, credentials and snapshot
 * ingest, and the owner's side of it (creating a code, seeing the agent, revoking it). It owns the `agents` schema.
 * It hands each snapshot to the telemetry module's agent-backed services (through their index) and switches a server's
 * connection kind through the servers module's index; it knows nothing about how a game server is read.
 */
import type { Router } from "express";
import type { Logger } from "pino";
import type { Queryable } from "../../platform/db/schemaVersion.js";
import type { withTransaction } from "../../platform/db/transaction.js";
import type { ServerDirectory } from "../servers/index.js";
import type { TelemetryScope } from "../telemetry/index.js";
import { AGENT_CADENCE } from "./config.js";
import { setAgentVersion } from "./repositories/agentRepository.js";
import { createAgentApiRouter } from "./routes/agentApi.js";
import { createAgentUserRouter } from "./routes/agentUser.js";
import { createAgentAuth } from "./services/agentAuth.js";
import { createEnrollmentService } from "./services/enrollmentService.js";
import type { AgentsService } from "./services/agentsService.js";

export { AGENT_CADENCE } from "./config.js";
export { createAgentsService } from "./services/agentsService.js";
export type { AgentsService, AgentsServiceDeps } from "./services/agentsService.js";

/** The owner's routes under /api/servers/:serverId (enrolment code, agent status, revoke). Mount them AFTER the servers
 *  router, whose membership check covers these paths. */
export function createAgentUserRouters(service: AgentsService): Router[] {
  return [createAgentUserRouter(service)];
}

export interface AgentApiModuleDeps {
  db: Queryable & Parameters<typeof withTransaction>[0];
  logger: Logger;
  directory: ServerDirectory<TelemetryScope>;
  /** Replaces a server's running entry with an agent-backed one; idempotent. Called after enrolment commits, and by the
   *  first snapshot of a server that has none. */
  attachAgentRuntime: (publicId: string) => Promise<void>;
  isReady?: () => boolean;
}

/** The agent's own API, to be mounted at /agent/v1 (createApp's `agentRouters`): no session, its own credential. */
export function createAgentApiRouters(deps: AgentApiModuleDeps): Router[] {
  const cadence = () => AGENT_CADENCE;
  return [
    createAgentApiRouter({
      auth: createAgentAuth({ db: deps.db }),
      enrollment: createEnrollmentService({ db: deps.db, cadence, attachAgentRuntime: deps.attachAgentRuntime, logger: deps.logger }),
      directory: deps.directory,
      attachAgentRuntime: deps.attachAgentRuntime,
      recordVersion: (serverUuid, agentVersion) => setAgentVersion(deps.db, serverUuid, agentVersion),
      cadence,
      isReady: deps.isReady,
    }),
  ];
}
