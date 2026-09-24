/**
 * The gameserver module's public API (ADR-0014). Everything that talks to ONE
 * Satisfactory server (vanilla HTTPS API + FRM) lives behind this file, has no Express
 * imports, and can later be lifted into the edge agent. Other modules import only from
 * here, never a deep path.
 */
import { SatisfactoryServerAdapter } from "./satisfactoryServerAdapter.js";
import type { SatisfactoryServerConfig } from "./connectionConfig.js";
import { ServerOptionsAdapter } from "./serverOptionsAdapter.js";
import type { ServerOptionsPort } from "./serverOptionsAdapter.js";
import { VanillaApiClient } from "./vanillaApiClient.js";

export * from "./domain.js";
export { SatisfactoryServerAdapter } from "./satisfactoryServerAdapter.js";
export type { VanillaApiClientLike, FrmApiClientLike } from "./satisfactoryServerAdapter.js";
export { loadSatisfactoryServerConfigFromEnv, parsePortEnv } from "./connectionConfig.js";
export type { SatisfactoryServerConfig } from "./connectionConfig.js";
export { VanillaApiClient, VanillaApiRequestError } from "./vanillaApiClient.js";
export { FrmApiClient, FrmApiRequestError } from "./frmApiClient.js";

export type { ServerOptionsPort, AutoPauseState } from "./serverOptionsAdapter.js";

/** The one place GetServerOptions is reachable from (ADR-0012), exposed only as the
 *  allowlisted auto-pause port. It gets its own client so it never shares state with
 *  the telemetry adapter. */
export function createServerOptionsPort(config: SatisfactoryServerConfig): ServerOptionsPort {
  const vanillaApi = new VanillaApiClient({
    host: config.host,
    port: config.apiPort,
    authToken: config.apiToken,
    allowSelfSignedCert: config.apiAllowSelfSignedCert,
    timeoutMs: config.requestTimeoutMs,
  });
  return new ServerOptionsAdapter(vanillaApi, config.apiToken);
}

/** Opens the connection to one game server: the adapter whose methods are the ports the
 *  other modules' services depend on. */
export function createGameServerConnection(config: SatisfactoryServerConfig): SatisfactoryServerAdapter {
  return SatisfactoryServerAdapter.fromConfig(config);
}
