/**
 * The gameserver module's public API (ADR-0014). Everything that talks to ONE
 * Satisfactory server (vanilla HTTPS API + FRM) lives behind this file, has no Express
 * imports, and can later be lifted into the edge agent. Other modules import only from
 * here, never a deep path.
 */
import { SatisfactoryServerAdapter } from "./satisfactoryServerAdapter.js";
import type { SatisfactoryServerConfig } from "./connectionConfig.js";

export * from "./domain.js";
export { SatisfactoryServerAdapter } from "./satisfactoryServerAdapter.js";
export type { VanillaApiClientLike, FrmApiClientLike } from "./satisfactoryServerAdapter.js";
export { loadSatisfactoryServerConfigFromEnv } from "./connectionConfig.js";
export type { SatisfactoryServerConfig } from "./connectionConfig.js";
export { VanillaApiClient, VanillaApiRequestError } from "./vanillaApiClient.js";
export { FrmApiClient, FrmApiRequestError } from "./frmApiClient.js";

/** Opens the connection to one game server: the adapter whose methods are the ports the
 *  other modules' services depend on. */
export function createGameServerConnection(config: SatisfactoryServerConfig): SatisfactoryServerAdapter {
  return SatisfactoryServerAdapter.fromConfig(config);
}
