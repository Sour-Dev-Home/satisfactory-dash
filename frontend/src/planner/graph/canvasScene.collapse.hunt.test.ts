import { describe, expect, it } from "vitest";
import type { PlannerNode, ProductionGraph } from "@satisfactory-dash/shared";
import { EMPTY_VIEW, factoryScene, type FactoryView } from "./canvasScene";
import { factoryModels, type FlowPart } from "./hierarchy";

const view = (extra: Partial<FactoryView> = {}): FactoryView => ({ ...EMPTY_VIEW, ...extra });
const rate = { className: "Desc_X_C", name: "X", unit: "items/min" as const, currentPerMinute: 1, maxPerMinute: 2 };

function node(key: string, extra: Partial<PlannerNode> = {}): PlannerNode {
  return {
    key,
    kind: "machines",
    className: "Build_ConstructorMk1_C",
    name: "Constructor",
    recipe: `Recipe ${key}`,
    count: 1,
    machineIds: [`m-${key}`],
    stateCounts: { producing: 1 },
    products: [rate],
    ingredients: [],
    at: { x: 0, y: 0 },
    siteKey: "s",
    loop: false,
    factoryKey: "f",
    ...extra,
  };
}
const belt = (from: string, to: string): FlowPart => ({
  from, to, itemClassName: "Desc_X_C", itemName: "X", ratePerMinute: 60, rate: "measured", mixed: false, carrier: "belt", flow: "supply", unit: "items/min",
});
function graphOf(nodes: PlannerNode[], parts: FlowPart[] = []): ProductionGraph {
  const edges = parts.map((p) => ({ from: p.from, to: p.to, kind: "belt" as const, itemClassName: p.itemClassName, itemName: p.itemName, ratePerMinute: p.ratePerMinute, rate: p.rate, mixed: p.mixed, capacityPerMinute: null, conveyorCount: 1, flow: p.flow }));
  const site = { key: "s", name: "Site", at: { x: 0, y: 0 }, machineCount: nodes.length, stateCounts: {}, topOutputs: [], nodeKeys: nodes.map((n) => n.key) };
  return {
    nodes, edges, sites: [site], unconnectedMachineIds: [], beltData: "present", connectionsRefreshMinutes: 10, notes: [],
    factories: [{ key: "f", name: "F factory", designationId: null, products: [], sideProducts: [], nodeKeys: nodes.map((n) => n.key), siteKeys: ["s"], machineCount: nodes.length, sharedNodeCount: 0 }],
    transports: [], topologyHash: "h",
  };
}
const sceneOf = (g: ProductionGraph, v: FactoryView = view()) => factoryScene(g, factoryModels(g)[0], v);

describe("collapse upstream, hunted", () => {
  it("a post-dominator cycle never hides the cards in it", () => {
    const odd = graphOf([node("x", { collapseUnder: "y" }), node("y", { collapseUnder: "x" })]);
    const scene = sceneOf(odd, view({ collapsed: new Set(["x", "y"]) }));
    expect(scene.cards.map((c) => c.key).sort()).toEqual(["x", "y"]);
  });

  it("a node hanging off a cycle terminates and is hidden by the cycle's card only through a real edge", () => {
    const g = graphOf([node("x", { collapseUnder: "y" }), node("y", { collapseUnder: "x" }), node("t", { collapseUnder: "x" })]);
    expect(() => sceneOf(g, view({ collapsed: new Set(["x"]) }))).not.toThrow();
  });

  it("a self-pointing collapseUnder hides nothing", () => {
    const g = graphOf([node("x", { collapseUnder: "x" })]);
    const scene = sceneOf(g, view({ collapsed: new Set(["x"]) }));
    expect(scene.cards.map((c) => c.key)).toEqual(["x"]);
    expect(scene.cards[0].upstream).toBeUndefined();
  });

  it("prototype-style keys behave as ordinary keys", () => {
    const g = graphOf(
      [node("__proto__", { collapseUnder: "constructor" }), node("constructor", { collapseUnder: null }), node("toString", { collapseUnder: "constructor" })],
      [belt("__proto__", "constructor"), belt("toString", "constructor")],
    );
    const scene = sceneOf(g, view({ collapsed: new Set(["constructor", "__proto__"]) }));
    expect(scene.cards.map((c) => c.key)).toEqual(["constructor"]);
    expect(scene.cards[0].upstream).toEqual({ count: 2, collapsed: true });
    expect(scene.flows).toEqual([]);
    expect(sceneOf(g, view({ collapsed: new Set(["toString"]) })).cards).toHaveLength(3);
  });

  it("no flow or frame references a hidden card", () => {
    const nodes = [node("a", { collapseUnder: "b" }), node("b", { collapseUnder: "c" }), node("c", { collapseUnder: null }), node("d", { collapseUnder: "c" })];
    const g = graphOf(nodes, [belt("a", "b"), belt("b", "c"), belt("d", "c")]);
    for (const collapsed of [["a"], ["b"], ["c"], ["b", "c"], ["a", "b", "c", "d"]]) {
      const scene = sceneOf(g, view({ collapsed: new Set(collapsed) }));
      const keys = new Set(scene.cards.map((c) => c.key));
      for (const f of scene.flows) {
        expect(keys.has(f.from)).toBe(true);
        expect(keys.has(f.to)).toBe(true);
      }
      for (const fr of scene.frames) for (const k of fr.cardKeys) expect(keys.has(k)).toBe(true);
    }
  });

  it("a dominator chain longer than the guard through folded storage does not throw", () => {
    const stores = Array.from({ length: 70 }, (_, i) =>
      node(`s${i}`, { kind: "storage", role: "buffer", recipe: null, className: "Build_StorageContainerMk1_C", name: "Storage Container", collapseUnder: i === 69 ? "q" : `s${i + 1}` }),
    );
    const g = graphOf([node("p", { collapseUnder: "s0" }), ...stores, node("q", { collapseUnder: null })], [belt("p", "s0"), belt("s69", "q")]);
    expect(() => sceneOf(g, view({ storageDetail: false, collapsed: new Set(["q"]) }))).not.toThrow();
  });
});
