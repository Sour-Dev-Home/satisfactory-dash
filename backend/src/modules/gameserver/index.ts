/**
 * The gameserver module's public API (ADR-0014). Everything that talks to ONE
 * Satisfactory server (vanilla HTTPS API + FRM) lives in the `@satisfactory-dash/game-adapter`
 * package (ADR-0031 PR 2), so the edge agent can reuse it; this module is a thin facade over it
 * plus the backend-only parts (assembling a server's config from the environment or the servers
 * file). Other modules import only from here, never a deep path and never the package directly.
 *
 * The export list is EXPLICIT on purpose (not `export *`): it is exactly what the module exposed
 * before the extraction. In particular `ServerOptionsAdapter` is not exported, so GetServerOptions
 * stays reachable only through the allowlisted `ServerOptionsPort` (ADR-0012).
 */
export type {
  ServerHealth,
  ServerStatus,
  ProductionRate,
  InventorySlot,
  FactoryBuilding,
  PowerCircuit,
  BuildingPowerUsage,
  Player,
  SessionInfo,
} from "@satisfactory-dash/game-adapter";
export {
  SatisfactoryServerAdapter,
  VanillaApiClient,
  VanillaApiRequestError,
  FrmApiClient,
  FrmApiRequestError,
  createSatisfactoryServerConfig,
  createServerOptionsPort,
  createGameServerConnection,
  testGameServerConnection,
} from "@satisfactory-dash/game-adapter";
export type {
  VanillaApiClientLike,
  FrmApiClientLike,
  SatisfactoryServerConfig,
  ServerOptionsPort,
  AutoPauseState,
  ConnectionCheck,
  ConnectionCheckError,
  ConnectionTestResult,
} from "@satisfactory-dash/game-adapter";

export {
  loadSatisfactoryServerConfigFromEnv,
  nonLoopbackServerIds,
  parsePortEnv,
} from "./connectionConfig.js";
export { configuredServerEnvNamesInUse, ignoredSingleServerEnvNames, loadConfiguredServersFromFile } from "./serversFile.js";
export type { ConfiguredServer } from "./serversFile.js";
