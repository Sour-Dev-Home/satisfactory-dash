import { describe, expect, it } from "vitest";
import { ProductionGraphSchema, type PlannerEdge } from "@satisfactory-dash/shared";
import { productionGraphTwoSites } from "@satisfactory-dash/shared/fixtures";
import { edgeLabel, edgeTitle, graphSummary, nodeBodyLines, nodeTitle, reachFor, siteItems } from "./graphModel";

const edge = (from: string, to: string, item: string | null, extra: Partial<PlannerEdge> = {}): PlannerEdge => ({
  from,
  to,
  kind: "belt",
  itemClassName: item,
  itemName: item,
  ratePerMinute: 10,
  rate: "measured",
  mixed: false,
  capacityPerMinute: null,
  conveyorCount: 1,
  ...extra,
});

describe("edgeLabel (Decision 2)", () => {
  it("measured is plain, estimated says about, unknown has no number, mixed says so", () => {
    expect(edgeLabel(edge("a", "b", "Iron Ore", { ratePerMinute: 120 }))).toBe("Iron Ore · 120 items/min");
    expect(edgeLabel(edge("a", "b", "Iron Ingot", { rate: "estimated", ratePerMinute: 102.2 }))).toBe("Iron Ingot · about 102.2 items/min");
    expect(edgeLabel(edge("a", "b", "Iron Plate", { rate: "unknown", ratePerMinute: null, mixed: true }))).toBe("Iron Plate · mixed");
    expect(edgeLabel(edge("a", "b", null, { itemName: null, rate: "unknown", ratePerMinute: null }))).toBe("Item unknown");
    expect(edgeLabel(edge("a", "b", "Water", { kind: "pipe", ratePerMinute: 30 }))).toBe("Water · 30 m³/min");
  });

  it("the title adds how sure the rate is", () => {
    expect(edgeTitle(edge("a", "b", "Iron Ore"), "Miner", "Smelter")).toBe("Miner to Smelter: Iron Ore · 10 items/min (measured)");
    expect(edgeTitle(edge("a", "b", "X", { rate: "unknown", ratePerMinute: null }), "A", "B")).toContain("rate unknown");
  });
});

describe("node text", () => {
  const [miner, , plates, recycle] = ProductionGraphSchema.parse(productionGraphTwoSites.data).nodes;

  it("titles a group with its count and lists recipe, outputs and the loop marker", () => {
    expect(nodeTitle(plates)).toBe("8× Constructor");
    expect(nodeTitle(miner)).toBe("Miner Mk.2");
    expect(nodeBodyLines(plates)[0]).toBe("Iron Plate");
    expect(nodeBodyLines(plates)[1]).toMatch(/^Iron Plate: /);
    expect(nodeBodyLines(recycle).at(-1)).toBe("In a loop");
  });

  it("says when there is no recipe or no output data, and counts outputs beyond two", () => {
    expect(nodeBodyLines({ ...miner, recipe: null, products: [] })).toEqual(["No recipe", "No output data"]);
    const three = [miner.products[0], { ...miner.products[0], className: "B" }, { ...miner.products[0], className: "C" }];
    expect(nodeBodyLines({ ...miner, products: three }).at(-1)).toBe("+1 more output");
  });
});

describe("item filter", () => {
  // a -> b -> c -> d, b -> x, and e -> c (a second feeder), f -> g on its own.
  const edges = [
    edge("a", "b", "ore"),
    edge("b", "c", "ingot"),
    edge("c", "d", "plate"),
    edge("b", "x", "scrap"),
    edge("e", "c", "wire"),
    edge("f", "g", "ore"),
  ];

  it("lists the items the site's connections carry, by name, without the unnamed", () => {
    expect(siteItems([...edges, edge("p", "q", null)]).map((i) => i.className)).toEqual(["ingot", "ore", "plate", "scrap", "wire"]);
  });

  it("lights the groups at the item's connections and everything upstream and downstream of them", () => {
    const reach = reachFor("ingot", edges);
    // ingot: b -> c. Downstream: d. Upstream: a. Not x (a sibling branch), not e (a sibling feeder), not f or g.
    expect([...reach.nodes].sort()).toEqual(["a", "b", "c", "d"]);
    expect([...reach.edges].sort()).toEqual([0, 1, 2]);
  });

  it("an item on two separate lines lights both, and an item nothing carries lights nothing", () => {
    const ore = reachFor("ore", edges);
    expect([...ore.nodes].sort()).toEqual(["a", "b", "c", "d", "f", "g", "x"]);
    expect(ore.edges.has(5)).toBe(true);
    expect(reachFor("nothing", edges).nodes.size).toBe(0);
  });

  it("handles a loop without running forever", () => {
    const loop = [edge("a", "b", "x"), edge("b", "a", "y"), edge("b", "c", "z")];
    expect([...reachFor("y", loop).nodes].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("graphSummary", () => {
  it("is counts only, names the site, and points at the tables", () => {
    const { nodes, edges } = ProductionGraphSchema.parse(productionGraphTwoSites.data);
    expect(graphSummary(nodes.slice(0, 5), edges, "Iron Plate site")).toBe(
      "Graph of Iron Plate site: 5 groups, 6 connections, 2 in a loop. The Tables view lists the same.",
    );
    expect(graphSummary(nodes.slice(0, 1), [], "S")).toContain("1 group, 0 connections");
  });
});
