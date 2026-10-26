import { beforeEach, describe, expect, it } from "vitest";
import type { PlannerNode, ProductionGraph } from "@satisfactory-dash/shared";
import { EMPTY_VIEW, factoryScene } from "./canvasScene";
import { segmentHitsRect } from "./edgeShapes";
import { factoryModels } from "./hierarchy";
import { clearLayoutMemo, layoutScene, layoutStats, returnFlows } from "./layoutSite";

beforeEach(clearLayoutMemo);

const rate = { className: "Desc_X_C", name: "X", unit: "items/min" as const, currentPerMinute: 1, maxPerMinute: 2 };

/**
 * A made-up dense factory (ADR-0059's acceptance scene, synthetic): `n` groups in layers of `width`, each fed by two groups
 * of the layer before, every fifth also by a group two layers back (a column-skipping edge), and one flow from a late
 * group back to an early one (a return, as the aluminium water loop).
 */
function denseFactory(n: number, width: number): ProductionGraph {
  const nodes: PlannerNode[] = Array.from({ length: n }, (_, i) => ({
    key: `n${i}`,
    kind: "machines",
    className: "Build_ConstructorMk1_C",
    name: "Constructor",
    recipe: `Recipe ${i}`,
    count: 1 + (i % 9),
    machineIds: [`m${i}`],
    stateCounts: { producing: 1 },
    products: [rate],
    ingredients: [],
    at: { x: i, y: i },
    siteKey: "s",
    loop: false,
    factoryKey: "f",
    treeKey: `tree|${i}`,
    collapseUnder: null,
  }));
  const edges: ProductionGraph["edges"] = [];
  const edge = (from: number, to: number, item: number) =>
    edges.push({ from: `n${from}`, to: `n${to}`, kind: "belt", itemClassName: `Desc_${item}_C`, itemName: `Item ${item}`, ratePerMinute: 30, rate: "estimated", mixed: false, capacityPerMinute: null, conveyorCount: 1, flow: "supply" });
  for (let i = width; i < n; i++) {
    edge(i - width, i, i % 6);
    edge(i - width + 1 < i - (i % width) ? i - width + 1 : i - width, i, (i + 1) % 6);
    if (i % 5 === 0 && i >= 2 * width) edge(i - 2 * width, i, (i + 2) % 6);
  }
  // n0 feeds n8, n16 and on to the last layer's first group: that group returns a flow to n0, closing a loop.
  edge(n - width, 0, 7);
  const site = { key: "s", name: "Site", at: { x: 0, y: 0 }, machineCount: n, stateCounts: {}, topOutputs: [], nodeKeys: nodes.map((x) => x.key) };
  return {
    nodes,
    edges,
    sites: [site],
    unconnectedMachineIds: [],
    beltData: "present",
    connectionsRefreshMinutes: 10,
    notes: [],
    factories: [{ key: "f", name: "Dense factory", designationId: null, products: [], sideProducts: [], nodeKeys: nodes.map((x) => x.key), siteKeys: ["s"], machineCount: n, sharedNodeCount: 0 }],
    transports: [],
    topologyHash: "dense",
  };
}

const graph = denseFactory(40, 8);
const layout = () => layoutScene(factoryScene(graph, factoryModels(graph)[0], EMPTY_VIEW), graph.topologyHash);

type Rect = { x: number; y: number; width: number; height: number };
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("returnFlows", () => {
  it("starts from the sources, so only the flow that closes a loop is a return", () => {
    // The aluminium chain: miner -> refinery A -> refinery B -> foundry, B's water back into A, A's silica to the foundry.
    const cards = ["refineryB", "foundry", "refineryA", "miner", "water"];
    const flows = [
      { from: "miner", to: "refineryA" },
      { from: "water", to: "refineryA" },
      { from: "refineryA", to: "refineryB" },
      { from: "refineryB", to: "refineryA" },
      { from: "refineryB", to: "foundry" },
      { from: "refineryA", to: "foundry" },
    ];
    expect([...returnFlows(cards, flows)]).toEqual([3]);
  });

  it("breaks a loop with no way in at the first card listed, and leaves a graph without loops alone", () => {
    expect([...returnFlows(["a", "b", "c"], [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" }])]).toEqual([2]);
    expect(returnFlows(["a", "b", "c"], [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "c" }]).size).toBe(0);
  });

  it("survives a chain far longer than the call stack would allow", () => {
    const n = 50_000;
    const keys = Array.from({ length: n }, (_, i) => `k${i}`);
    const flows = keys.slice(1).map((k, i) => ({ from: keys[i], to: k }));
    expect(returnFlows(keys, [...flows, { from: keys[n - 1], to: keys[0] }]).size).toBe(1);
  });
});

describe("orthogonal routing on dagre (ADR-0059)", () => {
  it("draws every edge in horizontal and vertical legs only", () => {
    const { edges } = layout();
    expect(edges.length).toBeGreaterThan(20);
    for (const e of edges) {
      for (let i = 1; i < e.points.length; i++) {
        const [a, b] = [e.points[i - 1], e.points[i]];
        expect(Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01).toBe(true);
      }
    }
    expect(layoutStats().routerFailures).toBe(0);
  });

  it("runs no edge through a card other than its own two ends", () => {
    const { edges, nodes } = layout();
    for (const e of edges) {
      const others = nodes.filter((n) => n.key !== e.flow.from && n.key !== e.flow.to);
      for (let i = 1; i < e.points.length; i++) for (const n of others) expect(segmentHitsRect(e.points[i - 1], e.points[i], n)).toBe(false);
    }
  });

  it("keeps every label clear of every card and every other label", () => {
    const { edges, nodes } = layout();
    const box = (e: (typeof edges)[number]) => ({ x: e.labelX - e.labelWidth / 2, y: e.labelY - e.labelHeight / 2, width: e.labelWidth, height: e.labelHeight });
    for (const e of edges) {
      for (const n of nodes) expect(overlap(box(e), n)).toBe(false);
      for (const other of edges) if (other !== e) expect(overlap(box(e), box(other))).toBe(false);
    }
  });

  it("starts and ends each edge on its cards' sides", () => {
    const { edges, nodes } = layout();
    const byKey = new Map(nodes.map((n) => [n.key, n]));
    for (const e of edges) {
      const [first, last] = [e.points[0], e.points[e.points.length - 1]];
      for (const [p, n] of [[first, byKey.get(e.flow.from)!], [last, byKey.get(e.flow.to)!]] as const) {
        const onSide = Math.abs(p.x - n.x) < 0.5 || Math.abs(p.x - (n.x + n.width)) < 0.5;
        expect(onSide && p.y >= n.y - 0.5 && p.y <= n.y + n.height + 0.5).toBe(true);
      }
    }
  });

  it("reverses one flow of the loop, and draws it from its source back to its target", () => {
    const { edges, nodes } = layout();
    const byKey = new Map(nodes.map((n) => [n.key, n]));
    const back = edges.filter((e) => byKey.get(e.flow.to)!.x < byKey.get(e.flow.from)!.x);
    // The search enters the loop at n8 (fed by the source n1), so the flow that closes it is n0 -> n8: n0's only input is
    // the return. With an outside input at the loop's start (the aluminium refinery) the return itself is reversed (above).
    expect(back.map((e) => `${e.flow.from}->${e.flow.to}`)).toEqual(["n0->n8"]);
    const [ret] = back;
    expect(ret.points[ret.points.length - 1].x).toBeLessThan(ret.points[0].x);
  });
});
