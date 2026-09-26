/**
 * The gameserver module's public API (ADR-0014). Everything that talks to ONE
 * Satisfactory server (vanilla HTTPS API + FRM) lives in the `@satisfactory-dash/game-adapter`
 * package (ADR-0031 PR 2), so the edge agent can reuse it; this module is a thin facade over it
 * plus the backend-only parts (assembling a server's config from the environment or the servers
 * file). Other modules import only from here, never a deep path and never the package directly.
 */
export * from "@satisfactory-dash/game-adapter";

export {
  loadSatisfactoryServerConfigFromEnv,
  nonLoopbackServerIds,
  parsePortEnv,
} from "./connectionConfig.js";
export { configuredServerEnvNamesInUse, ignoredSingleServerEnvNames, loadConfiguredServersFromFile } from "./serversFile.js";
export type { ConfiguredServer } from "./serversFile.js";
