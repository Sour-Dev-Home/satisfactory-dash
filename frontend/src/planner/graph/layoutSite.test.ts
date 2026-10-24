import { describe, expect, it } from "vitest";
import { ProductionGraphSchema, type PlannerEdge, type PlannerNode, type PlannerSite, type ProductionGraph } from "@satisfactory-dash/shared";
import { productionGraphTwoSites } from "@satisfactory-dash/shared/fixtures";
import { productionGraph as demoProductionGraph } from "../../demo/world";
import { layoutSite, nodeSize } from "./layoutSite";

const graph: ProductionGraph = ProductionGraphSchema.parse(productionGraphTwoSites.data);
const iron = graph.sites[0];

/** Decision 3's worker trigger: a layout over this on a real site means "move layoutSite into a worker". */
const WORKER_TRIGGER_MS = 100;
/** The unit test's own bound: generous, since CI machines vary. */
const TEST_BOUND_MS = 2_000;

const rate = { className: "Desc_X_C", name: "X", unit: "items/min" as const, currentPerMinute: 1, maxPerMinute: 2 };

/** A made-up site of `n` groups in layers of ten, each wired to two of the layer before, with a loop edge now and then. */
function generatedSite(n: number): { site: PlannerSite; graph: ProductionGraph } {
  const nodes: PlannerNode[] = Array.from({ length: n }, (_, i) => ({
    key: `n${i}`,
    kind: "machines",
    className: "Build_ConstructorMk1_C",
    name: `Constructor ${i}`,
    recipe: `Recipe number ${i}`,
    count: 1 + (i % 9),
    machineIds: [`m${i}`],
    stateCounts: { producing: 1 },
    products: [rate],
    ingredients: [],
    at: { x: i, y: i },
    siteKey: "s",
    loop: i % 25 === 0,
  }));
  const edges: PlannerEdge[] = [];
  for (let i = 10; i < n; i++) {
    for (const j of [i - 10, i - 9]) {
      edges.push({ from: `n${j}`, to: `n${i}`, kind: "belt", itemClassName: `Desc_${i % 6}_C`, itemName: `Item ${i % 6}`, ratePerMinute: 30, rate: "estimated", mixed: false, capacityPerMinute: null, conveyorCount: 1 });
    }
  }
  edges.push({ ...edges[0], from: "n100", to: "n20" });
  const site: PlannerSite = { key: "s", name: "Big site", at: { x: 0, y: 0 }, machineCount: n, stateCounts: { producing: n }, topOutputs: [], nodeKeys: nodes.map((x) => x.key) };
  return { site, graph: { nodes, edges, sites: [site], unconnectedMachineIds: [], beltData: "present", connectionsRefreshMinutes: 10, notes: [] } };
}

const time = (run: () => void) => {
  const start = performance.now();
  run();
  return performance.now() - start;
};

describe("layoutSite", () => {
  it("places every group and every connection of the site, left to right", () => {
    const layout = layoutSite(iron, graph);
    expect(layout.nodes).toHaveLength(5);
    expect(layout.edges).toHaveLength(5);
    const x = (suffix: string) => layout.nodes.find((n) => n.key.includes(suffix))!.x;
    expect(x("MinerMk2")).toBeLessThan(x("SmelterMk1"));
    expect(x("SmelterMk1")).toBeLessThan(x("Iron Plate|"));
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
    for (const e of layout.edges) {
      expect(e.points.length).toBeGreaterThanOrEqual(2);
      expect(e.label.length).toBeGreaterThan(0);
    }
  });

  it("is deterministic: the same site gives the same positions", () => {
    expect(layoutSite(iron, graph)).toEqual(layoutSite(iron, graph));
    const big = generatedSite(60);
    expect(layoutSite(big.site, big.graph)).toEqual(layoutSite(big.site, big.graph));
  });

  it("sizes a card from its text: longer text is wider, more lines are taller, and it is capped", () => {
    const [short, long] = [graph.nodes[0], { ...graph.nodes[2], recipe: "A".repeat(200) }];
    const a = nodeSize(short);
    const b = nodeSize(long);
    expect(b.width).toBeGreaterThan(a.width);
    expect(b.lines[0].length).toBeLessThanOrEqual(34);
    const withLoop = nodeSize({ ...short, loop: true });
    expect(withLoop.height).toBeGreaterThan(nodeSize({ ...short, loop: false }).height);
  });

  it("keeps cards from overlapping", () => {
    const { site, graph: g } = generatedSite(40);
    const { nodes } = layoutSite(site, g);
    for (const a of nodes)
      for (const b of nodes)
        if (a !== b) expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
  });

  it("leaves out a connection whose end is outside the site, and lays out an empty site", () => {
    const stray: ProductionGraph = { ...graph, edges: [...graph.edges, { ...graph.edges[0], to: "elsewhere" }] };
    expect(layoutSite(iron, stray).edges).toHaveLength(5);
    const empty = layoutSite({ ...iron, nodeKeys: [] }, graph);
    expect(empty.nodes).toEqual([]);
  });

  it("lays out the demo world's sites and a generated 150-node site within the bound", () => {
    const timings: Record<string, number> = {};
    const demo = demoProductionGraph(Date.now()).data;
    for (const s of demo.sites) timings[s.name] = time(() => layoutSite(s, demo));
    timings["fixture iron site"] = time(() => layoutSite(iron, graph));
    const big = generatedSite(150);
    let layout!: ReturnType<typeof layoutSite>;
    timings["generated 150 nodes"] = time(() => {
      layout = layoutSite(big.site, big.graph);
    });
    expect(layout.nodes).toHaveLength(150);
    for (const [name, ms] of Object.entries(timings)) {
      expect(ms, name).toBeLessThan(TEST_BOUND_MS);
      if (ms > WORKER_TRIGGER_MS) console.warn(`layoutSite: ${name} took ${Math.round(ms)} ms (over Decision 3's ${WORKER_TRIGGER_MS} ms worker trigger)`);
    }
    console.info(`layoutSite timings (ms): ${JSON.stringify(Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, Math.round(v)])))}`);
  });
});
