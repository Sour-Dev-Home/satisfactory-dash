import { describe, expect, it } from "vitest";
import * as fixtures from "../fixtures/index";
import {
  PLANNER_MAX_MACHINE_IDS,
  PLANNER_MAX_NODES,
  PlannerEdgeSchema,
  PlannerNodeSchema,
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

describe("the productionGraph endpoint", () => {
  it("is a server-scoped GET with an encoded id", () => {
    expect(endpoints.productionGraph).toMatchObject({ method: "GET", route: "/api/servers/:serverId/production-graph" });
    expect(endpoints.productionGraph.path("a b")).toBe("/api/servers/a%20b/production-graph");
  });
});
