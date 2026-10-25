import { describe, it, expect } from "vitest";
import request from "supertest";
import type { RequestHandler } from "express";
import { ProductionGraphResponseSchema, endpoints } from "@satisfactory-dash/shared";
import { conveyorsSample, factoryStatesAndIngredients } from "@satisfactory-dash/shared/fixtures";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import { InMemoryServerDirectory, createServersRouter } from "../../servers/index.js";
import type { ServerAccess } from "../../servers/index.js";
import type { TelemetryServices } from "../telemetryServices.js";
import { UpstreamError } from "../../../platform/errors.js";
import { ApiFailure } from "../../../platform/errorResponse.js";
import { observed } from "../../../platform/snapshot.js";
import { createProductionGraphRouter } from "./productionGraph.js";

const access: ServerAccess = {
  getRole: async (publicId, userId) => (publicId === "default" && userId === "member" ? "viewer" : undefined),
  listForUser: async () => [],
};

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

function build(
  opts: { rows?: unknown[]; layers?: Record<string, unknown[]>; noDb?: boolean; logLines?: string[]; factory?: () => Promise<unknown>; dbFails?: boolean } = {},
) {
  const telemetry = {
    production: { getFactoryOverview: opts.factory ?? (async () => factoryStatesAndIngredients.data) },
  } as unknown as TelemetryServices;
  const directory = new InMemoryServerDirectory([{ id: "default", displayName: "Home", services: { telemetry } }]);
  const db = {
    // `layers` answers by the queried layer name (the second value); `rows` answers every query.
    query: (_text: string, values?: unknown[]) =>
      opts.dbFails
        ? Promise.reject(new Error("db down"))
        : Promise.resolve({ rows: opts.layers ? (opts.layers[String(values?.[1])] ?? []) : (opts.rows ?? []) }),
  };
  const lines = opts.logLines;
  return createApp({
    logger: lines
      ? createLogger({ level: "info" }, { write: (line: string) => void lines.push(line) })
      : createLogger({ level: "silent" }, { write: () => {} }),
    routers: [],
    sessionGuard: guard,
    protectedRouters: [createServersRouter(directory, access), createProductionGraphRouter(directory, opts.noDb ? undefined : { db })],
  });
}

const get = (app: ReturnType<typeof build>, path = endpoints.productionGraph.path("default"), user: string | null = "member") => {
  const r = request(app).get(path);
  return user ? r.set("x-test-user", user) : r;
};

describe("GET /api/servers/:serverId/production-graph", () => {
  it("signed out is 401", async () => {
    expect((await get(build(), undefined, null)).status).toBe(401);
  });

  it("a user who is not a member gets the usual 404", async () => {
    expect((await get(build(), undefined, "stranger")).status).toBe(404);
  });

  it("an unknown server is a 404", async () => {
    expect((await get(build(), endpoints.productionGraph.path("nope"))).status).toBe(404);
  });

  it("without a database it is a 503", async () => {
    expect((await get(build({ noDb: true }))).status).toBe(503);
  });

  it("no conveyors layer: 200, beltData notReceived (no FRM wording), matches the schema", async () => {
    const res = await get(build());
    expect(res.status).toBe(200);
    expect(ProductionGraphResponseSchema.parse(res.body)).toEqual(res.body);
    expect(res.body.data.beltData).toBe("notReceived");
    expect(res.body.data.notes[0].code).toBe("beltDataNotReceived");
    expect(res.body.data.notes[0].text).not.toMatch(/FRM/);
  });

  it("a stored layer: belt level ran, matches the schema", async () => {
    const res = await get(build({ rows: [layerRow()] }));
    expect(res.status).toBe(200);
    expect(ProductionGraphResponseSchema.parse(res.body)).toEqual(res.body);
    expect(["present", "stale"]).toContain(res.body.data.beltData);
  });

  it("a layer that names no machine is beltData stale", async () => {
    const res = await get(build({ rows: [layerRow({ data: [], count: 0 })] }));
    expect(res.status).toBe(200);
    expect(ProductionGraphResponseSchema.parse(res.body)).toEqual(res.body);
    expect(res.body.data.beltData).toBe("stale");
  });

  it("a truncated layer is beltData tooLarge", async () => {
    const res = await get(build({ rows: [layerRow({ truncated: true })] }));
    expect(res.status).toBe(200);
    expect(ProductionGraphResponseSchema.parse(res.body)).toEqual(res.body);
    expect(res.body.data.beltData).toBe("tooLarge");
  });

  it("a stored skip maps tooManyEdges to tooLarge and unsupportedFrm to unsupported", async () => {
    const skipRow = (reason: string) => layerRow({ hash: `skipped:${reason}`, data: [], count: 0 });
    expect((await get(build({ rows: [skipRow("tooManyEdges")] }))).body.data.beltData).toBe("tooLarge");
    expect((await get(build({ rows: [skipRow("unsupportedFrm")] }))).body.data.beltData).toBe("unsupported");
  });

  it("a failed factory read is mapped like bottlenecks (502 upstream)", async () => {
    const res = await get(build({ factory: async () => { throw new UpstreamError("down"); } }));
    expect(res.status).toBe(502);
  });

  it("an agent that has not reported is 503 upstream_unreachable", async () => {
    const res = await get(build({ factory: async () => { throw new ApiFailure("upstream_unreachable", "not reported"); } }));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("upstream_unreachable");
  });

  it("a database error is a 500 and logs no graph line", async () => {
    const logLines: string[] = [];
    const res = await get(build({ dbFails: true, logLines }));
    expect(res.status).toBe(500);
    expect(logLines.join("")).not.toContain("production graph built");
  });

  it("carries the factory snapshot's own observedAt and stale, not now", async () => {
    const factory = async () => observed({ ...factoryStatesAndIngredients.data }, { observedAt: "2026-01-02T03:04:05.000Z", stale: true });
    const res = await get(build({ factory }));
    expect(res.status).toBe(200);
    expect(res.body.observedAt).toBe("2026-01-02T03:04:05.000Z");
    expect(res.body.stale).toBe(true);
  });

  it("an empty factory with an empty layer is a valid empty graph with zero stats", async () => {
    const logLines: string[] = [];
    const factory = async () => ({ ...factoryStatesAndIngredients.data, buildings: [] });
    const res = await get(build({ factory, rows: [layerRow({ data: [], count: 0 })], logLines }));
    expect(res.status).toBe(200);
    expect(ProductionGraphResponseSchema.parse(res.body)).toEqual(res.body);
    expect(res.body.data.nodes).toEqual([]);
    const entry = logLines.map((l) => JSON.parse(l) as Record<string, unknown>).find((e) => e.msg === "production graph built")!;
    expect(entry).toMatchObject({ components: 0, sites: 0, groups: 0, links: 0, level: 30 });
  });

  describe("the resourceNodes layer (ADR-0055 PR 4)", () => {
    const MINER = "Build_MinerMk1_C_1";
    const conveyors = [
      { id: "Build_ConveyorBeltMk1_C_9", kind: "belt", from: MINER, fromKind: "extractor", to: "Build_StorageContainerMk1_C_2", toKind: "storage", capacityPerMinute: 60, tier: "Conveyor Belt Mk.1", at: { x: 100, y: 200 } },
    ];
    const iron = { type: "Iron Ore", purity: "normal", nodeType: "node", x: 106, y: 200, exploited: true, className: "Desc_OreIron_C" };
    const nodesRow = (over: Record<string, unknown> = {}) => layerRow({ data: [iron], count: 1, ...over });
    const graphOf = async (resourceNodes: unknown[]) => {
      const res = await get(build({ layers: { conveyors: [layerRow({ data: conveyors, count: 1 })], resourceNodes } }));
      expect(res.status).toBe(200);
      expect(ProductionGraphResponseSchema.parse(res.body)).toEqual(res.body);
      return res.body.data as { edges: { itemClassName: string | null; itemFrom?: string }[] };
    };

    it("passes the stored layer to the builder: the miner's belt carries the node's item", async () => {
      const g = await graphOf([nodesRow()]);
      expect(g.edges).toEqual([expect.objectContaining({ itemClassName: "Desc_OreIron_C", itemFrom: "resourceNode" })]);
    });

    it("no row, a truncated row, a skip or a row failing its schema: no item from a node", async () => {
      for (const rows of [[], [nodesRow({ truncated: true })], [nodesRow({ hash: "skipped:tooManyEdges", data: [], count: 0 })], [nodesRow({ data: [{ nope: 1 }] })]]) {
        const g = await graphOf(rows);
        expect(g.edges).toEqual([expect.objectContaining({ itemClassName: null })]);
      }
    });
  });

  it("logs one info line of counts and timing, with no names from the game server", async () => {
    const logLines: string[] = [];
    const res = await get(build({ logLines, rows: [layerRow()] }));
    expect(res.status).toBe(200);
    const entries = logLines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((e) => e.msg === "production graph built");
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.level).toBe(30);
    for (const key of ["components", "sites", "groups", "links", "durationMs"]) expect(typeof entry[key]).toBe("number");
    expect(entry.groups).toBeGreaterThan(0);
    const line = logLines.find((l) => l.includes("production graph built"))!;
    for (const building of factoryStatesAndIngredients.data.buildings.slice(0, 20)) {
      expect(line).not.toContain(JSON.stringify(building.name));
    }
  });
});
