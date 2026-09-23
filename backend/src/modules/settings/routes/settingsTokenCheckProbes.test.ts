import { describe, it, expect } from "vitest";
import request from "supertest";
import type { RequestHandler } from "express";
import { endpoints } from "@satisfactory-dash/shared";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import { UpstreamError } from "../../../platform/errors.js";
import { InMemoryServerDirectory } from "../../servers/index.js";
import { ServerOptionsAdapter } from "../../gameserver/serverOptionsAdapter.js";
import type { VanillaApiClientLike } from "../../gameserver/satisfactoryServerAdapter.js";
import { createSettingsRouters, createSettingsServices } from "../index.js";

// Fresh-eyes probes for PR #41 (token check via GetServerOptions, write refusal -> 409).
const FAKE_FRM_TOKEN = "FAKE-FRM-TOKEN-pr41-9e1c-do-not-leak";
const tokenWith = (pl: string) => `${Buffer.from(JSON.stringify({ pl })).toString("base64")}.0a1b2c3d`;
const ADMIN = tokenWith("Administrator");

const up = (status?: number, msg = `boom ${FAKE_FRM_TOKEN}`) =>
  new UpstreamError(msg, { status, failureKind: status === undefined ? "network" : "http_status" } as never);

/** Scripted server: `plan[fn]` is called with the 1-based call index for that fn. */
function server(plan: Record<string, (n: number) => unknown> = {}) {
  const counts: Record<string, number> = {};
  const calls: string[] = [];
  let autoPause = "False";
  const api: VanillaApiClientLike = {
    call: async <T>(fn: string, data?: unknown) => {
      calls.push(fn);
      counts[fn] = (counts[fn] ?? 0) + 1;
      const custom = plan[fn]?.(counts[fn]);
      if (custom instanceof Error) throw custom;
      if (custom !== undefined) return custom as T;
      if (fn === "GetServerOptions") {
        return {
          serverOptions: { "FG.DSAutoPause": autoPause, "uWS.AuthenticationToken": FAKE_FRM_TOKEN },
          pendingServerOptions: {},
        } as T;
      }
      if (fn === "ApplyServerOptions") {
        autoPause = (data as { UpdatedServerOptions: Record<string, string> }).UpdatedServerOptions["FG.DSAutoPause"];
      }
      return undefined as T;
    },
  };
  return { api, calls };
}

const asOperator: RequestHandler = (_req, res, next) => {
  res.locals.user = { name: "operator" };
  next();
};
function build(s: ReturnType<typeof server>, token: string | undefined = ADMIN) {
  const lines: string[] = [];
  const logger = createLogger({ level: "debug" }, { write: (l: string) => lines.push(l) });
  const settings = createSettingsServices(new ServerOptionsAdapter(s.api, token));
  const directory = new InMemoryServerDirectory([{ id: "default", displayName: "Home", services: { settings } }]);
  const app = createApp({ logger, routers: [], sessionGuard: asOperator, protectedRouters: createSettingsRouters(directory) });
  return { app, lines };
}
const putPath = endpoints.settings.setAutoPause.path("default");
const getPath = endpoints.settings.get.path("default");
const audits = (lines: string[]) => lines.map((l) => JSON.parse(l)).filter((l) => l.audit === "auto-pause");
const put = (app: ReturnType<typeof build>["app"]) => request(app).put(putPath).send({ enabled: true });

describe("canEditOptions (adapter)", () => {
  it.each([401, 403])("token with an accepted pl but a %s from the check is never editable:true", async (status) => {
    const s = server({ GetServerOptions: () => up(status) });
    const res = await request(build(s).app).get(getPath);
    // read also 401s, so GET fails; the point is that it never reports editable:true
    expect(JSON.stringify(res.body)).not.toContain('"editable":true');
    expect(JSON.stringify(res.body)).not.toContain(FAKE_FRM_TOKEN);
  });

  it("adapter: 401/403 -> false, 500 / unreachable -> throws, none leak the token", async () => {
    for (const status of [401, 403]) {
      const a = new ServerOptionsAdapter(server({ GetServerOptions: () => up(status) }).api, ADMIN);
      await expect(a.canEditOptions()).resolves.toBe(false);
    }
    for (const status of [500, 502, 404, undefined]) {
      const a = new ServerOptionsAdapter(server({ GetServerOptions: () => up(status) }).api, ADMIN);
      const err = await a.canEditOptions().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UpstreamError);
      expect(String((err as Error).message)).not.toContain(FAKE_FRM_TOKEN);
      expect((err as UpstreamError).cause).toBeUndefined();
    }
  });

  it("adapter: a non-Upstream error from the check is rethrown generic, without token", async () => {
    const a = new ServerOptionsAdapter(server({ GetServerOptions: () => new TypeError(`bad ${FAKE_FRM_TOKEN}`) }).api, ADMIN);
    const err = (await a.canEditOptions().catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).not.toContain(FAKE_FRM_TOKEN);
    expect(err.cause).toBeUndefined();
  });

  it("adapter: the return value is exactly a boolean (response dropped)", async () => {
    const a = new ServerOptionsAdapter(server().api, ADMIN);
    expect(await a.canEditOptions()).toBe(true);
  });

  it.each(["InitialAdmin", "Client", "NotAuthenticated", "administrator", ""])(
    "pl %j makes no call at all and is not editable",
    async (pl) => {
      const s = server();
      const a = new ServerOptionsAdapter(s.api, tokenWith(pl));
      expect(await a.canEditOptions()).toBe(false);
      expect(s.calls).toEqual([]);
    },
  );

  it.each([undefined, "", "not-a-token", "....", "e30=.x"])("token %j is not editable and makes no call", async (t) => {
    const s = server();
    expect(await new ServerOptionsAdapter(s.api, t).canEditOptions()).toBe(false);
    expect(s.calls).toEqual([]);
  });
});

describe("GET degradation", () => {
  it("check fails (500) while read succeeds: 200, editable:false", async () => {
    const s = server({ GetServerOptions: (n) => (n === 2 ? up(500) : undefined) });
    const res = await request(build(s).app).get(getPath);
    // Promise.all order: read is issued first (call 1), check second (call 2)
    expect(res.status).toBe(200);
    expect(res.body.data.editable).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain(FAKE_FRM_TOKEN);
  });

  it("check gets a non-Upstream error while read succeeds: still 200, editable:false", async () => {
    const s = server({ GetServerOptions: (n) => (n === 2 ? new TypeError("x") : undefined) });
    const res = await request(build(s).app).get(getPath);
    expect(res.status).toBe(200);
    expect(res.body.data.editable).toBe(false);
  });

  it("read fails while check succeeds: an error status, no settings, no token", async () => {
    const s = server({ GetServerOptions: (n) => (n === 1 ? up(500) : undefined) });
    const res = await request(build(s).app).get(getPath);
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain(FAKE_FRM_TOKEN);
  });

  it("both fail: 502 and the second rejection is not an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const h = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", h);
    const s = server({ GetServerOptions: () => up(503) });
    const res = await request(build(s).app).get(getPath);
    await new Promise((r) => setTimeout(r, 20));
    process.off("unhandledRejection", h);
    expect(res.status).toBe(502);
    expect(unhandled).toEqual([]);
  });

  it("no token configured: no check call, a single GetServerOptions", async () => {
    const s = server();
    const res = await request(build(s, "").app).get(getPath);
    expect(res.body.data.editable).toBe(false);
    expect(s.calls).toEqual(["GetServerOptions"]);
  });
});

describe("PUT refusal mapping", () => {
  it.each([401, 403])("write refused with %s -> 409 not_editable, no audit line", async (status) => {
    const s = server({ ApplyServerOptions: () => up(status) });
    const b = build(s);
    const res = await put(b.app);
    expect(res.status).toBe(409);
    expect(res.body.error?.code ?? res.body.code).toBe("not_editable");
    expect(audits(b.lines)).toEqual([]);
    expect(JSON.stringify(res.body) + b.lines.join("")).not.toContain(FAKE_FRM_TOKEN);
  });

  it.each([500, 502, 404, undefined])("write failing with %s is NOT a 409, and no audit line", async (status) => {
    const s = server({ ApplyServerOptions: () => up(status) });
    const b = build(s);
    const res = await put(b.app);
    expect(res.status).not.toBe(409);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(audits(b.lines)).toEqual([]);
  });

  it.each([401, 403])("re-read after a successful write answered %s is NOT a 409; audit line exists", async (status) => {
    // GetServerOptions calls: 1 = check, 2 = pre-read, 3 = re-read
    const s = server({ GetServerOptions: (n) => (n === 3 ? up(status) : undefined) });
    const b = build(s);
    const res = await put(b.app);
    expect(res.status).not.toBe(409);
    expect(audits(b.lines)).toHaveLength(1);
    expect(audits(b.lines)[0]).toMatchObject({ from: false, to: true });
    expect(JSON.stringify(res.body) + b.lines.join("")).not.toContain(FAKE_FRM_TOKEN);
  });

  it("pre-read 401 after a passing check is not a 409 and nothing is written", async () => {
    const s = server({ GetServerOptions: (n) => (n === 2 ? up(401) : undefined) });
    const res = await put(build(s).app);
    expect(res.status).not.toBe(409);
    expect(s.calls).not.toContain("ApplyServerOptions");
  });

  it("check 403 -> 409 before anything else: no read, no write", async () => {
    const s = server({ GetServerOptions: () => up(403) });
    const res = await put(build(s).app);
    expect(res.status).toBe(409);
    expect(s.calls).toEqual(["GetServerOptions"]);
  });

  it("check 500 -> not a 409 (server fault), no write", async () => {
    const s = server({ GetServerOptions: () => up(500) });
    const res = await put(build(s).app);
    expect(res.status).not.toBe(409);
    expect(s.calls).not.toContain("ApplyServerOptions");
  });

  it("non-Upstream error from the write is a 500, not a 409, with no message leak", async () => {
    const s = server({ ApplyServerOptions: () => new Error(`x ${FAKE_FRM_TOKEN}`) });
    const b = build(s);
    const res = await put(b.app);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body) + b.lines.join("")).not.toContain(FAKE_FRM_TOKEN);
  });

  it("scrubbed write refusal: 409 body/logs carry no upstream text", async () => {
    const s = server({ ApplyServerOptions: () => up(403, `errorMessage quoting ${FAKE_FRM_TOKEN}`) });
    const b = build(s);
    const res = await put(b.app);
    expect(JSON.stringify(res.body) + b.lines.join("")).not.toContain(FAKE_FRM_TOKEN);
  });
});

describe("concurrency", () => {
  it("two simultaneous PUTs: both succeed, two audit lines, no cross-talk errors", async () => {
    const s = server();
    const b = build(s);
    const [r1, r2] = await Promise.all([put(b.app), request(b.app).put(putPath).send({ enabled: false })]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(audits(b.lines)).toHaveLength(2);
  });

  it("concurrent GETs while the check flaps: each answers on its own", async () => {
    const s = server({ GetServerOptions: (n) => (n % 2 === 0 ? up(500) : undefined) });
    const b = build(s);
    const rs = await Promise.all([1, 2, 3, 4].map(() => request(b.app).get(getPath)));
    for (const r of rs) expect([200, 502]).toContain(r.status);
  });
});
