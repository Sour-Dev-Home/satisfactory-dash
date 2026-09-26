import { describe, expect, it } from "vitest";
import { UpstreamError } from "../../platform/errors.js";
import { createSatisfactoryServerConfig } from "./connectionConfig.js";
import { testGameServerConnection } from "./connectionTest.js";

const config = createSatisfactoryServerConfig({ host: "127.0.0.1", apiPort: 7777, apiToken: "api-token-abc", frmPort: 8080 });
const ok = async () => ({});
const failing = (err: unknown) => async () => {
  throw err;
};
const adapter = (status: () => Promise<unknown>, session: () => Promise<unknown>) =>
  ({ getServerStatus: status, getSessionInfo: session }) as never;

describe("testGameServerConnection", () => {
  it("passes when both reads succeed", async () => {
    expect(await testGameServerConnection(config, adapter(ok, ok))).toEqual({ ok: true, api: { ok: true }, frm: { ok: true } });
  });

  it.each([
    ["a refused connection or timeout", new UpstreamError("boom", { failureKind: "unreachable" }), "unreachable"],
    ["a rejected token (401)", new UpstreamError("nope", { status: 401 }), "unauthorized"],
    ["a forbidden token (403)", new UpstreamError("nope", { status: 403 }), "unauthorized"],
    ["a response of the wrong shape", new UpstreamError("bad", { failureKind: "invalid_response" }), "invalid_response"],
    ["an unclassified game server error", new UpstreamError("odd", { status: 500 }), "unreachable"],
    ["an error that is not an UpstreamError", new TypeError("fetch failed"), "unreachable"],
  ])("reports %s as a stable code", async (_label, err, code) => {
    const result = await testGameServerConnection(config, adapter(failing(err), ok));
    expect(result).toEqual({ ok: false, api: { ok: false, error: code }, frm: { ok: true } });
  });

  it("checks the two sides independently", async () => {
    const result = await testGameServerConnection(config, adapter(ok, failing(new UpstreamError("x", { status: 401 }))));
    expect(result).toEqual({ ok: false, api: { ok: true }, frm: { ok: false, error: "unauthorized" } });
  });

  it("never carries the game server's message, an address or a token", async () => {
    const leak = new UpstreamError("connect ECONNREFUSED 192.168.1.20:7777 token=api-token-abc", { failureKind: "unreachable" });
    const result = await testGameServerConnection(config, adapter(failing(leak), failing(leak)));
    const json = JSON.stringify(result);
    expect(json).not.toContain("192.168");
    expect(json).not.toContain("api-token-abc");
    expect(json).not.toContain("ECONNREFUSED");
  });
});
