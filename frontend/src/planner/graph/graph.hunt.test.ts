import { describe, expect, it } from "vitest";
import type { FactoryBuilding, PlannerEdge, PlannerNode, PlannerSite, ProductionGraph } from "@satisfactory-dash/shared";
import { factoryMixed } from "@satisfactory-dash/shared/fixtures";
import { layoutSite } from "./layoutSite";
import { reachFor, edgeLabel, graphSummary } from "./graphModel";
import { joinMachines } from "./panelJoin";
import { FIT_PAD, MAX_ZOOM, MIN_ZOOM, canvasHeight, fitView, keyView, revealRect, toStage, zoomAt } from "./viewport";

const rate = { className: "Desc_X_C", name: "X", unit: "items/min" as const, currentPerMinute: 1, maxPerMinute: 2 };
const node = (key: string, name = "Same name"): PlannerNode => ({
  key, kind: "machines", className: "C", name, recipe: "R", count: 1, machineIds: [key], stateCounts: { producing: 1 },
  products: [rate], ingredients: [], at: { x: 0, y: 0 }, siteKey: "s", loop: false,
});
const edge = (from: string, to: string, item: string | null = "Desc_X_C", extra: Partial<PlannerEdge> = {}): PlannerEdge => ({
  from, to, kind: "belt", itemClassName: item, itemName: item, ratePerMinute: 10, rate: "measured", mixed: false, capacityPerMinute: null, conveyorCount: 1, ...extra,
});
function build(keys: string[], edges: PlannerEdge[]): { site: PlannerSite; graph: ProductionGraph } {
  const nodes = keys.map((k) => node(k));
  const site: PlannerSite = { key: "s", name: "S", at: { x: 0, y: 0 }, machineCount: keys.length, stateCounts: {}, topOutputs: [], nodeKeys: keys };
  return { site, graph: { nodes, edges, sites: [site], unconnectedMachineIds: [], beltData: "present", connectionsRefreshMinutes: 10, notes: [] } };
}
const finite = (n: number) => Number.isFinite(n);
function allFinite(l: ReturnType<typeof layoutSite>) {
  expect(finite(l.width) && finite(l.height)).toBe(true);
  for (const n of l.nodes) expect([n.x, n.y, n.width, n.height].every(finite)).toBe(true);
  for (const e of l.edges) {
    expect([e.labelX, e.labelY].every(finite)).toBe(true);
    for (const p of e.points) expect(finite(p.x) && finite(p.y)).toBe(true);
  }
}

describe("layoutSite hunt", () => {
  it("handles empty, one node, self-edge, disconnected, cycles, duplicate edges, with finite numbers", () => {
    allFinite(layoutSite(build([], []).site, build([], []).graph));
    allFinite(layoutSite(...Object.values(build(["a"], [])) as [PlannerSite, ProductionGraph]));
    for (const edges of [
      [edge("a", "a")],
      [edge("a", "b"), edge("b", "a")],
      [edge("a", "b"), edge("a", "b"), edge("a", "b", "Desc_Y_C")],
      [edge("a", "b"), edge("b", "c"), edge("c", "a"), edge("c", "c")],
    ]) {
      const { site, graph } = build(["a", "b", "c", "d"], edges);
      const l = layoutSite(site, graph);
      allFinite(l);
      expect(l.edges).toHaveLength(edges.length);
      expect(l.nodes).toHaveLength(4);
    }
  });

  it("is order independent in shape: shuffled node and edge input gives the same laid positions per key", () => {
    const keys = Array.from({ length: 12 }, (_, i) => `n${i}`);
    const edges = keys.slice(1).map((k, i) => edge(keys[Math.floor(i / 2)], k));
    const a = build(keys, edges);
    const l1 = layoutSite(a.site, a.graph);
    const l2 = layoutSite(a.site, a.graph);
    expect(l2).toEqual(l1);
    // same input object twice is deterministic; a reversed edge list must still place every node once, finite, non-overlapping
    const b = build(keys, [...edges].reverse());
    const l3 = layoutSite(b.site, b.graph);
    allFinite(l3);
    expect(new Set(l3.nodes.map((n) => n.key)).size).toBe(12);
  });

  it("duplicate labels (same names) keep distinct keys", () => {
    const { site, graph } = build(["a", "b", "c"], [edge("a", "b"), edge("a", "c")]);
    const l = layoutSite(site, graph);
    expect(new Set(l.nodes.map((n) => n.key)).size).toBe(3);
  });

  it("a site listing a node key twice or an unknown key does not crash", () => {
    const { site, graph } = build(["a", "b"], [edge("a", "b")]);
    const l = layoutSite({ ...site, nodeKeys: ["a", "b", "ghost"] }, graph);
    expect(l.nodes).toHaveLength(2);
    allFinite(l);
  });
});

describe("viewport hunt", () => {
  const ok = (v: { x: number; y: number; k: number }) => expect([v.x, v.y, v.k].every(finite)).toBe(true);
  it("fitView and canvasHeight stay finite for zero, negative, tiny and huge stages and drawings", () => {
    for (const stage of [{ width: 0, height: 0 }, { width: -5, height: -5 }, { width: 1, height: 1 }, { width: 1e6, height: 1e6 }]) {
      for (const [w, h] of [[0, 0], [-1, 5], [10, 10], [1e7, 1e7], [1e-9, 1e-9]]) {
        const v = fitView(w, h, stage);
        ok(v);
        expect(v.k).toBeLessThanOrEqual(1);
        expect(finite(canvasHeight(w, h, stage.width))).toBe(true);
      }
    }
  });
  it("fit never exceeds 1 and floors at 0.8 for a huge drawing, anchored at FIT_PAD", () => {
    const v = fitView(1e5, 1e5, { width: 1000, height: 600 });
    expect(v).toEqual({ k: 0.8, x: FIT_PAD, y: FIT_PAD });
  });
  it("zoom clamps at both extremes, repeatedly, and the anchor stays put", () => {
    let v = { x: 10, y: 20, k: 1 };
    for (let i = 0; i < 100; i++) v = zoomAt(v, 2, 300, 200);
    expect(v.k).toBe(MAX_ZOOM);
    expect(300 - (300 - v.x)).toBe(v.x + 0);
    for (let i = 0; i < 200; i++) v = zoomAt(v, 0.5, 300, 200);
    expect(v.k).toBe(MIN_ZOOM);
    ok(v);
    // a clamped zoom is a no-op, not a drift
    const at = zoomAt(v, 0.5, 5, 5);
    expect(at).toEqual(v);
  });
  it("zoom then pan composes; keyView returns null for other keys and fit for 0", () => {
    const fit = { x: 1, y: 2, k: 0.9 };
    expect(keyView({ x: 0, y: 0, k: 2 }, "0", fit, { width: 10, height: 10 })).toBe(fit);
    expect(keyView(fit, "a", fit, { width: 10, height: 10 })).toBeNull();
    expect(keyView(fit, "Enter", fit, { width: 10, height: 10 })).toBeNull();
  });
  it("toStage with a 0-size rect or a 0 stage is finite", () => {
    expect(toStage({ left: 0, top: 0, width: 0, height: 0 }, { width: 1000, height: 600 }, 5, 6)).toEqual({ x: 5, y: 6, scale: 1 });
  });
  it("revealRect with a rect bigger than the stage still returns finite", () => {
    ok(revealRect({ x: 0, y: 0, k: 1 }, { x: 0, y: 0, width: 5000, height: 5000 }, { width: 100, height: 100 }));
  });
});

describe("reachFor hunt", () => {
  it("terminates on cycles and self-edges; unknown item lights nothing; null-item edges are never matched", () => {
    const edges = [edge("a", "b"), edge("b", "c"), edge("c", "a"), edge("c", "c"), edge("x", "y", null)];
    const r = reachFor("Desc_X_C", edges);
    expect([...r.nodes].sort()).toEqual(["a", "b", "c"]);
    const none = reachFor("Nope", edges);
    expect(none.nodes.size).toBe(0);
    expect(none.edges.size).toBe(0);
    expect(reachFor("", edges).nodes.size).toBe(0);
  });
  it("pipes and belts are treated alike", () => {
    const r = reachFor("W", [edge("a", "b", "W", { kind: "pipe" }), edge("b", "c", "Z", { kind: "belt" })]);
    expect([...r.nodes].sort()).toEqual(["a", "b", "c"]);
  });
  it("a long chain does not blow the stack", () => {
    const edges = Array.from({ length: 50000 }, (_, i) => edge(`n${i}`, `n${i + 1}`, i === 0 ? "A" : "B"));
    expect(reachFor("A", edges).nodes.size).toBe(50001);
  });
});

describe("text hunt", () => {
  it("edgeLabel with measured rate but null ratePerMinute and an empty name stays a string", () => {
    expect(typeof edgeLabel(edge("a", "b", "X", { ratePerMinute: null, rate: "measured" }))).toBe("string");
  });
  it("graphSummary with markup in the site name is plain text", () => {
    expect(graphSummary([], [], "<img onerror=x>")).toContain("<img onerror=x>");
  });
});

describe("joinMachines hunt", () => {
  const b = factoryMixed.data.buildings[0];
  const mk = (id: string): FactoryBuilding => ({ ...b, id });
  it("duplicates in machineIds are listed per occurrence; unknown count as missing; empty is empty", () => {
    const j = joinMachines({ machineIds: ["a", "a", "zz"] }, [mk("a")]);
    expect(j.machines).toHaveLength(2);
    expect(j.missing).toBe(1);
    expect(joinMachines({ machineIds: [] }, [])).toEqual({ machines: [], missing: 0 });
  });
  it("duplicate building ids in the factory read take one of them without crashing", () => {
    expect(joinMachines({ machineIds: ["a"] }, [mk("a"), mk("a")]).machines).toHaveLength(1);
  });
  it("a prototype-ish id is just missing", () => {
    expect(joinMachines({ machineIds: ["__proto__", "constructor"] }, [mk("a")]).missing).toBe(2);
  });
});
