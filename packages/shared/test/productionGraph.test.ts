import { describe, expect, it } from "vitest";
import * as fixtures from "../fixtures/index";
import {
  PLANNER_MAX_FACTORIES,
  PLANNER_MAX_MACHINE_IDS,
  PLANNER_MAX_NODES,
  PLANNER_MAX_SHARES,
  PLANNER_MAX_SIDE_PRODUCTS,
  PLANNER_MAX_SITES,
  PLANNER_MAX_TRANSPORTS,
  PlannerEdgeSchema,
  PlannerFactorySchema,
  PlannerNodeSchema,
  PlannerShareSchema,
  PlannerTransportSchema,
  ProductionGraphResponseSchema,
  ProductionGraphSchema,
  endpoints,
} from "../src/index";

const graph = fixtures.productionGraphTwoSites.data;
const node = graph.nodes[2]!;
const edge = graph.edges[0]!;

describe("ProductionGraph fixtures (ADR-0050)", () => {
  it("both fixtures parse", () => {
    expect(ProductionGraphResponseSchema.safeParse(fixtures.productionGraphTwoSites).success).toBe(true);
    expect(ProductionGraphResponseSchema.safeParse(fixtures.productionGraphEmpty).success).toBe(true);
    expect(ProductionGraphResponseSchema.safeParse(fixtures.productionGraphStalled).success).toBe(true);
  });

  it("the stalled fixture's manifold is all backed up at 0 of its max, and its site counts every machine (#728)", () => {
    const stalled = fixtures.productionGraphStalled.data;
    const manifold = stalled.nodes.find((n) => n.key === node.key)!;
    expect(manifold.stateCounts).toEqual({ backedUp: manifold.count });
    expect(manifold.products[0]).toMatchObject({ currentPerMinute: 0, maxPerMinute: 160 });
    const site = stalled.sites.find((s) => s.key === node.siteKey)!;
    const machines = stalled.nodes.filter((n) => n.siteKey === site.key && n.kind !== "storage").reduce((t, n) => t + n.count, 0);
    expect(Object.values(site.stateCounts).reduce((t, n) => t + n, 0)).toBe(machines);
  });

  it("are internally consistent: every edge and site names a node, every node a site", () => {
    const keys = new Set(graph.nodes.map((n) => n.key));
    const sites = new Set(graph.sites.map((s) => s.key));
    expect(keys.size).toBe(graph.nodes.length);
    for (const e of graph.edges) expect(keys.has(e.from) && keys.has(e.to), `${e.from} -> ${e.to}`).toBe(true);
    for (const s of graph.sites) for (const k of s.nodeKeys) expect(keys.has(k), k).toBe(true);
    for (const n of graph.nodes) expect(sites.has(n.siteKey), n.key).toBe(true);
    for (const s of graph.sites) expect(s.machineCount).toBe(graph.nodes.filter((n) => n.siteKey === s.key).reduce((t, n) => t + n.count, 0));
  });

  it("show each rate kind, a mixed belt, a loop and an unconnected machine (Decision 2)", () => {
    expect(new Set(graph.edges.map((e) => e.rate))).toEqual(new Set(["measured", "estimated", "unknown"]));
    expect(graph.edges.find((e) => e.rate === "unknown")?.ratePerMinute).toBeNull();
    expect(graph.edges.some((e) => e.mixed)).toBe(true);
    expect(graph.nodes.filter((n) => n.loop)).toHaveLength(2);
    expect(graph.unconnectedMachineIds.length).toBeGreaterThan(0);
  });
});

describe("PlannerNodeSchema and PlannerEdgeSchema", () => {
  it("a node kind is an open string, so a newer kind still parses", () => {
    expect(PlannerNodeSchema.safeParse({ ...node, kind: "trainGroup" }).success).toBe(true);
    expect(PlannerNodeSchema.safeParse({ ...node, kind: "" }).success).toBe(false);
  });

  it("caps machine ids per node and needs at least one machine", () => {
    expect(PlannerNodeSchema.safeParse({ ...node, machineIds: Array(PLANNER_MAX_MACHINE_IDS).fill("x") }).success).toBe(true);
    expect(PlannerNodeSchema.safeParse({ ...node, machineIds: Array(PLANNER_MAX_MACHINE_IDS + 1).fill("x") }).success).toBe(false);
    expect(PlannerNodeSchema.safeParse({ ...node, count: 0 }).success).toBe(false);
  });

  it("refuses negative or non-finite rates and fractional positions", () => {
    expect(PlannerEdgeSchema.safeParse({ ...edge, ratePerMinute: -1 }).success).toBe(false);
    expect(PlannerEdgeSchema.safeParse({ ...edge, ratePerMinute: Number.POSITIVE_INFINITY }).success).toBe(false);
    expect(PlannerNodeSchema.safeParse({ ...node, at: { x: 1.5, y: 0 } }).success).toBe(false);
  });

  it("an edge's rate kind is closed: never a fourth word the UI could misread", () => {
    expect(PlannerEdgeSchema.safeParse({ ...edge, rate: "exact" }).success).toBe(false);
    expect(PlannerEdgeSchema.safeParse({ ...edge, kind: "lift" }).success).toBe(false);
  });

  it("caps the graph's nodes", () => {
    expect(ProductionGraphSchema.safeParse({ ...graph, nodes: Array(PLANNER_MAX_NODES + 1).fill(node) }).success).toBe(false);
  });
});

describe("logical-factory and transport fields (ADR-0053 Decision 5, ADR-0055 Decision 9)", () => {
  const rich = fixtures.productionGraphFactories.data;
  const richNode = rich.nodes[2]!; // the shared smelter
  const richEdge = rich.edges[4]!; // the excess edge
  const transport = rich.transports[0]!;
  const factory = rich.factories[0]!;
  const parse = (schema: { safeParse(v: unknown): { success: boolean } }, v: unknown) => schema.safeParse(v).success;

  it("the new fixture parses and is internally consistent", () => {
    expect(ProductionGraphResponseSchema.safeParse(fixtures.productionGraphFactories).success).toBe(true);
    const keys = new Set(rich.nodes.map((n) => n.key));
    const factories = new Set(rich.factories.map((f) => f.key));
    for (const t of rich.transports) expect(keys.has(t.from) && keys.has(t.to)).toBe(true);
    for (const n of rich.nodes) {
      expect(factories.has((n as { factoryKey?: string }).factoryKey ?? ""), n.key).toBe(true);
      const c = (n as { collapseUnder?: string | null }).collapseUnder;
      if (c) expect(keys.has(c), n.key).toBe(true);
    }
    for (const f of rich.factories) for (const k of f.nodeKeys) expect(keys.has(k), k).toBe(true);
  });

  it("a node's shares of one factory set sum to 1 in the fixture", () => {
    for (const n of rich.nodes) {
      const shares = (n as { shares?: { share: number }[] }).shares;
      if (shares) expect(shares.reduce((t, s) => t + s.share, 0)).toBeCloseTo(1, 9);
    }
  });

  it("old payloads still parse: the original fixtures carry none of the new fields", () => {
    expect(ProductionGraphResponseSchema.safeParse(fixtures.productionGraphTwoSites).success).toBe(true);
    expect("factories" in fixtures.productionGraphTwoSites.data).toBe(false);
    expect(parse(PlannerNodeSchema, node)).toBe(true);
    expect(parse(PlannerEdgeSchema, edge)).toBe(true);
  });

  it("unknown values of the open string fields parse (ADR-0007: a newer value never breaks an older frontend)", () => {
    expect(parse(PlannerNodeSchema, { ...richNode, role: "teleporter" })).toBe(true);
    expect(parse(PlannerEdgeSchema, { ...richEdge, flow: "recycle", itemFrom: "oracle", destination: "moon" })).toBe(true);
    expect(parse(PlannerTransportSchema, { ...transport, mode: "hyperloop", flow: "x", destination: "y", itemFrom: "z" })).toBe(true);
    expect(parse(ProductionGraphSchema, { ...rich, logistics: "full" })).toBe(true);
  });

  it("but the closed enums stay closed: edge kind and a transport's rate kind", () => {
    expect(parse(PlannerEdgeSchema, { ...richEdge, kind: "train" })).toBe(false);
    expect(parse(PlannerTransportSchema, { ...transport, rate: "exact" })).toBe(false);
  });

  it("bounds the open strings and keys", () => {
    for (const k of ["flow", "itemFrom", "destination"]) expect(parse(PlannerEdgeSchema, { ...richEdge, [k]: "x".repeat(21) }), k).toBe(false);
    expect(parse(PlannerNodeSchema, { ...richNode, role: "x".repeat(21) })).toBe(false);
    expect(parse(PlannerNodeSchema, { ...richNode, factoryKey: "" })).toBe(false);
    expect(parse(PlannerNodeSchema, { ...richNode, factoryKey: "x".repeat(301) })).toBe(false);
    expect(parse(PlannerTransportSchema, { ...transport, mode: "" })).toBe(false);
    expect(parse(PlannerTransportSchema, { ...transport, mode: "x".repeat(21) })).toBe(false);
    expect(parse(PlannerTransportSchema, { ...transport, routeName: "r".repeat(201) })).toBe(false);
    expect(parse(ProductionGraphSchema, { ...rich, topologyHash: "h".repeat(65) })).toBe(false);
    expect(parse(ProductionGraphSchema, { ...rich, topologyHash: "h".repeat(64) })).toBe(true);
    expect(parse(ProductionGraphSchema, { ...rich, logistics: "x".repeat(21) })).toBe(false);
  });

  it("shares: at most five, each within [0, 1] and finite, with a key", () => {
    const share = { factoryKey: "f", share: 0.2 };
    expect(parse(PlannerNodeSchema, { ...richNode, shares: Array(PLANNER_MAX_SHARES).fill(share) })).toBe(true);
    expect(parse(PlannerNodeSchema, { ...richNode, shares: Array(PLANNER_MAX_SHARES + 1).fill(share) })).toBe(false);
    for (const bad of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) expect(parse(PlannerShareSchema, { ...share, share: bad }), String(bad)).toBe(false);
    expect(parse(PlannerShareSchema, { factoryKey: "", share: 0.5 })).toBe(false);
  });

  it("collapseUnder is a key or null; treeKey and resource follow ADR-0053", () => {
    expect(parse(PlannerNodeSchema, { ...richNode, collapseUnder: null })).toBe(true);
    expect(parse(PlannerNodeSchema, { ...richNode, collapseUnder: "" })).toBe(false);
    expect(parse(PlannerNodeSchema, { ...richNode, treeKey: "" })).toBe(false);
    expect(parse(PlannerNodeSchema, { ...richNode, resource: null })).toBe(true);
    expect(parse(PlannerNodeSchema, { ...richNode, resource: { className: "Desc_OreIron_C" } })).toBe(false);
  });

  it("a transport needs its own fields: carriers a non-negative integer, rate non-negative or null", () => {
    expect(parse(PlannerTransportSchema, { ...transport, carriers: 0 })).toBe(true);
    expect(parse(PlannerTransportSchema, { ...transport, carriers: -1 })).toBe(false);
    expect(parse(PlannerTransportSchema, { ...transport, carriers: 1.5 })).toBe(false);
    expect(parse(PlannerTransportSchema, { ...transport, ratePerMinute: null, itemClassName: null, itemName: null, routeName: null })).toBe(true);
    expect(parse(PlannerTransportSchema, { ...transport, ratePerMinute: -1 })).toBe(false);
    const { from: _from, ...noFrom } = transport;
    expect(parse(PlannerTransportSchema, noFrom)).toBe(false);
  });

  it("a factory: designationId null or a uuid, side products and lists bounded", () => {
    expect(parse(PlannerFactorySchema, factory)).toBe(true);
    expect(parse(PlannerFactorySchema, { ...factory, designationId: "6f1c1d4e-3c1a-4a52-9a53-0d5b6f3b9a11" })).toBe(true);
    expect(parse(PlannerFactorySchema, { ...factory, designationId: "not-a-uuid" })).toBe(false);
    expect(parse(PlannerFactorySchema, { ...factory, sideProducts: Array(PLANNER_MAX_SIDE_PRODUCTS).fill("x") })).toBe(true);
    expect(parse(PlannerFactorySchema, { ...factory, sideProducts: Array(PLANNER_MAX_SIDE_PRODUCTS + 1).fill("x") })).toBe(false);
    expect(parse(PlannerFactorySchema, { ...factory, siteKeys: Array(PLANNER_MAX_SITES + 1).fill("s") })).toBe(false);
    expect(parse(PlannerFactorySchema, { ...factory, machineCount: -1 })).toBe(false);
  });

  it("caps the graph's factories and transports", () => {
    expect(parse(ProductionGraphSchema, { ...rich, factories: Array(PLANNER_MAX_FACTORIES).fill(factory) })).toBe(true);
    expect(parse(ProductionGraphSchema, { ...rich, factories: Array(PLANNER_MAX_FACTORIES + 1).fill(factory) })).toBe(false);
    expect(parse(ProductionGraphSchema, { ...rich, transports: Array(PLANNER_MAX_TRANSPORTS).fill(transport) })).toBe(true);
    expect(parse(ProductionGraphSchema, { ...rich, transports: Array(PLANNER_MAX_TRANSPORTS + 1).fill(transport) })).toBe(false);
  });
});

describe("the productionGraph endpoint", () => {
  it("is a server-scoped GET with an encoded id", () => {
    expect(endpoints.productionGraph).toMatchObject({ method: "GET", route: "/api/servers/:serverId/production-graph" });
    expect(endpoints.productionGraph.path("a b")).toBe("/api/servers/a%20b/production-graph");
  });
});
