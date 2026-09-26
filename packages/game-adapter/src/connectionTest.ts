import { UpstreamError } from "./errors.js";
import type { SatisfactoryServerConfig } from "./connection.js";
import { SatisfactoryServerAdapter } from "./satisfactoryServerAdapter.js";

/**
 * ADR-0030: "test connection" for a server the operator is adding or editing. It runs the two cheap
 * reads every server needs: the vanilla API's QueryServerState and FRM's getSessionInfo. The result is
 * a set of stable codes only: a message from the game server (or from anything pretending to be it)
 * never reaches the caller, and neither does the address.
 */
export type ConnectionCheckError = "unreachable" | "unauthorized" | "invalid_response";

export interface ConnectionCheck {
  ok: boolean;
  error?: ConnectionCheckError;
}

export interface ConnectionTestResult {
  ok: boolean;
  api: ConnectionCheck;
  frm: ConnectionCheck;
}

function classify(err: unknown): ConnectionCheckError {
  if (err instanceof UpstreamError) {
    if (err.status === 401 || err.status === 403) return "unauthorized";
    if (err.failureKind === "invalid_response") return "invalid_response";
  }
  // Everything else (a refused connection, a timeout, a TLS failure, an unclassified error) is "unreachable".
  return "unreachable";
}

async function check(run: () => Promise<unknown>): Promise<ConnectionCheck> {
  try {
    await run();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: classify(err) };
  }
}

export async function testGameServerConnection(
  config: SatisfactoryServerConfig,
  // Injectable for tests; production builds the real adapter from the config.
  adapter: Pick<SatisfactoryServerAdapter, "getServerStatus" | "getSessionInfo"> = SatisfactoryServerAdapter.fromConfig(config),
): Promise<ConnectionTestResult> {
  const [api, frm] = await Promise.all([check(() => adapter.getServerStatus()), check(() => adapter.getSessionInfo())]);
  return { ok: api.ok && frm.ok, api, frm };
}
