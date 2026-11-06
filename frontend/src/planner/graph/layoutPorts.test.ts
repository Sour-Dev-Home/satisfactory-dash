import { beforeEach, describe, expect, it } from "vitest";
import type { PlannerNode, ProductionGraph } from "@satisfactory-dash/shared";
import * as demoWorld from "../../demo/world";
import { EMPTY_VIEW, factoryScene, siteScene, type CanvasFlow, type Card, type Scene } from "./canvasScene";
import { segmentHitsRect } from "./edgeShapes";
import { factoryModels } from "./hierarchy";
import { clearLayoutMemo, layoutScene, type SiteLayout } from "./layoutSite";
import { PORT_D, PORT_INSET, PORT_PITCH, PORTS_MAX } from "./ports";

beforeEach(clearLayoutMemo);

// ADR-0063 build PR 2: the layout with ports. A small scene with a fan-out, two items between one pair and a loop, and
// ADR-0059's dense synthetic factory.

const card = (key: string): Card => ({
  key, kind: "factory", nodeKeys: [key], title: key, lines: [key, "Product · 0/min"], count: 6, className: undefined, glyph: "machines",
  label: key, description: key, facts: [], loop: false, frame: undefined, bubbleKey: undefined,
});
const link = (from: string, to: string, itemName: string, ratePerMinute: number, carrier = "belt"): CanvasFlow => ({
  from, to, itemClassName: `Desc_${itemName.replace(/ /g, "")}_C`, itemName, carrier, flow: "supply", mixed: false, rate: "measured",
  label: itemName, labelLines: [itemName], ratePerMinute, unit: "items/min", quality: "measured",
});
const small: Scene = {
  level: "overview", name: "Factories", frames: [], bubbleKeys: [], foldKeys: [], hasStorage: false, openByDefault: true, noun: "factories",
  cards: ["A", "B", "C", "D"].map(card),
  flows: [
    link("A", "B", "Iron Plate", 30),
    link("A", "B", "Screw", 60),
    link("A", "C", "Iron Plate", 30),
    link("B", "D", "Rotor", 5),
    link("C", "D", "Rotor", 5),
    link("D", "A", "Water", 20),
  ],
};

const rate = { className: "Desc_X_C", name: "X", unit: "items/min" as const, currentPerMinute: 1, maxPerMinute: 2 };
function denseFactory(n: number, width: number): ProductionGraph {
  const nodes: PlannerNode[] = Array.from({ length: n }, (_, i) => ({
    key: `n${i}`, kind: "machines", className: "Build_ConstructorMk1_C", name: "Constructor", recipe: `Recipe ${i}`, count: 1 + (i % 9),
    machineIds: [`m${i}`], stateCounts: { producing: 1 }, products: [rate], ingredients: [], at: { x: i, y: i }, siteKey: "s", loop: false,
    factoryKey: "f", treeKey: `tree|${i}`, collapseUnder: null,
  }));
  const edges: ProductionGraph["edges"] = [];
  const edge = (from: number, to: number, item: number) =>
    edges.push({ from: `n${from}`, to: `n${to}`, kind: "belt", itemClassName: `Desc_${item}_C`, itemName: `Item ${item}`, ratePerMinute: 30, rate: "estimated", mixed: false, capacityPerMinute: null, conveyorCount: 1, flow: "supply" });
  for (let i = width; i < n; i++) {
    edge(i - width, i, i % 6);
    edge(i - width + 1 < i - (i % width) ? i - width + 1 : i - width, i, (i + 1) % 6);
    if (i % 5 === 0 && i >= 2 * width) edge(i - 2 * width, i, (i + 2) % 6);
  }
  edge(n - width, 0, 7);
  const site = { key: "s", name: "Site", at: { x: 0, y: 0 }, machineCount: n, stateCounts: {}, topOutputs: [], nodeKeys: nodes.map((x) => x.key) };
  return {
    nodes, edges, sites: [site], unconnectedMachineIds: [], beltData: "present", connectionsRefreshMinutes: 10, notes: [],
    factories: [{ key: "f", name: "Dense factory", designationId: null, products: [], sideProducts: [], nodeKeys: nodes.map((x) => x.key), siteKeys: ["s"], machineCount: n, sharedNodeCount: 0 }],
    transports: [], topologyHash: "dense",
  };
}
const dense = denseFactory(40, 8);
const denseScene = () => factoryScene(dense, factoryModels(dense)[0], EMPTY_VIEW);

/** Each port's absolute centre. */
const portCentres = (l: SiteLayout) => new Map(l.nodes.flatMap((n) => (n.ports ?? []).map((p) => [p.id, { x: n.x + p.x, y: n.y + p.y }] as const)));

/** Proper crossings: a horizontal leg of one line through a vertical leg of another, not at either's end. */
function crossings(l: SiteLayout): number {
  const segs = l.edges.flatMap((e, k) => e.points.slice(1).map((b, i) => ({ k, a: e.points[i], b })));
  const h = segs.filter((s) => Math.abs(s.a.y - s.b.y) < 0.01 && Math.abs(s.a.x - s.b.x) > 0.01);
  const v = segs.filter((s) => Math.abs(s.a.x - s.b.x) < 0.01 && Math.abs(s.a.y - s.b.y) > 0.01);
  let n = 0;
  for (const p of h) {
    const [x0, x1] = [Math.min(p.a.x, p.b.x), Math.max(p.a.x, p.b.x)];
    for (const q of v) {
      if (p.k === q.k) continue;
      const [y0, y1] = [Math.min(q.a.y, q.b.y), Math.max(q.a.y, q.b.y)];
      if (q.a.x > x0 + 0.01 && q.a.x < x1 - 0.01 && p.a.y > y0 + 0.01 && p.a.y < y1 - 0.01) n++;
    }
  }
  return n;
}

describe("the layout with ports (ADR-0063 Decision 1)", () => {
  it("draws a line per item, each leaving at its source port and ending at its target port's disc edge", () => {
    for (const l of [layoutScene(small), layoutScene(denseScene(), "dense")]) {
      const at = portCentres(l);
      for (const e of l.edges) {
        const src = at.get(e.srcPort!)!;
        const tgt = at.get(e.tgtPort!)!;
        const first = e.points[0];
        const last = e.points[e.points.length - 1];
        expect(first.x).toBeCloseTo(src.x, 6);
        expect(first.y).toBeCloseTo(src.y, 6);
        expect(last.y).toBeCloseTo(tgt.y, 6);
        expect(Math.abs(last.x - tgt.x)).toBeCloseTo(PORT_D / 2, 6);
      }
    }
    const pair = layoutScene(small).edges.filter((e) => e.flow.from === "A" && e.flow.to === "B");
    expect(pair.map((e) => e.flow.itemName).sort()).toEqual(["Iron Plate", "Screw"]);
  });

  it("spaces each edge's ports a pitch apart, inset from the card's top and bottom, the card tall enough to hold them", () => {
    for (const l of [layoutScene(small), layoutScene(denseScene(), "dense")]) {
      for (const n of l.nodes) {
        for (const side of ["l", "r"] as const) {
          const ys = (n.ports ?? []).filter((p) => p.side === side).map((p) => p.y).sort((a, b) => a - b);
          for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeCloseTo(PORT_PITCH, 6);
          if (ys.length > 0) {
            expect(ys[0]).toBeGreaterThanOrEqual(PORT_INSET - 1e-6);
            expect(n.height - ys[ys.length - 1]).toBeGreaterThanOrEqual(PORT_INSET - 1e-6);
          }
        }
      }
    }
  });

  it("fans one item out of one port, and gathers two sources of one item into one", () => {
    const l = layoutScene(small);
    const plate = l.edges.filter((e) => e.flow.from === "A" && e.flow.itemName === "Iron Plate");
    expect(plate).toHaveLength(2);
    expect(plate[0].srcPort).toBe(plate[1].srcPort);
    const rotor = l.edges.filter((e) => e.flow.to === "D");
    expect(rotor[0].tgtPort).toBe(rotor[1].tgtPort);
  });

  it("sends a return flow out of its source's left and into its target's right", () => {
    const l = layoutScene(small);
    const back = l.edges.find((e) => e.flow.from === "D" && e.flow.to === "A")!;
    expect(back.returning).toBe(true);
    const d = l.nodes.find((n) => n.key === "D")!;
    const a = l.nodes.find((n) => n.key === "A")!;
    expect(back.points[0].x).toBeCloseTo(d.x, 6);
    expect(back.points[back.points.length - 1].x).toBeCloseTo(a.x + a.width + PORT_D / 2, 6);
  });

  it("runs every line in horizontal and vertical legs, never through a card other than its own two", () => {
    const l = layoutScene(denseScene(), "dense");
    for (const e of l.edges) {
      for (let i = 1; i < e.points.length; i++) {
        const [a, b] = [e.points[i - 1], e.points[i]];
        expect(Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01).toBe(true);
        for (const n of l.nodes) {
          if (n.key === e.flow.from || n.key === e.flow.to) continue;
          expect(segmentHitsRect(a, b, n), `${e.label} through ${n.key}`).toBe(false);
        }
      }
    }
  });

  // The bound judges the port order (Decision 1's "Crossings"), so it is per line drawn: ports also draw more lines (a pair
  // exchanging two items draws two), a cost the ADR measures apart ("Consequences"). The layout without ports is gone (build
  // PR 7b), so the bound is against its numbers as the ADR's build note PR 2 recorded them: 36 crossings over 65 lines.
  it("adds no more than 10% crossings per line on the dense scene (ADR-0059's metrics, ADR-0063 build PR 2)", () => {
    const WITHOUT_PORTS = { crossings: 36, lines: 65 };
    const l = layoutScene(denseScene(), "dense");
    const on = crossings(l);
    console.info(`[ADR-0063 ports] dense 40-group scene crossings: ${on} (${l.edges.length} lines); without ports ${WITHOUT_PORTS.crossings} (${WITHOUT_PORTS.lines})`);
    expect(on / l.edges.length).toBeLessThanOrEqual((WITHOUT_PORTS.crossings / WITHOUT_PORTS.lines) * 1.1);
  });

  it("folds the demo depot's seven inputs into five ports and a '+2' (the demo data build PR 2 asks for)", () => {
    const g = demoWorld.productionGraph(demoWorld.DEMO_EPOCH).data;
    const iron = g.sites.find((s) => s.name === "Iron works")!;
    const l = layoutScene(siteScene(iron, g), g.topologyHash);
    const depot = l.nodes.find((n) => n.card.title.startsWith("Storage Container"))!;
    const inputs = (depot.ports ?? []).filter((p) => p.side === "l");
    expect(inputs).toHaveLength(PORTS_MAX);
    expect(inputs.find((p) => p.item === "+")?.items).toHaveLength(2);
  });
});
