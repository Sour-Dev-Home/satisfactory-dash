import { describe, expect, it } from "vitest";
import { ProductionGraphSchema, type PlannerEdge, type PlannerNode, type PlannerSite, type ProductionGraph } from "@satisfactory-dash/shared";
import { productionGraphTwoSites } from "@satisfactory-dash/shared/fixtures";
import { productionGraph as demoProductionGraph } from "../../demo/world";
import { BUILDING_ICON_SIZE, LABEL_GAP, LABEL_H, LINE_H, NODE_PAD_X, NODE_SEP, RANK_SEP, cardLineY, countBadgeWidth, labelPlacement, layoutSite, nodeSize } from "./layoutSite";
import { MAX_SUMMARY_CHARS, edgeLabel } from "./graphModel";
import { fitView } from "./viewport";

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

  it("gives a known building its icon and an unknown class none (the card then draws its kind's glyph), at the same size", () => {
    const known = nodeSize({ ...graph.nodes[0], className: "Build_ConstructorMk1_C" });
    const unknown = nodeSize({ ...graph.nodes[0], className: "Build_SomethingNew_C" });
    expect(known.iconUrl).toBe("/game-assets/buildings/constructor.webp");
    expect(unknown.iconUrl).toBeUndefined();
    expect(known.height).toBe(unknown.height);
    expect(known.width).toBe(unknown.width);
  });

  it("is icon-first and compact: a group card is the icon row and one line, under 90 units tall", () => {
    const { height, lines } = nodeSize(graph.nodes[0]);
    expect(lines).toHaveLength(1);
    expect(BUILDING_ICON_SIZE).toBe(40);
    expect(height).toBeLessThan(90);
    expect(height).toBeGreaterThan(BUILDING_ICON_SIZE + LINE_H);
  });

  it("sizes a card from its one line and its count badge: longer text is wider, but the line is capped", () => {
    const [short, long] = [graph.nodes[0], { ...graph.nodes[2], products: [{ ...graph.nodes[2].products[0], name: "A".repeat(200) }] }];
    const a = nodeSize(short);
    const b = nodeSize(long);
    expect(b.width).toBeGreaterThan(a.width);
    expect(b.lines[0].length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS);
    // The recipe and the loop marker no longer make a card taller.
    expect(nodeSize({ ...short, loop: true }).height).toBe(nodeSize({ ...short, loop: false }).height);
    expect(nodeSize({ ...short, count: 1234 }).width).toBeGreaterThanOrEqual(NODE_PAD_X * 2 + BUILDING_ICON_SIZE + countBadgeWidth(1234));
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

describe("the compact metrics and label placement", () => {
  it("keeps the ranks and rows tight, and sizes a card from the readable type", () => {
    expect(RANK_SEP).toBe(40);
    expect(NODE_SEP).toBe(20);
    const node = graph.nodes[0];
    const { height, lines } = nodeSize(node);
    expect(height).toBe(cardLineY(lines.length - 1) + 5 + 5);
  });

  it("puts a label just above the middle of a level edge, clear of the line by the gap", () => {
    const at = labelPlacement([{ x: 0, y: 100 }, { x: 200, y: 100 }], 120);
    expect(at.x).toBeCloseTo(100);
    expect(at.y).toBeCloseTo(100 - (LABEL_H / 2 + LABEL_GAP));
  });

  it("uses the segment that holds the path's middle, and puts a label beside a vertical one", () => {
    // Lengths 10 and 90: the middle (50) is on the second, vertical, segment; the label goes right of it.
    const at = labelPlacement([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 90 }], 80);
    expect(at.y).toBeCloseTo(40);
    expect(at.x).toBeCloseTo(10 + 40 + LABEL_GAP);
    expect(labelPlacement([], 50)).toEqual({ x: 0, y: 0 });
    expect(labelPlacement([{ x: 5, y: 6 }], 50)).toEqual({ x: 5, y: 6 });
  });

  it("lays every label in the box dagre reserved for it: on its own edge, clear of every card and every other label", () => {
    const { edges, nodes } = layoutSite(iron, graph);
    const box = (e: (typeof edges)[number]) => ({ x: e.labelX - e.labelWidth / 2, y: e.labelY - e.labelHeight / 2, width: e.labelWidth, height: e.labelHeight });
    const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    for (const e of edges) {
      expect(e.labelWidth).toBeGreaterThan(0);
      // On its own line: the line passes through the label's box (the pill sits on it).
      const dist = Math.min(...e.points.slice(1).map((p, i) => segmentDistance(e.labelX, e.labelY, e.points[i], p)));
      expect(dist).toBeLessThanOrEqual(e.labelHeight / 2 + LABEL_GAP);
      for (const n of nodes) expect(overlap(box(e), n)).toBe(false);
      for (const other of edges) if (other !== e) expect(overlap(box(e), box(other))).toBe(false);
    }
  });

  it("words a label by how sure the rate is: about for an estimate, plain when measured, no number when unknown", () => {
    const labels = layoutSite(iron, graph).edges.map((e) => e.label);
    expect(labels).toContain("Iron Ingot · about 102.2 items/min");
    expect(layoutSite(iron, graph).edges.map((e) => e.labelLines)).toContainEqual(["Iron Ingot", "about 102.2 items/min"]);
    expect(labels).toContain("Iron Ore · 120 items/min");
    expect(labels.some((l) => l.includes("~"))).toBe(false);
    const unknown = graph.edges.find((e) => e.rate === "unknown")!;
    expect(edgeLabel(unknown)).not.toMatch(/\d/);
  });
});

/** The distance from a point to the segment a-b. */
function segmentDistance(px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }) {
  const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * (b.x - a.x) + (py - a.y) * (b.y - a.y)) / len2));
  return Math.hypot(px - (a.x + t * (b.x - a.x)), py - (a.y + t * (b.y - a.y)));
}

describe("layout width with two-line edge labels", () => {
  it("keeps the fixture iron site narrow, with labels of at most two lines", () => {
    const layout = layoutSite(iron, graph);
    // Was about 1745 with one-line labels, then 1561 (a 0.61 fit on a 990 x 500 stage); narrower, wrapped cards now fit
    // a 990 px stage at a readable zoom.
    expect(fitView(layout.width, layout.height, { width: 990, height: 500 }).k).toBeGreaterThanOrEqual(0.75);
    expect(layout.width).toBeLessThanOrEqual(1270);
    for (const e of layout.edges) {
      expect(e.labelLines.length).toBeGreaterThanOrEqual(1);
      expect(e.labelLines.length).toBeLessThanOrEqual(2);
      expect(e.labelLines.join(" · ").length).toBeGreaterThan(0);
    }
  });
});
