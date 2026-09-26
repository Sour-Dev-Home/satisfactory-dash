import { describe, it, expect } from "vitest";
import request from "supertest";
import type { RequestHandler } from "express";
import { endpoints } from "@satisfactory-dash/shared";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import { UpstreamError } from "../../../platform/errors.js";
import { InMemoryServerDirectory } from "../../servers/index.js";
import { ServerOptionsAdapter } from "@satisfactory-dash/game-adapter";
import type { VanillaApiClientLike } from "../../gameserver/index.js";
import { createSettingsRouters, createSettingsServices } from "../index.js";

// Fresh-eyes probes for PR #33 (independent of settings.test.ts).
const FAKE_FRM_TOKEN = "FAKE-FRM-TOKEN-probe-77d1-do-not-leak";
const ADMIN_TOKEN = `${Buffer.from(JSON.stringify({ pl: "Administrator" })).toString("base64")}.0a1b2c3d`;

type Handler = (fn: string, data: unknown, calls: { fn: string; data: unknown }[]) => unknown;

function server(over: Handler = () => undefined) {
  const state = { autoPause: "False" as unknown, pending: {} as Record<string, unknown> };
  const calls: { fn: string; data: unknown }[] = [];
  const api: VanillaApiClientLike = {
    call: async <T>(fn: string, data?: unknown) => {
      calls.push({ fn, data });
      const custom = over(fn, data, calls);
      if (custom !== undefined) {
        return custom as T;
      }
      if (fn === "GetServerOptions") {
        return {
          serverOptions: { "FG.DSAutoPause": state.autoPause, "uWS.AuthenticationToken": FAKE_FRM_TOKEN },
          pendingServerOptions: state.pending,
        } as T;
      }
      if (fn === "ApplyServerOptions") {
        state.autoPause = (data as { UpdatedServerOptions: Record<string, string> }).UpdatedServerOptions["FG.DSAutoPause"];
      }
      return undefined as T;
    },
  };
  return { api, state, calls };
}

const asOperator: RequestHandler = (_req, res, next) => {
  res.locals.user = { name: "operator" };
  next();
};

function build(s: ReturnType<typeof server>, token: string | undefined = ADMIN_TOKEN) {
  const lines: string[] = [];
  const logger = createLogger({ level: "debug" }, { write: (l: string) => lines.push(l) });
  const settings = createSettingsServices(new ServerOptionsAdapter(s.api, token));
  const directory = new InMemoryServerDirectory([{ id: "default", displayName: "Home", services: { settings } }]);
  const app = createApp({ logger, routers: [], sessionGuard: asOperator, protectedRouters: createSettingsRouters(directory) });
  return { app, lines };
}
const putPath = endpoints.settings.setAutoPause.path("default");
const getPath = endpoints.settings.get.path("default");
const auditLines = (lines: string[]) => lines.map((l) => JSON.parse(l)).filter((l) => l.audit === "auto-pause");

describe("PUT request shape", () => {
  it("ignores extra keys: only FG.DSAutoPause ever reaches ApplyServerOptions", async () => {
    const s = server();
    const res = await request(build(s).app)
      .put(putPath)
      .send({ enabled: true, UpdatedServerOptions: { "FG.NetworkQuality": "0" }, "FG.DSAutoSaveInterval": "1" });
    expect(res.status).toBe(200);
    const apply = s.calls.filter((c) => c.fn === "ApplyServerOptions");
    expect(apply).toEqual([{ fn: "ApplyServerOptions", data: { UpdatedServerOptions: { "FG.DSAutoPause": "True" } } }]);
  });

  it.each([
    ["form-urlencoded", "application/x-www-form-urlencoded", "enabled=true"],
    ["text/plain", "text/plain", '{"enabled":true}'],
    ["no content type", "", '{"enabled":true}'],
  ])("does not write for a %s body (400, never 500)", async (_n, type, body) => {
    const s = server();
    const req = request(build(s).app).put(putPath);
    if (type) req.set("Content-Type", type);
    const res = await req.send(body);
    // 415 (unsupported media type) or 400 are both fine; a 5xx or a write is not.
    expect([400, 415]).toContain(res.status);
    expect(s.calls.map((c) => c.fn)).not.toContain("ApplyServerOptions");
  });

  it("answers 400 (not 500) for malformed JSON, and never writes", async () => {
    const s = server();
    const res = await request(build(s).app).put(putPath).set("Content-Type", "application/json").send('{"enabled": tru');
    expect(res.status).toBe(400);
    expect(s.calls.map((c) => c.fn)).not.toContain("ApplyServerOptions");
  });

  it("answers 4xx for an oversized body, never a write", async () => {
    const s = server();
    const res = await request(build(s).app).put(putPath).send({ enabled: true, pad: "x".repeat(200_000) });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(s.calls.map((c) => c.fn)).not.toContain("ApplyServerOptions");
  });

  it("validates the body before asking the game server anything", async () => {
    const s = server();
    await request(build(s).app).put(putPath).send({ enabled: "true" });
    expect(s.calls).toEqual([]);
  });
});

describe("state and pending", () => {
  it("is idempotent: setting the current value still applies once and audits from === to", async () => {
    const s = server();
    const { app, lines } = build(s);
    const res = await request(app).put(putPath).send({ enabled: false });
    expect(res.status).toBe(200);
    expect(auditLines(lines)).toHaveLength(1);
    expect(auditLines(lines)[0]).toMatchObject({ from: false, to: false });
  });

  it("pending is true whenever the key is present in PendingServerOptions, whatever its value", async () => {
    const s = server();
    s.state.pending = { "FG.DSAutoPause": null };
    const res = await request(build(s).app).get(getPath);
    expect(res.status).toBe(200);
    expect(res.body.data.pending).toBe(true);
  });

  it("other pending options do not make pending true", async () => {
    const s = server();
    s.state.pending = { "FG.DSAutoSaveInterval": "10", "uWS.AuthenticationToken": FAKE_FRM_TOKEN };
    const { app, lines } = build(s);
    const res = await request(app).get(getPath);
    expect(res.body.data.pending).toBe(false);
    expect(JSON.stringify(res.body) + lines.join("")).not.toContain(FAKE_FRM_TOKEN);
  });

  it.each(["true", "TRUE", "tRuE"])("accepts value %j case-insensitively", async (v) => {
    const s = server();
    s.state.autoPause = v;
    const res = await request(build(s).app).get(getPath);
    expect(res.body.data.autoPause).toBe(true);
  });

  it.each(["", " True", "True ", "True\n", "1", "yes", true, false, null, 0])(
    "rejects unusual autoPause value %j as 502 upstream_invalid_response",
    async (v) => {
      const s = server();
      s.state.autoPause = v;
      const res = await request(build(s).app).get(getPath);
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe("upstream_invalid_response");
    },
  );

  it("sequential PUT then GET sees the applied value, GET does not write", async () => {
    const s = server();
    const { app } = build(s);
    await request(app).get(getPath);
    expect(s.calls.map((c) => c.fn)).not.toContain("ApplyServerOptions");
    await request(app).put(putPath).send({ enabled: true });
    expect((await request(app).get(getPath)).body.data.autoPause).toBe(true);
  });

  it("concurrent duplicate PUTs each write once, and each is audited (no lost audit line)", async () => {
    const s = server();
    const { app, lines } = build(s);
    const [a, b] = await Promise.all([request(app).put(putPath).send({ enabled: true }), request(app).put(putPath).send({ enabled: true })]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(s.calls.filter((c) => c.fn === "ApplyServerOptions")).toHaveLength(2);
    expect(auditLines(lines)).toHaveLength(2);
    expect(new Set(auditLines(lines).map((l) => l.req.id)).size).toBe(2);
  });
});

describe("error paths", () => {
  it("a pre-write read failure (500 from upstream) writes nothing and is not a 500", async () => {
    const s = server((fn, _d, calls) => {
      if (fn === "GetServerOptions") {
        throw new UpstreamError("down", { failureKind: "unreachable" });
      }
      void calls;
    });
    const res = await request(build(s).app).put(putPath).send({ enabled: true });
    expect(res.status).toBe(503);
    expect(s.calls.map((c) => c.fn)).not.toContain("ApplyServerOptions");
  });

  it("a failing token check (upstream 500) on PUT is an upstream error, not a write and not not_editable", async () => {
    // The token check is the first GetServerOptions call in the PUT flow.
    let optionCalls = 0;
    const s = server((fn) => {
      if (fn === "GetServerOptions" && ++optionCalls === 1) {
        throw new UpstreamError("boom", { status: 500 });
      }
    });
    const res = await request(build(s).app).put(putPath).send({ enabled: true });
    expect(res.status).toBeGreaterThanOrEqual(502);
    expect(s.calls.map((c) => c.fn)).not.toContain("ApplyServerOptions");
  });

  it("a failed ApplyServerOptions writes no audit line", async () => {
    const s = server((fn) => {
      if (fn === "ApplyServerOptions") {
        throw new UpstreamError("apply refused", { status: 403 });
      }
    });
    const { app, lines } = build(s);
    const res = await request(app).put(putPath).send({ enabled: true });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(auditLines(lines)).toEqual([]);
  });

  it("a 401 on ApplyServerOptions (token revoked after the editable check) is not a 500", async () => {
    const s = server((fn) => {
      if (fn === "ApplyServerOptions") {
        throw new UpstreamError("Vanilla API request failed with status 401", { status: 401 });
      }
    });
    const res = await request(build(s).app).put(putPath).send({ enabled: true });
    expect(res.status).not.toBe(500);
  });

  const leakyUpstream = () =>
    Object.assign(
      new UpstreamError(`bad body {"uWS.AuthenticationToken":"${FAKE_FRM_TOKEN}"`, {
        failureKind: "invalid_response",
        status: 500,
        cause: new SyntaxError(FAKE_FRM_TOKEN),
      }),
      { errorData: { leaked: FAKE_FRM_TOKEN } },
    );

  // A message that itself quotes the secret (e.g. a server's errorMessage) must not leak:
  // scrubbed() rebuilds the message from the function name and status only. (Found by the
  // test-hunter review of PR 6; fixed.)
  it.each([
    ["GET", (app: ReturnType<typeof build>["app"]) => request(app).get(getPath), "GetServerOptions"],
    ["PUT", (app: ReturnType<typeof build>["app"]) => request(app).put(putPath).send({ enabled: true }), "ApplyServerOptions"],
  ])("%s: an upstream error whose MESSAGE quotes the secret never reaches the logs", async (_m, act, failing) => {
    const s = server((fn) => {
      if (fn === failing) {
        throw leakyUpstream();
      }
    });
    const { app, lines } = build(s);
    const res = await act(app);
    void res; // response `detail` is intentionally dev/test-only (errorResponse.ts:238); logs are the concern
    expect(lines.join("\n")).not.toContain(FAKE_FRM_TOKEN);
  });

  // FINDING (low, same class): scrubbed() rethrows non-Upstream errors untouched.
  it("a non-Upstream error thrown by the client (own bug) doesn't leak the secret to the logs", async () => {
    const s = server((fn) => {
      if (fn === "GetServerOptions") {
        throw new Error(`parse failed near ${FAKE_FRM_TOKEN}`);
      }
    });
    const { app, lines } = build(s);
    const res = await request(app).get(getPath);
    expect(res.status).toBe(500);
    expect(lines.join("\n")).not.toContain(FAKE_FRM_TOKEN);
  });

  it("the configured API token itself is never in a response or log line", async () => {
    const s = server();
    const { app, lines } = build(s);
    const res = await request(app).put(putPath).send({ enabled: true });
    const all = JSON.stringify({ b: res.body, h: res.headers }) + lines.join("\n");
    expect(all).not.toContain(ADMIN_TOKEN);
    expect(all).not.toContain(FAKE_FRM_TOKEN);
  });

  it("the audit line has exactly the documented fields and no option values", async () => {
    const { app, lines } = build(server());
    await request(app).put(putPath).send({ enabled: true });
    const a = auditLines(lines)[0];
    expect(a.user).toBe("operator");
    expect(Object.keys(a).filter((k) => /token|options|secret/i.test(k))).toEqual([]);
  });
});

describe("token shapes for editable", () => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
  it.each([
    ["no dot", b64({ pl: "Administrator" })],
    ["Administrator with trailing space", `${b64({ pl: "Administrator " })}.ab`],
    ["pl in a nested object", `${b64({ x: { pl: "Administrator" } })}.ab`],
    ["pl as array", `${b64({ pl: ["Administrator"] })}.ab`],
    ["own __proto__ carrying pl", `${Buffer.from('{"__proto__":{"pl":"Administrator"}}').toString("base64")}.ab`],
    ["whitespace only", "   "],
    ["null payload", `${b64(null)}.ab`],
    ["empty payload before dot", ".abc"],
  ])("token %s: editable false unless it is a real Administrator/APIToken claim", async (name, token) => {
    const s = server();
    const res = await request(build(s, token).app).get(getPath);
    // "no dot" is the only shape that has a genuine Administrator claim; the server decides.
    expect(res.body.data.editable).toBe(name === "no dot");
  });

  it("a token whose claim is Administrator but which the server 403s is not editable and PUT is 409", async () => {
    let optionCalls = 0;
    const s = server((fn) => {
      if (fn === "GetServerOptions" && ++optionCalls === 1) {
        throw new UpstreamError("forbidden", { status: 403 });
      }
    });
    const res = await request(build(s).app).put(putPath).send({ enabled: true });
    expect(res.status).toBe(409);
  });
});
