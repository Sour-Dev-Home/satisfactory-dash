import { describe, expect, it } from "vitest";
import type { PlannerNode, ProductionGraph } from "@satisfactory-dash/shared";
import { aggregateFlows, bubblesOf, factoryAsSite, factoryModels, foldBubbles, shareSplit, type FlowPart } from "./hierarchy";
import { distanceText } from "../plannerText";

function node(over: Partial<PlannerNode> & { key: string }): PlannerNode {
  return {
    kind: "machines",
    className: "Build_ConstructorMk1_C",
    name: "Constructor",
    recipe: "Iron Plate",
    count: 2,
    machineIds: [over.key],
    stateCounts: {},
    products: [{ className: "Desc_IronPlate_C", name: "Iron Plate", unit: "items/min", currentPerMinute: 10, maxPerMinute: 20 }],
    ingredients: [],
    at: { x: 0, y: 0 },
    siteKey: "s1",
    loop: false,
    ...over,
  };
}

function graphWith(nodes: PlannerNode[], factoryNodeKeys: string[], siteKeys = ["s1"]): ProductionGraph {
  return {
    sites: [{ key: "s1", name: "Main", at: { x: 0, y: 0 }, machineCount: 4, stateCounts: {}, topOutputs: [], nodeKeys: [] }],
    nodes,
    edges: [],
    transports: [],
    factories: [{ key: "f1", name: "F", siteKeys, nodeKeys: factoryNodeKeys, machineCount: 0, products: [], sideProducts: [] }],
    unconnectedMachineIds: [],
  } as unknown as ProductionGraph;
}

const part = (over: Partial<FlowPart>): FlowPart => ({
  from: "a", to: "b", itemClassName: "I", itemName: "I", ratePerMinute: 10, rate: "measured", mixed: false,
  carrier: "belt", flow: "supply", unit: "items/min", ...over,
});

describe("hunt: factoryModels", () => {
  it("counts a state named like an Object.prototype member as a number", () => {
    const g = graphWith([node({ key: "n1", stateCounts: { constructor: 2, toString: 1 } })], ["n1"]);
    const sc = factoryModels(g)[0].stateCounts;
    expect(sc.constructor).toBe(2);
    expect(sc.toString).toBe(1);
  });

  it("a __proto__ state from JSON is kept as an own number", () => {
    const stateCounts = JSON.parse('{"__proto__": 3}') as Record<string, number>;
    const sc = factoryModels(graphWith([node({ key: "n1", stateCounts })], ["n1"]))[0].stateCounts;
    expect(Object.hasOwn(sc, "__proto__")).toBe(true);
  });

  it("a node listed twice in a factory is counted once", () => {
    const g = graphWith([node({ key: "n1", stateCounts: { producing: 2 } })], ["n1", "n1"]);
    const m = factoryModels(g)[0];
    expect(m.nodes).toHaveLength(1);
    expect(m.stateCounts.producing).toBe(2);
    expect(factoryAsSite(m).nodeKeys).toEqual(["n1"]);
  });

  it("a site listed twice does not appear twice as remote", () => {
    const g = graphWith([node({ key: "n1" })], ["n1"], ["s1", "s2", "s2"]);
    g.sites.push({ ...g.sites[0], key: "s2", name: "Far" });
    expect(factoryModels(g)[0].remoteSites).toHaveLength(1);
  });

  it("unknown keys are skipped without crashing", () => {
    const m = factoryModels(graphWith([node({ key: "n1" })], ["zzz", "n1"], ["nope"]))[0];
    expect(m.nodes.map((n) => n.key)).toEqual(["n1"]);
    expect(m.home?.key).toBe("s1");
  });
});

describe("hunt: aggregateFlows", () => {
  const cardOf = (k: string) => k;
  it("an estimated part plus a measured one is estimated; unknown with a number is not counted", () => {
    const f = aggregateFlows([part({ rate: "estimated" }), part({}), part({ rate: "unknown", ratePerMinute: 99 })], cardOf)[0];
    expect(f).toMatchObject({ quality: "atLeast", ratePerMinute: 20, parts: 3 });
  });
  it("keeps pipes and belts apart, and drops internal and unowned parts", () => {
    const flows = aggregateFlows([part({}), part({ unit: "m3/min", carrier: "pipe" }), part({ to: "a" }), part({ to: "ghost" })], (k) => (k === "ghost" ? undefined : k));
    expect(flows).toHaveLength(2);
  });
  it("empty input", () => expect(aggregateFlows([], cardOf)).toEqual([]));
});

describe("hunt: bubbles and fold", () => {
  it("a treeKey of __proto__ and a product class of constructor are ordinary", () => {
    const n = node({ key: "a", treeKey: "__proto__", products: [{ className: "constructor", name: "x", unit: "items/min", currentPerMinute: 1, maxPerMinute: 2 }] });
    const b = bubblesOf([n, { ...n, key: "b" }]);
    expect(b).toHaveLength(1);
    expect(b[0].products).toEqual([expect.objectContaining({ className: "constructor", currentPerMinute: 2 })]);
  });
  it("folds 8 trees to 5 plus one fold of 3, placed once, empty input ok", () => {
    const nodes = Array.from({ length: 8 }, (_, i) => node({ key: `n${i}`, treeKey: `t${i}`, count: 10 - i }));
    const entries = foldBubbles(bubblesOf(nodes));
    expect(entries.map((e) => e.type)).toEqual(["bubble", "bubble", "bubble", "bubble", "bubble", "fold"]);
    expect(entries[5].type === "fold" && entries[5].bubbles.map((b) => b.ordinal)).toEqual([6, 7, 8]);
    expect(foldBubbles([])).toEqual([]);
  });
  it("exactly 6 trees are not folded", () => {
    const nodes = Array.from({ length: 6 }, (_, i) => node({ key: `n${i}`, treeKey: `t${i}` }));
    expect(foldBubbles(bubblesOf(nodes)).every((e) => e.type === "bubble")).toBe(true);
  });
});

describe("hunt: shareSplit", () => {
  const sh = (f: string, share: number) => ({ factoryKey: f, share });
  it("shares over 1 give rest 0, never negative", () => {
    expect(shareSplit({ factoryKey: "a", shares: [sh("a", 0.7), sh("b", 0.7)] })?.rest).toBe(0);
  });
  it("rest covers a truncated list", () => {
    expect(shareSplit({ factoryKey: "a", shares: [sh("a", 0.5), sh("b", 0.25)] })).toMatchObject({ here: 50, rest: 25 });
  });
});

describe("hunt: text", () => {
  it("distanceText never prints 1000 m", () => {
    expect(distanceText(999.6)).not.toBe("1000 m");
  });
});
