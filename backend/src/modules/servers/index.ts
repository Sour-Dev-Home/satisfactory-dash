/**
 * The servers module's public API (ADR-0014): the registry of game servers and the
 * request scoping that resolves :serverId (ADR-0001). It knows nothing about what a
 * server offers; the composition root bundles that per server.
 */
export { InMemoryServerDirectory } from "./serverDirectory.js";
export type { ServerDirectory, ServerDirectoryEntry } from "./serverDirectory.js";
export { loadServerRegistryFromEnv } from "./serverRegistry.js";
export type { ServerRegistryEntry } from "./serverRegistry.js";
export { resolveServer } from "./serverScope.js";
export { createAuthorizeServer, createDbServerAccess } from "./serverAccess.js";
export type { AuthorizeServerOptions, ServerAccess } from "./serverAccess.js";
export { createServersRouter } from "./serversRouter.js";
export { createServerManagementService } from "./serverManagement.js";
export type { ConnectionCandidate, ManagementDb, ServerManagementDeps, ServerManagementService } from "./serverManagement.js";
export { createServerManagementRouters } from "./serverManagementRouter.js";
export type { ServerManagementRouterOptions } from "./serverManagementRouter.js";
// ADR-0046: self-serve agent servers (shipped dark behind SELF_SERVE_ENABLED).
export { createSelfServeService } from "./selfServe.js";
export type { SelfServeDeps, SelfServeRuntime, SelfServeService } from "./selfServe.js";
// #526 (ADR-0046 C4): removes self-serve servers that never enrolled.
export { createPendingServerSweeper } from "./pendingServerSweeper.js";
export type { PendingServerSweeper, PendingServerSweeperDeps } from "./pendingServerSweeper.js";
export { createSelfServeRouter } from "./selfServeRouter.js";
export type { SelfServeRouterOptions } from "./selfServeRouter.js";
export { loadSelfServeConfigFromEnv } from "./selfServeConfig.js";
export type { SelfServeConfig } from "./selfServeConfig.js";
export {
  AddressRefusedError,
  DEFAULT_ADDRESS_POLICY,
  LAN_ALLOWED,
  LanRequiresPinningError,
  addressVerdict,
  isAllowedAddress,
  isLoopbackAddress,
  resolveAllowedAddress,
} from "./addressGuard.js";
export type { AddressLookup, AddressPolicy, AddressVerdict } from "./addressGuard.js";
export { AgentRuntimeReplacedError, ServerRuntime } from "./serverRuntime.js";
export type { RuntimeServer, RuntimeWorker, ServerRuntimeOptions } from "./serverRuntime.js";
// ADR-0031 PR 5a: the agents module switches a server to 'agent' in its enrolment transaction and looks servers up.
export { findServerByPublicId, listAgentServers, switchToAgentConnection } from "./repositories/serverRepository.js";
export type { ConnectionKind, RegisteredServer } from "./repositories/serverRepository.js";
export { loadDatabaseServers } from "./loadDatabaseServers.js";
export type { LoadDatabaseServersResult } from "./loadDatabaseServers.js";
export { ImportError, MAX_LOCAL_SERVERS, importServers } from "./importServers.js";
export type { ImportResult, ImportableServer } from "./importServers.js";
export {
  countConnections,
  createConnection,
  deleteConnection,
  getConnection,
  getConnectionSummary,
  listConnections,
  saveConnection,
  updateConnection,
} from "./repositories/connectionRepository.js";
export type {
  CreateConnectionOutcome,
  ConnectionInput,
  ConnectionList,
  ConnectionPatch,
  ServerConnection,
  ServerConnectionSummary,
  UnreadableConnection,
} from "./repositories/connectionRepository.js";
