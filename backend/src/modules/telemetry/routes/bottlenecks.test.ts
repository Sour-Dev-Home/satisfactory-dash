import { describe, it, expect } from "vitest";
import request from "supertest";
import type { RequestHandler } from "express";
import { BottlenecksResponseSchema, endpoints } from "@satisfactory-dash/shared";
import { conveyorsSample, factoryStatesAndIngredients } from "@satisfactory-dash/shared/fixtures";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import { UpstreamError } from "../../../platform/errors.js";
import { InMemoryServerDirectory, createServersRouter } from "../../servers/index.js";
import type { ServerAccess } from "../../servers/index.js";
import type { TelemetryServices } from "../telemetryServices.js";
import { createBottlenecksRouter, readEdges } from "./bottlenecks.js";

const access: ServerAccess = {
  getRole: async (publicId, userId) => (publicId === "default" && userId === "member" ? "viewer" : undefined),
  listForUser: async () => [],
};

// A signed-out request is a 401, as the real session guard answers it.
const guard: RequestHandler = (req, res, next) => {
  const user = req.header("x-test-user");
  if (!user) {
    res.status(401).json({ error: { code: "unauthorized", message: "Sign in required" } });
    return;
  }
  res.locals.user = { id: user };
  next();
};

const layerRow = (over: Record<string, unknown> = {}) => ({
  hash: "h",
  observed_at: "2026-10-21T15:03:00.000Z",
  truncated: false,
  count: conveyorsSample.data.length,
  data: conveyorsSample.data,
  ...over,
});

function build(opts: { rows?: unknown[]; noDb?: boolean; factory?: () => Promise<never> } = {}) {
  const telemetry = {
    production: { getFactoryOverview: opts.factory ?? (async () => factoryStatesAndIngredients.data) },
  } as unknown as TelemetryServices;
  const directory = new InMemoryServerDirectory([{ id: "default", displayName: "Home", services: { telemetry } }]);
  const db = { query: (_text: string, _values?: unknown[]) => Promise.resolve({ rows: opts.rows ?? [] }) };
  return createApp({
    logger: createLogger({ level: "silent" }, { write: () => {} }),
    routers: [],
    sessionGuard: guard,
    protectedRouters: [createServersRouter(directory, access), createBottlenecksRouter(directory, opts.noDb ? undefined : { db })],
  });
}

const get = (app: ReturnType<typeof build>, path = endpoints.bottlenecks.path("default"), user: string | null = "member") => {
  const r = request(app).get(path);
  return user ? r.set("x-test-user", user) : r;
};

describe("readEdges", () => {
  const dbWith = (rows: unknown[]) => ({ query: (_text: string, _values?: unknown[]) => Promise.resolve({ rows }) });

  it("logs a warning for a row failing its schema and treats it as not received", async () => {
    const warnings: unknown[][] = [];
    const log = { warn: (...args: unknown[]) => void warnings.push(args) };
    expect(await readEdges(dbWith([layerRow({ data: [{ id: 1 }] })]), "s1", log as never)).toBe("notReceived");
    expect(warnings).toHaveLength(1);
  });

  it("maps tooManyEdges, a truncated row, and truncated+skip to tooLarge", async () => {
    expect(await readEdges(dbWith([layerRow({ hash: "skipped:tooManyEdges", data: [], count: 0 })]), "s1")).toBe("tooLarge");
    expect(await readEdges(dbWith([layerRow({ truncated: true })]), "s1")).toBe("tooLarge");
    expect(await readEdges(dbWith([layerRow({ hash: "skipped:unsupportedFrm", truncated: true })]), "s1")).toBe("unsupported");
  });

  it("does not report an unknown skip reason as a good (empty) graph", async () => {
    const result = await readEdges(dbWith([layerRow({ hash: "skipped:somethingNew", data: [], count: 0 })]), "s1");
    expect(Array.isArray(result)).toBe(false);
  });

  it("does not warn for a missing row,a skip or a good row", async () => {
    const warnings: unknown[][] = [];
    const log = { warn: (...args: unknown[]) => void warnings.push(args) };
    expect(await readEdges(dbWith([]), "s1", log as never)).toBe("notReceived");
    expect(await readEdges(dbWith([layerRow({ hash: "skipped:unsupportedFrm", data: [], count: 0 })]), "s1", log as never)).toBe("unsupported");
    expect(Array.isArray(await readEdges(dbWith([layerRow()]), "s1", log as never))).toBe(true);
    expect(warnings).toHaveLength(0);
  });
});

describe("GET /api/servers/:serverId/bottlenecks", () => {
  it("signed out is 401", async () => {
    expect((await get(build(), undefined, null)).status).toBe(401);
  });

  it("a user who is not a member gets the usual 404", async () => {
    expect((await get(build(), undefined, "stranger")).status).toBe(404);
  });

  it("an unknown server is a 404", async () => {
    expect((await get(build(), endpoints.bottlenecks.path("nope"))).status).toBe(404);
  });

  it("no conveyors layer: 200, item level, beltData notReceived (not an FRM problem)", async () => {
    const res = await get(build());
    expect(res.status).toBe(200);
    expect(BottlenecksResponseSchema.parse(res.body)).toEqual(res.body);
    expect(res.body.data.beltData).toBe("notReceived");
    expect(res.body.data.notes.map((n: { code: string }) => n.code)).toEqual(["beltDataNotReceived"]);
    expect(JSON.stringify(res.body.data.notes)).not.toMatch(/FRM/);
    expect(res.body.data.findings.length).toBeGreaterThan(0);
    expect(res.body.data.findings.length).toBeLessThanOrEqual(10);
  });

  it("a stored layer: belt level ran (present or stale), contract-valid", async () => {
    const res = await get(build({ rows: [layerRow()] }));
    expect(res.status).toBe(200);
    expect(BottlenecksResponseSchema.parse(res.body)).toEqual(res.body);
    expect(["present", "stale"]).toContain(res.body.data.beltData);
    expect(res.body.data.connectionsRefreshMinutes).toBe(10);
  });

  it("a truncated layer is beltData tooLarge", async () => {
    const res = await get(build({ rows: [layerRow({ truncated: true })] }));
    expect(res.status).toBe(200);
    expect(res.body.data.beltData).toBe("tooLarge");
  });

  it("a stored skip maps tooManyEdges to tooLarge and unsupportedFrm to unsupported (#577)", async () => {
    const skipRow = (reason: string) => layerRow({ hash: `skipped:${reason}`, data: [], count: 0 });
    expect((await get(build({ rows: [skipRow("tooManyEdges")] }))).body.data.beltData).toBe("tooLarge");
    const frm = await get(build({ rows: [skipRow("unsupportedFrm")] }));
    expect(frm.body.data.beltData).toBe("unsupported");
    expect(frm.body.data.notes.map((n: { code: string }) => n.code)).toEqual(["updateFrm"]);
  });

  it("a stored layer that no longer parses is treated as not received, not as an old FRM", async () => {
    const res = await get(build({ rows: [layerRow({ data: [{ id: 1 }] })] }));
    expect(res.status).toBe(200);
    expect(res.body.data.beltData).toBe("notReceived");
  });

  it("limit caps the findings and sets truncated", async () => {
    const all = await get(build());
    const total = all.body.data.findings.length as number;
    expect(total).toBeGreaterThan(1);
    const res = await get(build(), `${endpoints.bottlenecks.path("default")}?limit=1`);
    expect(res.status).toBe(200);
    expect(res.body.data.findings).toHaveLength(1);
    expect(res.body.data.truncated).toBe(true);
  });

  it.each(["0", "51", "abc", "1.5", "-1"])("limit=%s is a 400 naming the parameter, not its value", async (value) => {
    const res = await get(build(), `${endpoints.bottlenecks.path("default")}?limit=${value}`);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("limit");
    expect(JSON.stringify(res.body)).not.toContain(`=${value}`);
  });

  it("without a database it is a 503", async () => {
    expect((await get(build({ noDb: true }))).status).toBe(503);
  });

  it("a factory read that fails is mapped like the factory route (502 upstream)", async () => {
    const res = await get(build({ factory: async () => { throw new UpstreamError("down"); } }));
    expect(res.status).toBe(502);
  });
});
