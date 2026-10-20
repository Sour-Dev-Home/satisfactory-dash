/**
 * The three dedicated-server API calls the clean stop needs (ADR-0040), over the game-adapter's VanillaApiClient. The
 * server answers on the agent's configured host and port with a self-signed certificate, so that is accepted, as the
 * agent does for its loopback or private host.
 *
 * The token is the application token from the agent's store. It goes only into the request's Authorization header:
 * every error that leaves here is rebuilt from its message with the token cut out, so no caller can show or log it.
 *
 * Call shapes: `QueryServerState`'s response is captured (raw-sources/captured-responses/vanilla-QueryServerState-*.json,
 * camelCase `serverGameState.activeSessionName`). `SaveGame` and `Shutdown` are listed in
 * raw-sources/dedicated-server-api.md without their request fields; `SaveName` comes from runbooks/go-live-api.md.
 * [NEEDS VERIFICATION] the `SaveGame` request field and that `Shutdown` takes no data.
 */
import { VanillaApiClient, type VanillaApiTransport } from "@satisfactory-dash/game-adapter";
import { z } from "zod";

export interface GameApi {
  saveGame(name: string): Promise<void>;
  shutdown(): Promise<void>;
  sessionName(): Promise<string>;
}

/** Saving a large world can take a while; the client's 5 s default is for reads. */
export const GAME_API_TIMEOUT_MS = 30_000;

const serverState = z.object({ serverGameState: z.object({ activeSessionName: z.string() }) });

export function createGameApi(opts: {
  host: string;
  port: number;
  token: string;
  /** Tests only: replaces the HTTPS request. */
  transport?: VanillaApiTransport;
}): GameApi {
  const client = new VanillaApiClient({
    host: opts.host,
    port: opts.port,
    authToken: opts.token,
    allowSelfSignedCert: true,
    timeoutMs: GAME_API_TIMEOUT_MS,
    transport: opts.transport,
  });

  async function call<T>(fn: string, data?: unknown): Promise<T> {
    try {
      return await client.call<T>(fn, data);
    } catch (err) {
      throw new Error(redact(`${fn} failed: ${err instanceof Error ? err.message : String(err)}`, opts.token));
    }
  }

  return {
    async sessionName() {
      const parsed = serverState.safeParse(await call<unknown>("QueryServerState"));
      const name = parsed.success ? parsed.data.serverGameState.activeSessionName.trim() : "";
      if (name === "") throw new Error("QueryServerState returned no active session to save");
      return name;
    },
    async saveGame(name) {
      // [NEEDS VERIFICATION] the request field; see the header.
      await call("SaveGame", { SaveName: name });
    },
    async shutdown() {
      await call("Shutdown");
    },
  };
}

/** Cuts every copy of the token out of a message (a server or proxy could echo a header back). */
export function redact(text: string, token: string): string {
  return token === "" ? text : text.split(token).join("[token]");
}
