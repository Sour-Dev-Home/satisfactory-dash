import { describe, expect, it } from "vitest";
import { ProductionGraphResponseSchema, type PlannerNode, type ProductionGraph } from "@satisfactory-dash/shared";
import { productionGraphFactories } from "@satisfactory-dash/shared/fixtures";
import { COLLAPSE_AT, EMPTY_VIEW, canvasFlow, factoryScene, flowTitle, overviewScene, sceneSummary, siteScene, type FactoryView } from "./canvasScene";
import { factoryModels, type AggregateFlow, type FlowPart } from "./hierarchy";

const FIXTURE: ProductionGraph = ProductionGraphResponseSchema.parse(productionGraphFactories).data;
const models = factoryModels(FIXTURE);
const plate = models[0];
const rod = models[1];

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

const belt = (from: string, to: string, extra: Partial<FlowPart> = {}): FlowPart => ({
  from,
  to,
  itemClassName: "Desc_X_C",
  itemName: "X",
  ratePerMinute: 60,
  rate: "measured",
  mixed: false,
  carrier: "belt",
  flow: "supply",
  unit: "items/min",
  ...extra,
});

/** A one-factory graph over `nodes` joined by `parts` (only the belts: transports go in `transports`). */
function graphOf(nodes: PlannerNode[], parts: FlowPart[] = []): ProductionGraph {
  const edges = parts
    .filter((p) => p.carrier === "belt")
    .map((p) => ({ from: p.from, to: p.to, kind: "belt" as const, itemClassName: p.itemClassName, itemName: p.itemName, ratePerMinute: p.ratePerMinute, rate: p.rate, mixed: p.mixed, capacityPerMinute: null, conveyorCount: 1, flow: p.flow }));
  const site = { key: "s", name: "Site", at: { x: 0, y: 0 }, machineCount: nodes.length, stateCounts: {}, topOutputs: [], nodeKeys: nodes.map((n) => n.key) };
  return {
    nodes,
    edges,
    sites: [site],
    unconnectedMachineIds: [],
    beltData: "present",
    connectionsRefreshMinutes: 10,
    notes: [],
    factories: [{ key: "f", name: "F factory", designationId: null, products: [], sideProducts: [], nodeKeys: nodes.map((n) => n.key), siteKeys: ["s"], machineCount: nodes.length, sharedNodeCount: 0 }],
    transports: [],
    topologyHash: "h",
  };
}
const sceneOf = (g: ProductionGraph, v: FactoryView = view()) => factoryScene(g, factoryModels(g)[0], v);

describe("the destination of a supply is a factory (what the backend sends)", () => {
  it("the shared fixture ends supply flows in 'factory', never 'machine'", () => {
    for (const e of [...FIXTURE.edges, ...(FIXTURE.transports ?? [])]) if (e.flow === "supply") expect(e.destination).toBe("factory");
  });
});

describe("overviewScene", () => {
  const scene = overviewScene(FIXTURE, models);

  it("is a card per factory, with where it stands, its machines, products and where its flows end", () => {
    expect(scene.level).toBe("overview");
    expect(scene.cards.map((c) => c.kind)).toEqual(["factory", "factory"]);
    const card = scene.cards[0];
    expect(card.title).toBe("Iron Plate factory");
    expect(card.lines).toContain("9 machines");
    expect(card.lines).toContain("3 shared groups");
    expect(card.lines.some((l) => l.startsWith("Iron Plate: 48"))).toBe(true);
    expect(card.lines).toContain("1 flow to storage");
    expect(scene.cards[1].title).toBe("Iron Rod factory (+ Iron Rod)");
    expect(card.mutedLines).toBeGreaterThan(0);
  });

  it("draws the flows between factories, transport carriers kept, and none inside one", () => {
    const keys = new Set(scene.cards.map((c) => c.key));
    for (const f of scene.flows) {
      expect(keys.has(f.from) && keys.has(f.to)).toBe(true);
      expect(f.from).not.toBe(f.to);
    }
    expect(scene.flows.map((f) => f.carrier)).toEqual(["belt"]);
    expect(sceneSummary(scene, 0)).toBe("Graph of Factories: 2 factories, 1 connection. The Tables view lists the same.");
  });
});

describe("factoryScene on the fixture", () => {
  it("is a card per group with the train as a flow that carries its mode", () => {
    const scene = factoryScene(FIXTURE, plate, view());
    expect(scene.level).toBe("factory");
    expect(scene.cards).toHaveLength(5);
    const train = scene.flows.find((f) => f.carrier === "train")!;
    expect(flowTitle(train, "Miner", "Main Depot")).toBe("Train: Miner to Main Depot: Iron Ore · about 120 items/min (estimated)");
    expect(scene.noun).toBe("group");
  });

  it("says where a remote group stands, and how a shared group splits", () => {
    const scene = factoryScene(FIXTURE, plate, view());
    const miner = scene.cards.find((c) => c.className === "Build_MinerMk2_C")!;
    expect(miner.lines.join(" ")).toMatch(/km|m, by train/);
    expect(miner.lines.join(" ")).toContain("60% here");
  });

  it("a factory of two groups and one flow", () => {
    const scene = factoryScene(FIXTURE, rod, view());
    expect(scene.cards).toHaveLength(2);
    expect(scene.flows).toHaveLength(1);
    expect(scene.flows[0].labelLines).toEqual(["Iron Rod", "about 6 items/min", "excess"]);
  });
});

describe("bubbles and folds", () => {
  // Two trees of three plate groups each, and a lone screw group.
  const trees = [
    ...["a1", "a2", "a3"].map((k) => node(k, { treeKey: "tree|a", recipe: "Iron Plate", count: 2 })),
    ...["b1", "b2"].map((k) => node(k, { treeKey: "tree|b", recipe: "Iron Plate" })),
    node("screw", { recipe: "Screw" }),
  ];
  const g = graphOf(trees, [belt("a1", "screw"), belt("a2", "screw"), belt("b1", "screw")]);

  it("opens a small factory into frames, and one group of a tree is just its card", () => {
    const scene = sceneOf(g);
    expect(scene.frames.map((f) => f.bubbleKey)).toEqual(["tree|a", "tree|b"]);
    expect(scene.cards.map((c) => c.frame)).toEqual(["frame|tree|a", "frame|tree|a", "frame|tree|a", "frame|tree|b", "frame|tree|b", undefined]);
    expect(scene.bubbleKeys).toEqual(["tree|a", "tree|b"]);
    expect(scene.openByDefault).toBe(true);
    expect(scene.frames[0].title).toBe("6× Constructor, Iron Plate, tree 1 of 2");
  });

  it("flipping a bubble collapses it to one card and sums its flows", () => {
    const scene = sceneOf(g, view({ flipped: new Set(["tree|a"]) }));
    const card = scene.cards.find((c) => c.key === "tree|a")!;
    expect(card.kind).toBe("bubble");
    expect(card.title).toBe("6× Constructor");
    expect(card.lines).toContain("3 groups · tree 1 of 2");
    expect(card.nodeKeys).toEqual(["a1", "a2", "a3"]);
    const into = scene.flows.find((f) => f.from === "tree|a" && f.to === "screw")!;
    expect(into.labelLines[1]).toBe("120 items/min");
    expect(scene.frames.map((f) => f.bubbleKey)).toEqual(["tree|b"]);
    expect(scene.noun).toBe("card");
  });

  it("a factory over the threshold starts collapsed, and flipping opens a bubble", () => {
    const many = Array.from({ length: COLLAPSE_AT + 1 }, (_, i) => node(`n${i}`, { treeKey: `tree|${i % 3}`, recipe: `R${i % 3}` }));
    const big = graphOf(many);
    const closed = sceneOf(big);
    expect(closed.openByDefault).toBe(false);
    expect(closed.frames).toEqual([]);
    expect(closed.cards.map((c) => c.kind)).toEqual(["bubble", "bubble", "bubble"]);
    const opened = sceneOf(big, view({ flipped: new Set(["tree|0"]) }));
    expect(opened.frames.map((f) => f.bubbleKey)).toEqual(["tree|0"]);
  });

  it("folds the trees beyond the cap into one card that opens into them", () => {
    const many = Array.from({ length: 14 }, (_, i) => node(`p${i}`, { treeKey: `tree|${i}`, recipe: "Iron Plate", count: 14 - i }));
    const big = graphOf(many);
    const scene = sceneOf(big);
    const fold = scene.cards.find((c) => c.kind === "fold")!;
    expect(fold.title).toBe("9 more Iron Plate trees");
    expect(scene.foldKeys).toEqual([fold.key]);
    expect(scene.cards).toHaveLength(6);
    const opened = sceneOf(big, view({ unfolded: new Set([fold.key]) }));
    expect(opened.cards.some((c) => c.kind === "fold")).toBe(false);
    expect(opened.cards).toHaveLength(14);
  });
});

describe("flows as the canvas words them", () => {
  const flow = (extra: Partial<AggregateFlow> = {}): AggregateFlow => ({
    from: "a",
    to: "b",
    itemClassName: "Desc_X_C",
    itemName: "X",
    carrier: "belt",
    flow: "supply",
    unit: "items/min",
    mixed: false,
    parts: 1,
    ratePerMinute: 100,
    quality: "measured",
    ...extra,
  });

  it("words measured, about, at least and unknown, and marks a mixed belt", () => {
    expect(canvasFlow(flow()).labelLines).toEqual(["X", "100 items/min"]);
    expect(canvasFlow(flow({ quality: "estimated" })).labelLines[1]).toBe("about 100 items/min");
    expect(canvasFlow(flow({ quality: "atLeast", parts: 2 })).labelLines[1]).toBe("at least 100 items/min");
    expect(canvasFlow(flow({ quality: "unknown", ratePerMinute: null })).labelLines).toEqual(["X"]);
    expect(canvasFlow(flow({ mixed: true })).labelLines[0]).toBe("X · mixed");
    expect(canvasFlow(flow({ itemName: null, itemClassName: null })).labelLines[0]).toBe("Item unknown");
  });

  it("draws an estimate and an 'at least' dashed, unknown dotted, measured solid", () => {
    expect(canvasFlow(flow()).rate).toBe("measured");
    expect(canvasFlow(flow({ quality: "atLeast" })).rate).toBe("estimated");
    expect(canvasFlow(flow({ quality: "unknown" })).rate).toBe("unknown");
  });

  it("names a carrier the build does not know with the backend's own word", () => {
    expect(flowTitle(canvasFlow(flow({ carrier: "hyperloop" })), "A", "B")).toBe("hyperloop: A to B: X · 100 items/min (measured)");
  });
});

describe("siteScene", () => {
  it("is the site canvas as before: a card per group and a line per connection", () => {
    const g = graphOf([node("a"), node("b")], [belt("a", "b"), belt("a", "elsewhere")]);
    const scene = siteScene(g.sites[0], g);
    expect(scene.cards.map((c) => c.key)).toEqual(["a", "b"]);
    expect(scene.flows).toHaveLength(1);
    expect(sceneSummary(scene, 0)).toBe("Graph of Site: 2 groups, 1 connection. The Tables view lists the same.");
  });
});

describe("a key taken from the game is only ever a key", () => {
  it("handles prototype-ish names in keys, roles and carriers", () => {
    const g = graphOf([node("__proto__"), node("constructor", { role: "toString" }), node("hasOwnProperty")], [belt("__proto__", "constructor")]);
    const scene = sceneOf(g, view());
    expect(scene.cards).toHaveLength(3);
    expect(scene.flows).toHaveLength(1);
  });
});
