import { describe, expect, it } from "vitest";
import type { PlannerNode, ProductionGraph } from "@satisfactory-dash/shared";
import { COLLAPSE_AT, EMPTY_VIEW, canvasFlow, factoryScene, flowTitle, overviewScene, sceneSummary, type FactoryView } from "./canvasScene";
import { FOLD_AT, factoryModels, type AggregateFlow } from "./hierarchy";

const rate = { className: "Desc_X_C", name: "X", unit: "items/min" as const, currentPerMinute: 1, maxPerMinute: 2 };
const view = (extra: Partial<FactoryView> = {}): FactoryView => ({ ...EMPTY_VIEW, ...extra });

function node(key: string, extra: Partial<PlannerNode> = {}): PlannerNode {
  return {
    key,
    kind: "machines",
    className: "Build_ConstructorMk1_C",
    name: "Constructor",
    recipe: "Iron Plate",
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
type E = { from: string; to: string; rate?: "measured" | "estimated" | "unknown"; ratePerMinute?: number | null };
function graphOf(nodes: PlannerNode[], edges: E[] = [], nodeKeys: string[] = nodes.map((n) => n.key)): ProductionGraph {
  const site = { key: "s", name: "Site", at: { x: 0, y: 0 }, machineCount: nodes.length, stateCounts: {}, topOutputs: [], nodeKeys: nodes.map((n) => n.key) };
  return {
    nodes,
    edges: edges.map((e) => ({ from: e.from, to: e.to, kind: "belt" as const, itemClassName: "Desc_X_C", itemName: "X", ratePerMinute: e.ratePerMinute === undefined ? 60 : e.ratePerMinute, rate: e.rate ?? "measured", mixed: false, capacityPerMinute: null, conveyorCount: 1, flow: "supply" })),
    sites: [site],
    unconnectedMachineIds: [],
    beltData: "present",
    connectionsRefreshMinutes: 10,
    notes: [],
    factories: [{ key: "f", name: "F factory", designationId: null, products: [], sideProducts: [], nodeKeys, siteKeys: ["s"], machineCount: nodes.length, sharedNodeCount: 0 }],
    transports: [],
    topologyHash: "h",
  } as ProductionGraph;
}
const sceneOf = (g: ProductionGraph, v: FactoryView = view()) => factoryScene(g, factoryModels(g)[0], v);
const uniqueKeys = (s: { cards: { key: string }[] }) => new Set(s.cards.map((c) => c.key)).size === s.cards.length;

/** `trees` trees of one recipe, each of two groups, so each is a real bubble; tree i has count i+1 per group. */
const treesOf = (trees: number) => Array.from({ length: trees }, (_, i) => [0, 1].map((j) => node(`t${i}g${j}`, { treeKey: `tree|${i}`, count: trees - i }))).flat();

describe("factoryScene edge cases", () => {
  it("an empty factory is an empty scene with a sane summary", () => {
    const s = sceneOf(graphOf([]));
    expect(s).toMatchObject({ cards: [], frames: [], flows: [], bubbleKeys: [], foldKeys: [] });
    expect(sceneSummary(s, 0)).toContain("0 groups, 0 connections");
  });

  it("a factory naming only nodes that do not exist is empty, not a crash", () => {
    const s = sceneOf(graphOf([node("a")], [], ["ghost"]));
    expect(s.cards).toEqual([]);
  });

  it("a node key listed twice in the factory is one card", () => {
    const s = sceneOf(graphOf([node("a"), node("b")], [{ from: "a", to: "b" }], ["a", "a", "b", "b"]));
    expect(s.cards.map((c) => c.key)).toEqual(["a", "b"]);
    expect(s.flows).toHaveLength(1);
  });

  it("prototype-ish tree keys and node keys give unique cards and working flips", () => {
    const names = ["__proto__", "constructor", "toString"];
    const nodes = names.flatMap((n) => [node(`${n}-1`, { treeKey: n }), node(`${n}-2`, { treeKey: n })]);
    const g = graphOf(nodes, [{ from: "__proto__-1", to: "constructor-1" }]);
    const open = sceneOf(g);
    expect(open.frames.map((f) => f.bubbleKey).sort()).toEqual([...names].sort());
    expect(uniqueKeys(open)).toBe(true);
    const flipped = sceneOf(g, view({ flipped: new Set(["__proto__"]) }));
    expect(flipped.cards.filter((c) => c.kind === "bubble").map((c) => c.key)).toEqual(["__proto__"]);
    expect(flipped.flows).toHaveLength(1);
    expect(flipped.flows[0]).toMatchObject({ from: "__proto__", to: "constructor-1" });
  });

  it("a node keyed __proto__ lays out as a card with its flow", () => {
    const g = graphOf([node("__proto__"), node("constructor", { recipe: "R2" })], [{ from: "__proto__", to: "constructor" }]);
    const s = sceneOf(g);
    expect(s.cards.map((c) => c.key)).toEqual(["__proto__", "constructor"]);
    expect(s.flows).toHaveLength(1);
  });

  it("without treeKey the fallback groups by site and recipe, one bubble per recipe", () => {
    const g = graphOf([node("a"), node("b"), node("c", { recipe: "Other" })]);
    const s = sceneOf(g);
    expect(s.bubbleKeys).toHaveLength(1);
    expect(s.bubbleKeys[0]).toMatch(/^bubble\|s\|/);
    expect(s.frames).toHaveLength(1);
    expect(s.cards.map((c) => c.key)).toEqual(["a", "b", "c"]);
  });

  it("fallback keys differ across sites, so equal recipes at two sites are two bubbles", () => {
    const g = graphOf([node("a"), node("b"), node("c", { siteKey: "t" }), node("d", { siteKey: "t" })]);
    expect(sceneOf(g).bubbleKeys).toHaveLength(2);
  });

  it("a bubble of one group is just that group's card, not a bubble key", () => {
    const s = sceneOf(graphOf([node("a", { treeKey: "tree|1" })]));
    expect(s.bubbleKeys).toEqual([]);
    expect(s.cards[0]).toMatchObject({ kind: "group", key: "a", bubbleKey: undefined, frame: undefined });
    // flipping a lone group's tree key changes nothing
    expect(sceneOf(graphOf([node("a", { treeKey: "tree|1" })]), view({ flipped: new Set(["tree|1"]) })).cards).toEqual(s.cards);
  });

  it("stale flipped and unfolded keys are ignored", () => {
    const g = graphOf(treesOf(3));
    const base = sceneOf(g);
    const stale = sceneOf(g, view({ flipped: new Set(["gone", "fold|gone", "t0g0"]), unfolded: new Set(["gone", "tree|0"]) }));
    expect(stale).toEqual(base);
  });

  it("COLLAPSE_AT groups open, one more starts collapsed", () => {
    const mk = (n: number) => graphOf(Array.from({ length: n }, (_, i) => node(`n${i}`, { treeKey: `tree|${i % 2}` })));
    expect(sceneOf(mk(COLLAPSE_AT)).openByDefault).toBe(true);
    expect(sceneOf(mk(COLLAPSE_AT)).frames).toHaveLength(2);
    const big = sceneOf(mk(COLLAPSE_AT + 1));
    expect(big.openByDefault).toBe(false);
    expect(big.frames).toHaveLength(0);
    expect(big.cards.every((c) => c.kind === "bubble")).toBe(true);
  });

  it("FOLD_AT trees do not fold, FOLD_AT+1 do (5 kept, 2 folded)", () => {
    const six = sceneOf(graphOf(treesOf(FOLD_AT)));
    expect(six.foldKeys).toEqual([]);
    expect(six.bubbleKeys).toHaveLength(FOLD_AT);
    const seven = sceneOf(graphOf(treesOf(FOLD_AT + 1)));
    expect(seven.foldKeys).toHaveLength(1);
    expect(seven.bubbleKeys).toHaveLength(FOLD_AT - 1);
    const fold = seven.cards.find((c) => c.kind === "fold")!;
    expect(fold.nodeKeys).toHaveLength(4);
    expect(uniqueKeys(seven)).toBe(true);
  });

  it("unfolding shows the folded trees as bubbles and drops the fold card", () => {
    const g = graphOf(treesOf(FOLD_AT + 3));
    const folded = sceneOf(g);
    const open = sceneOf(g, view({ unfolded: new Set(folded.foldKeys) }));
    expect(open.cards.some((c) => c.kind === "fold")).toBe(false);
    expect(open.cards.flatMap((c) => c.nodeKeys).sort()).toEqual(g.nodes.map((n) => n.key).sort());
    expect(uniqueKeys(open)).toBe(true);
  });

  it("every node is on exactly one card, in every view", () => {
    const g = graphOf(treesOf(FOLD_AT + 2));
    for (const v of [view(), view({ flipped: new Set(["tree|0", "tree|1"]) }), view({ unfolded: new Set([`fold|${"x"}`]) })]) {
      const s = sceneOf(g, v);
      const all = s.cards.flatMap((c) => c.nodeKeys).sort();
      expect(all).toEqual(g.nodes.map((n) => n.key).sort());
    }
  });

  it("flows to a folded node land on the fold card and every flow end is a card", () => {
    const g = graphOf(treesOf(FOLD_AT + 2), [
      { from: "t0g0", to: "t0g1" },
      { from: "t0g1", to: `t${FOLD_AT + 1}g0` },
      { from: `t${FOLD_AT}g0`, to: `t${FOLD_AT + 1}g0` },
    ]);
    const s = sceneOf(g);
    const keys = new Set(s.cards.map((c) => c.key));
    for (const f of s.flows) {
      expect(keys.has(f.from)).toBe(true);
      expect(keys.has(f.to)).toBe(true);
      expect(f.from).not.toBe(f.to);
    }
    // t0g0 -> t0g1 and the flow inside the fold are internal when both ends share a card
    expect(s.flows.some((f) => f.to.startsWith("fold|"))).toBe(true);
  });

  it("collapsing a bubble drops its internal flow and sums flows out of it", () => {
    const g = graphOf([...treesOf(2), node("z", { recipe: "Z" })], [{ from: "t0g0", to: "t0g1" }, { from: "t0g0", to: "z" }, { from: "t0g1", to: "z", ratePerMinute: 30 }]);
    const s = sceneOf(g, view({ flipped: new Set(["tree|0"]) }));
    expect(s.flows).toHaveLength(1);
    expect(s.flows[0]).toMatchObject({ from: "tree|0", to: "z" });
    expect(s.flows[0].label).toContain("90");
  });

  it("an edge from a node to itself does not produce a flow whose ends are one card", () => {
    const s = sceneOf(graphOf([node("a"), node("b", { recipe: "B" })], [{ from: "a", to: "a" }, { from: "a", to: "b" }]));
    expect(s.flows.filter((f) => f.from === f.to)).toEqual([]);
  });

  it("an edge to a node outside the factory is left out", () => {
    const g = graphOf([node("a"), node("b", { recipe: "B" }), node("out", { recipe: "O" })], [{ from: "a", to: "out" }, { from: "a", to: "b" }], ["a", "b"]);
    expect(sceneOf(g).flows).toHaveLength(1);
  });

  // Known gap (backend keys are not expected to collide): a collapsed bubble card keyed by treeKey can share a key with a group card.
  it.fails("a treeKey equal to another node's key keeps card keys unique", () => {
    const g = graphOf([node("a", { treeKey: "b" }), node("a2", { treeKey: "b" }), node("b", { recipe: "B" })]);
    const s = sceneOf(g, view({ flipped: new Set(["b"]) }));
    expect(uniqueKeys(s)).toBe(true);
  });

  it("a node count of 0, negative or NaN still gives finite words", () => {
    const g = graphOf([node("a", { count: Number.NaN, treeKey: "t" }), node("b", { count: -3, treeKey: "t" })]);
    const s = sceneOf(g, view({ flipped: new Set(["t"]) }));
    expect(s.cards).toHaveLength(1);
    expect(s.cards[0].lines.join(" ")).not.toContain("NaN");
    expect(s.cards[0].title).not.toContain("NaN");
    // The "×N" badge only prints a finite count.
    expect(s.cards[0].count === undefined || Number.isFinite(s.cards[0].count)).toBe(true);
  });

  it("huge counts do not break the words", () => {
    const g = graphOf([node("a", { count: 1e9, treeKey: "t" }), node("b", { count: 1e9, treeKey: "t" })]);
    const s = sceneOf(g, view({ flipped: new Set(["t"]) }));
    expect(s.cards[0].title).toContain("2");
  });

  it("unique frame keys never collide with card keys", () => {
    const s = sceneOf(graphOf(treesOf(3)));
    const cards = new Set(s.cards.map((c) => c.key));
    for (const f of s.frames) {
      expect(cards.has(f.key)).toBe(false);
      for (const k of f.cardKeys) expect(cards.has(k)).toBe(true);
    }
  });
});

describe("overviewScene edge cases", () => {
  it("no factories: no cards, no flows, a sane summary", () => {
    const g = graphOf([node("a")]);
    const s = overviewScene(g, []);
    expect(s.cards).toEqual([]);
    expect(sceneSummary(s, 0)).toMatch(/^Graph of Factories: 0 factories, 0 connections\./);
  });

  it("one factory says 'factory' and has no flows", () => {
    const g = graphOf([node("a")]);
    const s = overviewScene(g, factoryModels(g));
    expect(s.noun).toBe("factory");
    expect(sceneSummary(s, 2)).toContain("1 factory, 0 connections, 2 in a loop");
  });

  it("a destinationChip count of zero or huge is still worded", () => {
    const g = graphOf([node("a")]);
    const [m] = factoryModels(g);
    const s = overviewScene(g, [{ ...m, destinations: [{ destination: "__proto__", count: 1 }, { destination: "constructor", count: 0 }, { destination: "storage", count: 1e9 }, { destination: "toString", count: 2 }, { destination: "sink", count: 2 }] }]);
    // The card is name plus one line; every end is in the tooltip and keyboard name.
    expect(s.cards[0].lines).toHaveLength(2);
    const words = s.cards[0].description;
    expect(words).toContain("1 flow to __proto__");
    expect(words).toContain("0 flows to constructor");
    expect(words).toContain("2 flows to the Sink");
    expect(words).not.toContain("function");
  });
});

describe("canvasFlow / flowTitle odd rates", () => {
  const agg = (extra: Partial<AggregateFlow>): AggregateFlow => ({ from: "a", to: "b", itemClassName: "C", itemName: "Iron", carrier: "belt", flow: "supply", unit: "items/min", mixed: false, parts: 1, ratePerMinute: 60, quality: "measured", ...extra });

  it("an unknown quality hides the rate whatever the number", () => {
    const f = canvasFlow(agg({ quality: "unknown", ratePerMinute: 99 }));
    expect(f.rate).toBe("unknown");
    expect(f.label).not.toContain("99");
  });

  it("a null rate on a measured flow is worded without a number", () => {
    const f = canvasFlow(agg({ ratePerMinute: null }));
    expect(f.labelLines).toEqual(["Iron"]);
  });

  // Known gap, unreachable from JSON (no NaN on the wire): formatPerMinute prints NaN.
  it.fails("NaN and negative rates never print NaN", () => {
    expect(canvasFlow(agg({ ratePerMinute: Number.NaN })).label).not.toContain("NaN");
    expect(canvasFlow(agg({ ratePerMinute: -5 })).label).not.toContain("--");
  });

  it("atLeast counts as estimated; label and labelLines agree on the item", () => {
    const f = canvasFlow(agg({ quality: "atLeast" }));
    expect(f.rate).toBe("estimated");
    expect(f.labelLines[0]).toBe("Iron");
    expect(f.label.startsWith("Iron")).toBe(true);
  });

  it("no item name falls back to the class, then to 'Item unknown'", () => {
    expect(canvasFlow(agg({ itemName: null })).labelLines[0]).toBe("C");
    expect(canvasFlow(agg({ itemName: null, itemClassName: null })).labelLines[0]).toBe("Item unknown");
  });

  it("an excess mixed flow carries both words, in label and lines", () => {
    const f = canvasFlow(agg({ flow: "excess", mixed: true }));
    expect(f.label).toContain("mixed");
    expect(f.label).toContain("excess");
    expect(f.labelLines).toContain("excess");
    expect(f.labelLines[0]).toContain("mixed");
  });

  it("flowTitle for a prototype-ish carrier does not print a function", () => {
    const t = flowTitle(canvasFlow(agg({ carrier: "constructor" })), "A", "B");
    expect(t).toContain("A to B");
    expect(t).not.toContain("function");
  });

  it("flowTitle for belts has no carrier prefix", () => {
    expect(flowTitle(canvasFlow(agg({})), "A", "B").startsWith("A to B")).toBe(true);
  });
});

describe("sceneSummary", () => {
  it("singular and plural nouns and connections", () => {
    const g = graphOf([node("a"), node("b", { recipe: "B" })], [{ from: "a", to: "b" }]);
    const s = sceneOf(g);
    expect(sceneSummary(s, 0)).toContain("2 groups, 1 connection.");
    expect(sceneSummary({ ...s, cards: s.cards.slice(0, 1) }, 0)).toContain("1 group,");
  });

  it("a mixed scene says cards", () => {
    const s = sceneOf(graphOf(treesOf(3)));
    expect(s.noun).toBe("group");
    const c = sceneOf(graphOf(treesOf(3)), view({ flipped: new Set(["tree|0"]) }));
    expect(c.noun).toBe("card");
    expect(sceneSummary(c, 0)).toContain("cards");
  });
});
