import { describe, it, expect } from "vitest";
import request from "supertest";
import type { RequestHandler } from "express";
import { ApiErrorResponseSchema, SettingsResponseSchema, endpoints } from "@satisfactory-dash/shared";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import { UpstreamError } from "../../../platform/errors.js";
import { InMemoryServerDirectory } from "../../servers/index.js";
import { ServerOptionsAdapter } from "../../gameserver/serverOptionsAdapter.js";
import type { VanillaApiClientLike } from "../../gameserver/satisfactoryServerAdapter.js";
import { createSettingsRouters, createSettingsServices } from "../index.js";

const FAKE_FRM_TOKEN = "FAKE-FRM-TOKEN-9f3a7c-do-not-leak";
const ADMIN_TOKEN = `${Buffer.from(JSON.stringify({ pl: "Administrator" })).toString("base64")}.0a1b2c3d`;

/** A game server that keeps FG.DSAutoPause in memory, always returns the fake FRM token
 *  in GetServerOptions (as the real one does), and records every call. */
function fakeGameServer(
  opts: {
    queueChanges?: boolean;
    rejectToken?: boolean;
    verifyFails?: boolean;
    refuseApply?: boolean;
    failReadAfterApply?: boolean;
    /** The write's response is lost (a deadline or a dropped connection): before the server
     *  applied anything, or after it applied the value. */
    dropApply?: "before-write" | "after-write";
    /** The write fails with a plain HTTP 500 (no transport failure). */
    apply500?: boolean;
    initialAutoPause?: "True" | "False";
    garbage?: unknown;
  } = {},
) {
  const state = { autoPause: (opts.initialAutoPause ?? "False") as string, pending: undefined as string | undefined };
  const calls: string[] = [];
  let optionCalls = 0;
  const api: VanillaApiClientLike = {
    call: async <T>(fn: string, data?: unknown) => {
      calls.push(fn);
      if (fn === "GetServerOptions") {
        optionCalls += 1;
        if (opts.rejectToken) {
          throw new UpstreamError("Vanilla API request failed with status 401", { status: 401 });
        }
        // The token check is a GetServerOptions call too; in a GET it is the second one.
        if (opts.verifyFails && optionCalls % 2 === 0) {
          throw new UpstreamError("Vanilla API request failed with status 500", { status: 500 });
        }
        if (opts.failReadAfterApply && calls.includes("ApplyServerOptions")) {
          throw new UpstreamError("down", { failureKind: "unreachable" });
        }
        if (opts.garbage !== undefined) {
          return opts.garbage as T;
        }
        return {
          serverOptions: { "FG.DSAutoPause": state.autoPause, "uWS.AuthenticationToken": FAKE_FRM_TOKEN },
          pendingServerOptions: state.pending === undefined ? {} : { "FG.DSAutoPause": state.pending },
        } as T;
      }
      if (fn === "ApplyServerOptions") {
        if (opts.refuseApply) {
          throw new UpstreamError("Vanilla API request failed with status 403", { status: 403 });
        }
        if (opts.apply500) {
          throw new UpstreamError("Vanilla API request failed with status 500", { status: 500 });
        }
        if (opts.dropApply === "before-write") {
          throw new UpstreamError("Vanilla API request failed", { failureKind: "unreachable" });
        }
        const value = (data as { UpdatedServerOptions: Record<string, string> }).UpdatedServerOptions["FG.DSAutoPause"];
        if (opts.queueChanges) {
          state.pending = value;
        } else {
          state.autoPause = value;
        }
        if (opts.dropApply === "after-write") {
          throw new UpstreamError("Vanilla API request failed", { failureKind: "unreachable" });
        }
        return undefined as T;
      }
      throw new Error(`unexpected call ${fn}`);
    },
  };
  return { api, state, calls };
}

const asOperator: RequestHandler = (_req, res, next) => {
  res.locals.user = { name: "operator" };
  next();
};

/** `apiToken: null` = no token configured (undefined would pick the default). */
function buildApp(server: ReturnType<typeof fakeGameServer>, apiToken: string | null = ADMIN_TOKEN) {
  const lines: string[] = [];
  const logger = createLogger({ level: "info" }, { write: (line: string) => lines.push(line) });
  const settings = createSettingsServices(new ServerOptionsAdapter(server.api, apiToken ?? undefined));
  const directory = new InMemoryServerDirectory([{ id: "default", displayName: "Home", services: { settings } }]);
  const app = createApp({
    logger,
    routers: [],
    sessionGuard: asOperator,
    protectedRouters: createSettingsRouters(directory),
  });
  return { app, lines };
}

const get = (app: ReturnType<typeof buildApp>["app"]) => request(app).get(endpoints.settings.get.path("default"));
const put = (app: ReturnType<typeof buildApp>["app"], body: unknown) =>
  request(app)
    .put(endpoints.settings.setAutoPause.path("default"))
    .set("Content-Type", "application/json")
    .send(JSON.stringify(body));

describe("GET /api/servers/:serverId/settings", () => {
  it("returns the settings envelope: autoPause, pending and editable", async () => {
    const { app } = buildApp(fakeGameServer());
    const res = await get(app);
    expect(res.status).toBe(200);
    expect(SettingsResponseSchema.parse(res.body)).toEqual(res.body);
    expect(res.body).toMatchObject({ serverId: "default", stale: false, data: { autoPause: false, pending: false, editable: true } });
  });

  it("is read-only (editable: false) with no token configured, without a second token-check call", async () => {
    const server = fakeGameServer();
    const res = await get(buildApp(server, null).app);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ autoPause: false, pending: false, editable: false });
    expect(server.calls).toEqual(["GetServerOptions"]);
  });

  it("fails the read as upstream_auth_rejected when the server rejects the token (nothing is readable)", async () => {
    const res = await get(buildApp(fakeGameServer({ rejectToken: true })).app);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("upstream_auth_rejected");
  });

  it("degrades to read-only, not an error, when the token check itself fails", async () => {
    const res = await get(buildApp(fakeGameServer({ verifyFails: true })).app);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ autoPause: false, pending: false, editable: false });
  });

  it("answers 404 server_not_found for an unknown server id", async () => {
    const res = await request(buildApp(fakeGameServer()).app).get(endpoints.settings.get.path("nope"));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("server_not_found");
  });
});

describe("PUT /api/servers/:serverId/settings/auto-pause", () => {
  it("applies the change, re-reads it and returns the settings envelope", async () => {
    const server = fakeGameServer();
    const res = await put(buildApp(server).app, { enabled: true });
    expect(res.status).toBe(200);
    expect(SettingsResponseSchema.parse(res.body)).toEqual(res.body);
    expect(res.body.data).toEqual({ autoPause: true, pending: false, editable: true });
    expect(server.state.autoPause).toBe("True");
    expect(server.calls.filter((c) => c === "ApplyServerOptions")).toHaveLength(1);
  });

  it("reports a change the server queued as pending, with the applied value unchanged", async () => {
    const res = await put(buildApp(fakeGameServer({ queueChanges: true })).app, { enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ autoPause: false, pending: true, editable: true });
  });

  it("writes one audit line with the request id, server, user and old -> new value", async () => {
    const { app, lines } = buildApp(fakeGameServer());
    const res = await put(app, { enabled: true });
    const audit = lines.map((l) => JSON.parse(l)).filter((l) => l.audit === "auto-pause");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ serverId: "default", user: "operator", from: false, to: true, req: { id: res.headers["x-request-id"] } });
  });

  it("still writes the audit line when the re-read after the write fails", async () => {
    const server = fakeGameServer({ failReadAfterApply: true });
    const { app, lines } = buildApp(server);
    const res = await put(app, { enabled: true });
    expect(res.status).toBe(503);
    expect(server.state.autoPause).toBe("True");
    const audit = lines.map((l) => JSON.parse(l)).filter((l) => l.audit === "auto-pause");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ user: "operator", from: false, to: true });
  });

  // The request deadline is overall now, so a slow-but-steady write response can be cut after
  // the server applied it. Setting the option is idempotent: one read-back decides the outcome.
  describe("when the write's response is lost (a deadline or a dropped connection)", () => {
    const auditLines = (lines: string[]) => lines.map((l) => JSON.parse(l)).filter((l) => l.audit === "auto-pause");

    it("answers 200 when a re-read shows the requested value: the write landed", async () => {
      const server = fakeGameServer({ dropApply: "after-write" });
      const { app } = buildApp(server);
      const res = await put(app, { enabled: true });
      expect(res.status).toBe(200);
      expect(SettingsResponseSchema.parse(res.body)).toEqual(res.body);
      expect(res.body.data).toEqual({ autoPause: true, pending: false, editable: true });
      expect(server.state.autoPause).toBe("True");
      expect(server.calls.filter((c) => c === "ApplyServerOptions")).toHaveLength(1); // the write is never retried
      // token check + the read before the write + exactly ONE read-back (no second re-read)
      expect(server.calls.filter((c) => c === "GetServerOptions")).toHaveLength(3);
    });

    it("writes one audit line that says the outcome was confirmed by the re-read", async () => {
      const { app, lines } = buildApp(fakeGameServer({ dropApply: "after-write" }));
      const res = await put(app, { enabled: true });
      const audit = auditLines(lines);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        serverId: "default",
        user: "operator",
        from: false,
        to: true,
        outcome: "confirmed by re-read",
        msg: "auto-pause changed (outcome confirmed by re-read)",
        req: { id: res.headers["x-request-id"] },
      });
    });

    it("a normal success has no outcome field on its audit line", async () => {
      const { app, lines } = buildApp(fakeGameServer());
      await put(app, { enabled: true });
      const [line] = auditLines(lines);
      expect(line).not.toHaveProperty("outcome");
      expect(line.msg).toBe("auto-pause changed");
    });

    it("stays the 503 upstream_unreachable when the re-read shows the OLD value: the write did not land", async () => {
      const server = fakeGameServer({ dropApply: "before-write" });
      const { app, lines } = buildApp(server);
      const res = await put(app, { enabled: true });
      expect(res.status).toBe(503);
      expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("upstream_unreachable");
      expect(server.state.autoPause).toBe("False");
      expect(auditLines(lines)).toEqual([]); // nothing changed, so nothing is audited
    });

    it("stays the 503 when the re-read fails too, with no audit line (the outcome is unknown)", async () => {
      const server = fakeGameServer({ dropApply: "after-write", failReadAfterApply: true });
      const { app, lines } = buildApp(server);
      const res = await put(app, { enabled: true });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("upstream_unreachable");
      expect(auditLines(lines)).toEqual([]);
    });

    it("a change the server queued as pending does not count as landed: the applied value is still the old one", async () => {
      const server = fakeGameServer({ dropApply: "after-write", queueChanges: true });
      const res = await put(buildApp(server).app, { enabled: true });
      expect(res.status).toBe(503);
    });

    it("if the option already held the requested value, a lost write is a success (the wanted end state is in effect)", async () => {
      const server = fakeGameServer({ dropApply: "before-write", initialAutoPause: "True" });
      const { app, lines } = buildApp(server);
      const res = await put(app, { enabled: true });
      expect(res.status).toBe(200);
      expect(res.body.data.autoPause).toBe(true);
      expect(auditLines(lines)[0]).toMatchObject({ from: true, to: true, outcome: "confirmed by re-read" });
    });

    it("works the same for turning auto-pause off", async () => {
      const server = fakeGameServer({ dropApply: "after-write", initialAutoPause: "True" });
      const res = await put(buildApp(server).app, { enabled: false });
      expect(res.status).toBe(200);
      expect(res.body.data.autoPause).toBe(false);
    });

    it("does NOT re-read after a write the server answered with a plain HTTP error", async () => {
      const server = fakeGameServer({ apply500: true });
      const { app, lines } = buildApp(server);
      const res = await put(app, { enabled: true });
      expect(res.status).not.toBe(200);
      expect(server.calls.filter((c) => c === "GetServerOptions")).toHaveLength(2); // token check + the read before
      expect(auditLines(lines)).toEqual([]);
    });
  });

  it("answers 409 not_editable, with no audit line, when the server refuses the write for lack of privilege", async () => {
    const { app, lines } = buildApp(fakeGameServer({ refuseApply: true }));
    const res = await put(app, { enabled: true });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("not_editable");
    expect(lines.filter((l) => JSON.parse(l).audit === "auto-pause")).toEqual([]);
  });

  it("answers 409 not_editable, and never writes, when no token is configured", async () => {
    const server = fakeGameServer();
    const { app, lines } = buildApp(server, null);
    const res = await put(app, { enabled: true });
    expect(res.status).toBe(409);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("not_editable");
    expect(server.calls).not.toContain("ApplyServerOptions");
    expect(lines.filter((l) => JSON.parse(l).audit === "auto-pause")).toEqual([]);
  });

  it("answers 409 not_editable, and never writes, when the server rejects the token", async () => {
    const server = fakeGameServer({ rejectToken: true });
    const res = await put(buildApp(server).app, { enabled: false });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("not_editable");
    expect(server.calls).not.toContain("ApplyServerOptions");
  });

  it.each([{}, { enabled: "yes" }, { enabled: 1 }, [], null])("answers 400 bad_request for the body %j, and never writes", async (body) => {
    const server = fakeGameServer();
    const res = await put(buildApp(server).app, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("bad_request");
    expect(server.calls).not.toContain("ApplyServerOptions");
  });

  it("answers 404 for a wrong method on the same path", async () => {
    const res = await request(buildApp(fakeGameServer()).app).post(endpoints.settings.setAutoPause.path("default"));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });
});

describe("the FRM token from GetServerOptions (ADR-0012)", () => {
  const scenarios: [string, (app: ReturnType<typeof buildApp>["app"]) => request.Test, Parameters<typeof fakeGameServer>[0]][] = [
    ["GET ok", (app) => get(app), {}],
    ["PUT ok", (app) => put(app, { enabled: true }), {}],
    ["PUT queued", (app) => put(app, { enabled: true }), { queueChanges: true }],
    ["GET with a malformed options response", (app) => get(app), { garbage: { serverOptions: { "FG.DSAutoPause": FAKE_FRM_TOKEN }, pendingServerOptions: {} } }],
    ["PUT with a malformed options response", (app) => put(app, { enabled: true }), { garbage: FAKE_FRM_TOKEN }],
    ["GET when the key is missing", (app) => get(app), { garbage: { serverOptions: { "uWS.AuthenticationToken": FAKE_FRM_TOKEN }, pendingServerOptions: {} } }],
  ];

  it.each(scenarios)("appears in no response body, header or log line: %s", async (_name, act, serverOpts) => {
    const { app, lines } = buildApp(fakeGameServer(serverOpts));
    const res = await act(app);
    expect(JSON.stringify({ body: res.body, text: res.text, headers: res.headers })).not.toContain(FAKE_FRM_TOKEN);
    expect(lines.join("\n")).not.toContain(FAKE_FRM_TOKEN);
  });

  it("a malformed options response is a 502 upstream_invalid_response, not a 500", async () => {
    const res = await get(buildApp(fakeGameServer({ garbage: { nope: true } })).app);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("upstream_invalid_response");
  });
});
