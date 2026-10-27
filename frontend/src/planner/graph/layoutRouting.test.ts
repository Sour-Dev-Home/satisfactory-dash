import { beforeEach, describe, expect, it } from "vitest";
import type { PlannerNode, ProductionGraph } from "@satisfactory-dash/shared";
import { EMPTY_VIEW, factoryScene, type CanvasFlow, type Card, type Scene } from "./canvasScene";
import { segmentHitsRect } from "./edgeShapes";
import { factoryModels } from "./hierarchy";
import { TRACK_GAP, clearLayoutMemo, layoutScene, layoutStats, returnFlows, type LaidEdge } from "./layoutSite";

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

describe("parallel links between one pair of cards (owner's report, 2026-10-27)", () => {
  // The owner's screenshot, small: one card with three links to the next (one of no known item), which feeds a third,
  // whose output returns to the first. They ran as lines 8 units apart with stacked labels, one line across a label.
  const card = (key: string): Card => ({
    key, kind: "factory", nodeKeys: [key], title: key, lines: [key, "Product · 0/min"], count: 6, className: undefined, glyph: "machines",
    label: key, description: key, facts: [], loop: false, frame: undefined, bubbleKey: undefined,
  });
  const link = (from: string, to: string, itemName: string | null, ratePerMinute: number | null, carrier = "belt"): CanvasFlow => {
    const item = itemName ?? "Item unknown";
    const known = ratePerMinute !== null;
    const lines = [item, ...(known ? [`${ratePerMinute} items/min`] : [])];
    return {
      from, to, itemClassName: itemName === null ? null : `Desc_${itemName.replace(/ /g, "")}_C`, itemName, carrier, flow: "supply", mixed: false,
      rate: known ? "measured" : "unknown", label: lines.join(" · "), labelLines: lines, ratePerMinute, unit: "items/min", quality: known ? "measured" : "unknown",
    };
  };
  const owner: Scene = {
    level: "overview", name: "Factories", frames: [], bubbleKeys: [], foldKeys: [], hasStorage: false, openByDefault: true, noun: "factories",
    cards: ["Automated Wiring factory", "Encased Industrial Beam factory", "Wire factory"].map(card),
    flows: [
      link("Automated Wiring factory", "Encased Industrial Beam factory", null, null),
      link("Automated Wiring factory", "Encased Industrial Beam factory", "Iron Ingot", 0),
      link("Automated Wiring factory", "Encased Industrial Beam factory", "Steel Pipe", 0),
      link("Encased Industrial Beam factory", "Wire factory", "Encased Industrial Beam", 0),
      link("Wire factory", "Automated Wiring factory", "Wire", 0),
    ],
  };
  const box = (e: LaidEdge) => ({ x: e.labelX - e.labelWidth / 2, y: e.labelY - e.labelHeight / 2, width: e.labelWidth, height: e.labelHeight });
  /** The pairs (edge, other edge's label) where the edge's line enters the label's box. */
  const linesThroughLabels = (edges: readonly LaidEdge[]) =>
    edges.flatMap((e) => edges.filter((o) => o !== e && e.points.some((p, i) => i > 0 && segmentHitsRect(e.points[i - 1], p, box(o)))).map((o) => `${e.label} through ${o.label}`));
  /** How close the two closest vertical legs of different edges come where their spans overlap. */
  const closestTracks = (edges: readonly LaidEdge[]) => {
    const legs = edges.flatMap((e, k) =>
      e.points.flatMap((p, i) => (i > 0 && Math.abs(p.x - e.points[i - 1].x) < 0.01 && Math.abs(p.y - e.points[i - 1].y) > 0.01 ? [{ k, x: p.x, lo: Math.min(p.y, e.points[i - 1].y), hi: Math.max(p.y, e.points[i - 1].y) }] : [])),
    );
    let closest = Infinity;
    for (const a of legs) for (const b of legs) if (a.k < b.k && Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > 0.01) closest = Math.min(closest, Math.abs(a.x - b.x));
    return closest;
  };

  it("draws the links from one card to the next as one line with one label, keeping every link", () => {
    const l = layoutScene(owner);
    const pair = l.edges.filter((e) => e.flow.from === "Automated Wiring factory" && e.flow.to === "Encased Industrial Beam factory");
    expect(pair).toHaveLength(1);
    expect(pair[0].labelLines).toEqual(["Iron Ingot, Steel Pipe", "+1 unknown", "at least 0 items/min"]);
    expect(pair[0].parts.map((i) => l.flows[i].label)).toEqual(["Item unknown", "Iron Ingot · 0 items/min", "Steel Pipe · 0 items/min"]);
    // The layout still hands every link on, for the item filter.
    expect(l.flows).toHaveLength(5);
    expect(l.edges).toHaveLength(3);
  });

  it("runs no line through another edge's label, here and on the dense scene", () => {
    expect(linesThroughLabels(layoutScene(owner).edges)).toEqual([]);
    expect(linesThroughLabels(layout().edges)).toEqual([]);
  });

  it("keeps vertical legs side by side at least TRACK_GAP apart", () => {
    expect(closestTracks(layoutScene(owner).edges)).toBeGreaterThanOrEqual(TRACK_GAP - 0.01);
    expect(closestTracks(layout().edges)).toBeGreaterThanOrEqual(TRACK_GAP - 0.01);
  });

  it("still draws links on different carriers between the same cards as lines of their own, clear of each other's labels", () => {
    const scene: Scene = { ...owner, flows: [...owner.flows, link("Automated Wiring factory", "Encased Industrial Beam factory", "Water", 30, "pipe")] };
    const l = layoutScene(scene);
    const pair = l.edges.filter((e) => e.flow.from === "Automated Wiring factory" && e.flow.to === "Encased Industrial Beam factory");
    expect(pair.map((e) => e.flow.carrier).sort()).toEqual(["belt", "pipe"]);
    expect(linesThroughLabels(l.edges)).toEqual([]);
  });
});
