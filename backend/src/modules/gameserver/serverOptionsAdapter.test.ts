import { describe, it, expect } from "vitest";
import { UpstreamError } from "../../platform/errors.js";
import { ServerOptionsAdapter } from "./serverOptionsAdapter.js";
import type { VanillaApiClientLike } from "./satisfactoryServerAdapter.js";

// ADR-0012 / README rule: GetServerOptions output is a secret. Every test below feeds a
// response that carries a fake FRM token and checks it never leaves the adapter.
const FAKE_FRM_TOKEN = "FAKE-FRM-TOKEN-9f3a7c-do-not-leak";

/** Shaped like the live response (camelCase keys, stringified values; docs-vault
 *  vanilla-dedicated-server-api.md), with the secret in both maps. */
function optionsResponse(overrides: { autoPause?: unknown; pending?: Record<string, unknown> } = {}) {
  const autoPause = "autoPause" in overrides ? overrides.autoPause : "False";
  return {
    serverOptions: {
      "FG.DSAutoPause": autoPause,
      "FG.DSAutoSaveOnDisconnect": "True",
      "uWS.AuthenticationToken": FAKE_FRM_TOKEN,
    },
    pendingServerOptions: { ...overrides.pending },
  };
}

function fakeApi(handler: (fn: string, data?: unknown) => unknown) {
  const calls: { fn: string; data?: unknown }[] = [];
  const api: VanillaApiClientLike = {
    call: async <T>(fn: string, data?: unknown) => {
      calls.push({ fn, data });
      return handler(fn, data) as T;
    },
  };
  return { api, calls };
}

const tokenWithPrivilege = (pl: string) => `${Buffer.from(JSON.stringify({ pl })).toString("base64")}.0a1b2c3d`;

/** Everything a caller could observe from a failed call, flattened to one string. */
function describeError(err: unknown): string {
  const e = err as Error & { cause?: unknown };
  return [e.name, e.message, e.stack ?? "", JSON.stringify(e.cause ?? null), String(e.cause)].join("\n");
}

describe("readAutoPause", () => {
  it("returns only autoPause and pending, and no other option, never the token", async () => {
    const { api } = fakeApi(() => optionsResponse());
    const result = await new ServerOptionsAdapter(api, undefined).readAutoPause();
    expect(result).toEqual({ autoPause: false, pending: false });
    expect(JSON.stringify(result)).not.toContain(FAKE_FRM_TOKEN);
    expect(Object.keys(result).sort()).toEqual(["autoPause", "pending"]);
  });

  it("reads True as true, and reports a pending change from PendingServerOptions", async () => {
    const { api } = fakeApi(() => optionsResponse({ autoPause: "True", pending: { "FG.DSAutoPause": "False" } }));
    expect(await new ServerOptionsAdapter(api, undefined).readAutoPause()).toEqual({ autoPause: true, pending: true });
  });

  it("calls GetServerOptions with no body", async () => {
    const { api, calls } = fakeApi(() => optionsResponse());
    await new ServerOptionsAdapter(api, undefined).readAutoPause();
    expect(calls).toEqual([{ fn: "GetServerOptions", data: undefined }]);
  });

  it.each([
    ["the key is missing", { serverOptions: { "uWS.AuthenticationToken": FAKE_FRM_TOKEN }, pendingServerOptions: {} }],
    ["the value isn't True/False", optionsResponse({ autoPause: FAKE_FRM_TOKEN })],
    ["the value isn't a string", optionsResponse({ autoPause: { nested: FAKE_FRM_TOKEN } })],
    ["pendingServerOptions is missing", { serverOptions: { "FG.DSAutoPause": "False", t: FAKE_FRM_TOKEN } }],
    ["the response is not an object", FAKE_FRM_TOKEN],
    ["serverOptions is an array", { serverOptions: [FAKE_FRM_TOKEN], pendingServerOptions: {} }],
  ])("is a 502-class UpstreamError that never contains the token when %s", async (_name, response) => {
    const { api } = fakeApi(() => response);
    const err = await new ServerOptionsAdapter(api, undefined).readAutoPause().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect((err as UpstreamError).failureKind).toBe("invalid_response");
    expect(describeError(err)).not.toContain(FAKE_FRM_TOKEN);
  });
});

// Security review of PR 6: the shared vanilla client can attach a `cause` (a JSON.parse
// SyntaxError quoting the body) or pass an upstream `errorData` along; neither may escape.
describe("upstream errors carry no cause and no errorData", () => {
  const leaky = () =>
    Object.assign(new UpstreamError("Vanilla API returned non-JSON body", { failureKind: "invalid_response", status: 500, cause: new SyntaxError(`Unexpected token in {"uWS.AuthenticationToken":"${FAKE_FRM_TOKEN}`) }), {
      errorData: { echoed: FAKE_FRM_TOKEN },
    });
  const adapter = () =>
    new ServerOptionsAdapter(
      fakeApi(() => {
        throw leaky();
      }).api,
      tokenWithPrivilege("Administrator"),
    );

  it.each([
    ["readAutoPause", () => adapter().readAutoPause()],
    ["applyAutoPause", () => adapter().applyAutoPause(true)],
  ])("%s rethrows a clean UpstreamError, keeping kind and status", async (_name, run) => {
    const err = (await run().catch((e: unknown) => e)) as UpstreamError & { errorData?: unknown };
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.cause).toBeUndefined();
    expect(err.errorData).toBeUndefined();
    expect(err.status).toBe(500);
    expect(err.failureKind).toBe("invalid_response");
    expect(describeError(err)).not.toContain(FAKE_FRM_TOKEN);
  });

  it("canEditOptions rethrows a clean error for a non-401/403 failure", async () => {
    const err = (await adapter().canEditOptions().catch((e: unknown) => e)) as UpstreamError;
    expect(err.cause).toBeUndefined();
    expect(describeError(err)).not.toContain(FAKE_FRM_TOKEN);
  });
});

describe("applyAutoPause", () => {
  it.each([
    [true, "True"],
    [false, "False"],
  ])("sends only FG.DSAutoPause=%s as ApplyServerOptions", async (enabled, value) => {
    const { api, calls } = fakeApi(() => undefined);
    await new ServerOptionsAdapter(api, undefined).applyAutoPause(enabled);
    expect(calls).toEqual([{ fn: "ApplyServerOptions", data: { UpdatedServerOptions: { "FG.DSAutoPause": value } } }]);
  });
});

describe("canEditOptions", () => {
  it("is false without a configured token, and doesn't call the server", async () => {
    const { api, calls } = fakeApi(() => undefined);
    expect(await new ServerOptionsAdapter(api, undefined).canEditOptions()).toBe(false);
    expect(calls).toEqual([]);
  });

  // Administrator, and APIToken: an application token from server.GenerateAPIToken, which
  // third-party apps are told to use (dedicated-server-api.md:279-284).
  it.each(["Administrator", "APIToken"])("is true for a %s token the server verifies", async (pl) => {
    const { api, calls } = fakeApi(() => undefined);
    expect(await new ServerOptionsAdapter(api, tokenWithPrivilege(pl)).canEditOptions()).toBe(true);
    expect(calls).toEqual([{ fn: "VerifyAuthenticationToken", data: undefined }]);
  });

  it.each(["Client", "InitialAdmin", "NotAuthenticated", "administrator", "apitoken"])(
    "is false for a %s token, without asking the server",
    async (pl) => {
      const { api, calls } = fakeApi(() => undefined);
      expect(await new ServerOptionsAdapter(api, tokenWithPrivilege(pl)).canEditOptions()).toBe(false);
      expect(calls).toEqual([]);
    },
  );

  it.each(["not-a-token", "", "%%%.abc", `${Buffer.from("[]").toString("base64")}.abc`, `${Buffer.from('{"pl":7}').toString("base64")}.abc`])(
    "is false for a malformed token (%j)",
    async (token) => {
      const { api } = fakeApi(() => undefined);
      expect(await new ServerOptionsAdapter(api, token).canEditOptions()).toBe(false);
    },
  );

  it.each([401, 403])("is false when the server rejects the token with %i", async (status) => {
    const { api } = fakeApi(() => {
      throw new UpstreamError("rejected", { status });
    });
    expect(await new ServerOptionsAdapter(api, tokenWithPrivilege("Administrator")).canEditOptions()).toBe(false);
  });

  it("still fails when the server can't be reached (that is not 'not editable')", async () => {
    const { api } = fakeApi(() => {
      throw new UpstreamError("down", { failureKind: "unreachable" });
    });
    await expect(new ServerOptionsAdapter(api, tokenWithPrivilege("Administrator")).canEditOptions()).rejects.toBeInstanceOf(
      UpstreamError,
    );
  });
});
