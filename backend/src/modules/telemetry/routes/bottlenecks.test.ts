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
import { createBottlenecksRouter } from "./bottlenecks.js";

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

  it("no conveyors layer: 200, item level, beltData unsupported", async () => {
    const res = await get(build());
    expect(res.status).toBe(200);
    expect(BottlenecksResponseSchema.parse(res.body)).toEqual(res.body);
    expect(res.body.data.beltData).toBe("unsupported");
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

  it("a stored layer that no longer parses falls back to unsupported", async () => {
    const res = await get(build({ rows: [layerRow({ data: [{ id: 1 }] })] }));
    expect(res.status).toBe(200);
    expect(res.body.data.beltData).toBe("unsupported");
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
