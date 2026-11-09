/**
 * The servers module's public API (ADR-0014): the registry of game servers and the
 * request scoping that resolves :serverId (ADR-0001). It knows nothing about what a
 * server offers; the composition root bundles that per server.
 */
export { InMemoryServerDirectory } from "./serverDirectory.js";
export type { ServerDirectory, ServerDirectoryEntry } from "./serverDirectory.js";
export { resolveServer } from "./serverScope.js";
export { createAuthorizeServer, createDbServerAccess } from "./serverAccess.js";
export type { AuthorizeServerOptions, ServerAccess } from "./serverAccess.js";
export { createServersRouter } from "./serversRouter.js";
export { createServerManagementService } from "./serverManagement.js";
export type { ManagementDb, ServerManagementDeps, ServerManagementService } from "./serverManagement.js";
export { createServerManagementRouters } from "./serverManagementRouter.js";
export type { ServerManagementRouterOptions } from "./serverManagementRouter.js";
// ADR-0046: self-serve agent servers (shipped dark behind SELF_SERVE_ENABLED).
export { createSelfServeService } from "./selfServe.js";
export type { SelfServeCreateHook, SelfServeDeps, SelfServeRuntime, SelfServeService } from "./selfServe.js";
// #526 (ADR-0046 C4): removes self-serve servers that never enrolled.
export { createPendingServerSweeper } from "./pendingServerSweeper.js";
export type { PendingServerSweeper, PendingServerSweeperDeps } from "./pendingServerSweeper.js";
// #526 (L2): every post-commit runtime add re-checks that the server was not removed meanwhile.
export { addUnlessRemoved } from "./runtimeGuard.js";
export { createSelfServeRouter } from "./selfServeRouter.js";
// ADR-0047: leaving a server, and the servers' part of deleting an account (identity's port, wired in the composition root).
export { createDbMemberSelfService, createMembersRouter } from "./membersRouter.js";
export type { MemberSelfService, MembersRouterOptions } from "./membersRouter.js";
export { createAccountServers } from "./accountServers.js";
export type { AccountServers, AccountServersDeps } from "./accountServers.js";
export type { SelfServeRouterOptions } from "./selfServeRouter.js";
export { loadSelfServeConfigFromEnv } from "./selfServeConfig.js";
export type { SelfServeConfig } from "./selfServeConfig.js";
export { AgentRuntimeReplacedError, ServerRuntime } from "./serverRuntime.js";
export type { RuntimeServer, RuntimeWorker, ServerRuntimeOptions } from "./serverRuntime.js";
// ADR-0031 PR 5a: the agents module switches a server to 'agent' in its enrolment transaction and looks servers up.
export { findServerByPublicId, listAgentServers, lockServerForPairing, switchToAgentConnection } from "./repositories/serverRepository.js";
export type { ConnectionKind, RegisteredServer } from "./repositories/serverRepository.js";
export { loadDatabaseServers, reconcileDatabaseServers } from "./loadDatabaseServers.js";
export type { BuildAgentServer, LoadDatabaseServersResult, ReconcileDatabaseServersResult } from "./loadDatabaseServers.js";
// ADR-0066 build PR 6: the stored connections' one remaining read, for the `verify-secrets` admin command (the restore
// drill). It goes with the table in build PR 10.
export { listConnections } from "./repositories/connectionRepository.js";
export type { ConnectionList, ServerConnection, UnreadableConnection } from "./repositories/connectionRepository.js";
