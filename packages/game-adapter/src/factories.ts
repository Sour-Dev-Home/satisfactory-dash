import type { SatisfactoryServerConfig } from "./connection.js";
import { SatisfactoryServerAdapter } from "./satisfactoryServerAdapter.js";
import { ServerOptionsAdapter } from "./serverOptionsAdapter.js";
import type { ServerOptionsPort } from "./serverOptionsAdapter.js";
import { VanillaApiClient } from "./vanillaApiClient.js";

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
    onCall: config.onUpstreamCall,
  });
  return new ServerOptionsAdapter(vanillaApi, config.apiToken);
}

/** Opens the connection to one game server: the adapter whose methods are the ports the
 *  backend's services depend on. */
export function createGameServerConnection(config: SatisfactoryServerConfig): SatisfactoryServerAdapter {
  return SatisfactoryServerAdapter.fromConfig(config);
}
