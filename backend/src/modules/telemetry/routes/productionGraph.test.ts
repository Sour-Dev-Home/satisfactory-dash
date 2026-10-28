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
  opts: { rows?: unknown[]; layers?: Record<string, unknown[]>; noDb?: boolean; logLines?: string[]; factory?: () => Promise<unknown>; dbFails?: boolean; designations?: { list: () => Promise<unknown[]> } } = {},
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
    protectedRouters: [createServersRouter(directory, access), createProductionGraphRouter(directory, opts.noDb ? undefined : { db, ...(opts.designations ? { designations: opts.designations as never } : {}) })],
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

  describe("the trainRoutes layer (ADR-0055 PR 6a)", () => {
    const belt = (id: string, from: string, fromKind: string, to: string, toKind: string) => ({
      id,
      kind: "belt",
      from,
      fromKind,
      to,
      toKind,
      capacityPerMinute: 60,
      tier: "Conveyor Belt Mk.1",
      at: { x: 100, y: 200 },
    });
    const conveyors = [
      belt("Build_ConveyorBeltMk1_C_1", "Build_MinerMk1_C_1", "extractor", "Dock1", "station"),
      belt("Build_ConveyorBeltMk1_C_2", "Dock2", "station", "Build_StorageContainerMk1_C_2", "storage"),
    ];
    const routes = [
      { recordType: "station", id: "s1", name: "Farm ", platforms: [{ id: "Dock1", mode: "load", items: ["Desc_OreIron_C"] }] },
      { recordType: "station", id: "s2", name: "Base", platforms: [{ id: "Dock2", mode: "unload", items: ["Desc_OreIron_C"] }] },
      { recordType: "train", id: "t1", name: "Hauler", stops: ["Farm ", "Base"], items: [] },
    ];
    const routesRow = (over: Record<string, unknown> = {}) => layerRow({ data: routes, count: routes.length, ...over });
    const graphOf = async (trainRoutes: unknown[]) => {
      const res = await get(build({ layers: { conveyors: [layerRow({ data: conveyors, count: 2 })], trainRoutes } }));
      expect(res.status).toBe(200);
      expect(ProductionGraphResponseSchema.parse(res.body)).toEqual(res.body);
      return res.body.data as { transports: { mode: string; itemClassName: string | null; carriers: number }[]; logistics: string };
    };

    it("passes the stored layer to the builder: one train edge between the platforms", async () => {
      const g = await graphOf([routesRow()]);
      expect(g.logistics).toBe("present");
      expect(g.transports).toEqual([expect.objectContaining({ mode: "train", itemClassName: "Desc_OreIron_C", carriers: 1 })]);
    });

    it("no row, a truncated row, a skip or a row failing its schema: logistics notRead, no train edge", async () => {
      const bad = [[], [routesRow({ truncated: true })], [routesRow({ hash: "skipped:tooManyEdges", data: [], count: 0 })], [routesRow({ data: [{ nope: 1 }] })]];
      for (const rows of bad) {
        const g = await graphOf(rows);
        expect(g.logistics).toBe("notRead");
        expect(g.transports).toEqual([]);
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

describe("GET production-graph: designations (ADR-0055 Decision 5)", () => {
  const DID = "11111111-1111-4111-8111-111111111111";
  const rate = (className: string, n: number) => ({ name: className, className, currentPerMinute: n, maxPerMinute: n, percent: 100, unit: "items/min" as const });
  const mk = (id: string, recipe: string, ing: string, out: string, i: number) => ({
    id, name: "Constructor", className: "Build_Constructor_C", recipe, isProducing: true, isPaused: false, isBackedUp: false,
    production: [rate(out, 30)], ingredients: [rate(ing, 30)], state: "producing", location: { xM: i * 10, yM: 0, zM: 0, rotationDeg: 0 },
  });
  const buildings = [mk("m1", "Plate", "Ingot", "Plate", 1), mk("m2", "Plate", "Ingot", "Plate", 2)];
  const factory = async () => ({ ...factoryStatesAndIngredients.data, buildings });
  const belt = (id: string, from: string | null, to: string | null, fromKind: string | null, toKind: string | null) => ({
    id, kind: "belt", from, fromKind, to, toKind, capacityPerMinute: 780, tier: "Conveyor Belt", at: { x: 1, y: 1 },
  });
  const rows = [layerRow({ data: [belt("b1", "m1", "T1", "machine", "storage"), belt("b2", "m2", "T1", "machine", "storage")], count: 2 })];
  const member = (id: string, i: number) => ({ id, c: "Build_Constructor_C", x: i * 10, y: 0 });
  const store = (list: () => Promise<unknown[]>) => ({ list });

  it("a designation naming a machine makes a factory carrying its id and name, and splits the group", async () => {
    const res = await get(build({ rows, factory, designations: store(async () => [{ id: DID, name: "Mine", mode: "core", members: [member("m1", 1)] }]) }));
    expect(res.status).toBe(200);
    expect(ProductionGraphResponseSchema.parse(res.body)).toEqual(res.body);
    const f = res.body.data.factories.find((x: { designationId: string | null }) => x.designationId === DID);
    expect(f.name).toBe("Mine");
    const machines = res.body.data.nodes.filter((n: { kind: string }) => n.kind === "machines");
    expect(machines.map((n: { machineIds: string[] }) => n.machineIds.join())).toEqual(expect.arrayContaining(["m1", "m2"]));
    expect(machines.find((n: { machineIds: string[] }) => n.machineIds.includes("m1")).factoryKey).toBe(f.key);
    expect(machines.find((n: { machineIds: string[] }) => n.machineIds.includes("m2")).factoryKey).not.toBe(f.key);
  });

  it("a store that fails, or has none, leaves the graph exactly as it is without designations", async () => {
    const base = (await get(build({ rows, factory }))).body.data;
    const failing = await get(build({ rows, factory, designations: store(async () => { throw new Error("db down"); }) }));
    expect(failing.status).toBe(200);
    expect(failing.body.data).toEqual(base);
    expect((await get(build({ rows, factory, designations: store(async () => []) }))).body.data).toEqual(base);
  });

  it("ADR-0061: each factory carries its designation's parent, and matching is identical with and without parents", async () => {
    const PID = "22222222-2222-4222-8222-222222222222";
    const EID = "33333333-3333-4333-8333-333333333333";
    const at = "2026-10-27T10:00:00.000Z";
    const d = (id: string, name: string, members: ReturnType<typeof member>[], parentId?: string | null) => ({
      id, name, mode: "core", members, createdAt: at, updatedAt: at, ...(parentId !== undefined && { parentId }),
    });
    // E owns no machines (a parent only), P is top level with m1, the child C (DID) sits in E with m2.
    const nested = [d(EID, "Area", [], null), d(PID, "Top", [member("m1", 1)], null), d(DID, "Child", [member("m2", 2)], EID)];
    const flat = nested.map(({ parentId: _dropped, ...rest }) => rest);
    const res = await get(build({ rows, factory, designations: store(async () => nested) }));
    expect(ProductionGraphResponseSchema.parse(res.body)).toEqual(res.body);
    const withParents = res.body.data;
    const without = (await get(build({ rows, factory, designations: store(async () => flat) }))).body.data;

    const byDesignation = new Map<string, { parentDesignationId: string | null }>(withParents.factories.map((f: { designationId: string; parentDesignationId: string | null }) => [f.designationId, f]));
    expect(byDesignation.get(DID)?.parentDesignationId).toBe(EID);
    expect(byDesignation.get(PID)?.parentDesignationId).toBeNull();
    // A parent with no members of its own has no factory in the graph (Decision 2: the client rolls it up).
    expect(byDesignation.has(EID)).toBe(false);
    expect(withParents.factories.every((f: { designationId: string | null; parentDesignationId: string | null }) => f.designationId !== null || f.parentDesignationId === null)).toBe(true);

    // Matching, nodes and factories are unchanged by parents: only parentDesignationId differs.
    const strip = (data: { factories: { parentDesignationId?: unknown }[] }) => ({ ...data, factories: data.factories.map(({ parentDesignationId: _p, ...f }) => f) });
    expect(strip(withParents)).toEqual(strip(without));
    expect(without.factories.every((f: { parentDesignationId: unknown }) => f.parentDesignationId === null)).toBe(true);
  });
});
