import { describe, expect, it } from "vitest";
import { ProductionGraphResponseSchema, type PlannerNode, type ProductionGraph } from "@satisfactory-dash/shared";
import { productionGraphFactories } from "@satisfactory-dash/shared/fixtures";
import { BUNDLE_NAMES, COLLAPSE_AT, EMPTY_VIEW, bundleFlows, canvasFlow, factoryScene, flowTitle, foldStorage, overviewScene, sceneSummary, siteScene, type FactoryView } from "./canvasScene";
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
    // The card prints the name and one product line; the rest is in its tooltip and keyboard name.
    expect(card.lines).toHaveLength(2);
    expect(card.lines[0]).toBe("Iron Plate factory");
    expect(card.lines[1]).toBe("Iron Plate · 48/min");
    expect(card.count).toBe(9);
    for (const words of ["9 machines", "3 shared groups", "1 flow to storage", "Iron Plate: 48 / 80 items/min"]) expect(card.description).toContain(words);
    expect(scene.cards[1].title).toBe("Iron Rod factory (+ Iron Rod)");
    // The icon is the main machine's: the group with the most machines.
    expect(card.className).toBeDefined();
  });

  it("takes the icon from the group that makes the factory's product, never a bigger consumer it feeds", () => {
    const [first] = models;
    const product = first.factory.products[0].className;
    const maker = first.nodes.find((n) => n.products.some((p) => p.className === product))!;
    // The case on the owner's save: a Solid Biofuel factory whose burners outnumber its constructor.
    const burners: PlannerNode = { ...maker, key: "burners", kind: "consumer", className: "Build_GeneratorBiomass_C", count: maker.count + 40, products: [] };
    const card = overviewScene(FIXTURE, [{ ...first, nodes: [...first.nodes, burners] }, ...models.slice(1)]).cards[0];
    expect(card.className).toBe(maker.className);
    expect(card.glyph).toBe("machines");
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
  it("is a card per group with the train as a flow that carries its mode and route", () => {
    const scene = factoryScene(FIXTURE, plate, view());
    expect(scene.level).toBe("factory");
    expect(scene.cards).toHaveLength(5);
    const train = scene.flows.find((f) => f.carrier === "train")!;
    expect(train.routeName).toBe("Ore Run");
    expect(flowTitle(train, "Miner", "Main Depot")).toBe("Train, route Ore Run: Miner to Main Depot: Iron Ore · about 120 items/min (estimated)");
    expect(scene.noun).toBe("group");
    expect(scene.hasStorage).toBe(true);
  });

  it("says where a remote group stands, and how a shared group splits", () => {
    const scene = factoryScene(FIXTURE, plate, view());
    const miner = scene.cards.find((c) => c.className === "Build_MinerMk2_C")!;
    // Off the card (one line), on in the tooltip and keyboard name, and in the facts the side panel lists.
    expect(miner.lines).toHaveLength(1);
    expect(miner.description).toMatch(/km|m, by train/);
    expect(miner.description).toContain("60% here");
    expect(miner.facts.join(" ")).toContain("60% here");
  });

  it("folds terminal storage into a chip on the group that fills it", () => {
    const off = factoryScene(FIXTURE, plate, view({ storageDetail: false }));
    expect(off.cards).toHaveLength(4);
    const constructor = off.cards.find((c) => c.label.includes("Iron Plate"))!;
    expect(constructor.facts).toContain("1 flow to storage");
    expect(constructor.description).toContain("1 flow to storage");
    expect(off.flows.some((f) => f.itemName === "Iron Plate")).toBe(false);
  });

  it("collapse upstream hides what a card post-dominates and leaves a count on it", () => {
    const open = factoryScene(FIXTURE, plate, view());
    const store = open.cards.find((c) => c.label === "Storage Container")!;
    expect(store.upstream).toEqual({ count: 1, collapsed: false });
    const closed = factoryScene(FIXTURE, plate, view({ collapsed: new Set([store.key]) }));
    expect(closed.cards.some((c) => c.label.includes("Iron Plate"))).toBe(false);
    expect(closed.cards.find((c) => c.key === store.key)!.upstream).toEqual({ count: 1, collapsed: true });
  });

  it("an unknown collapsed key hides nothing", () => {
    expect(factoryScene(FIXTURE, plate, view({ collapsed: new Set(["gone"]) })).cards).toHaveLength(5);
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
    expect(card.count).toBe(6);
    expect(card.lines).toEqual(["X · 3/min"]);
    expect(card.description).toContain("3 groups · tree 1 of 2");
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
    expect(fold.lines).toEqual(["9 more Iron Plate trees"]);
    expect(fold.count).toBeGreaterThan(0);
    expect(fold.description).toContain("Click to show them");
    expect(scene.foldKeys).toEqual([fold.key]);
    expect(scene.cards).toHaveLength(6);
    const opened = sceneOf(big, view({ unfolded: new Set([fold.key]) }));
    expect(opened.cards.some((c) => c.kind === "fold")).toBe(false);
    expect(opened.cards).toHaveLength(14);
  });
});

describe("collapse upstream on generated chains", () => {
  const chain = [
    node("m", { collapseUnder: "a" }),
    node("a", { collapseUnder: "b" }),
    node("b", { collapseUnder: null }),
    node("side", { collapseUnder: "b" }),
  ];
  const g = graphOf(chain, [belt("m", "a"), belt("a", "b"), belt("side", "b")]);

  it("hides everything a card post-dominates, transitively", () => {
    const scene = sceneOf(g, view({ collapsed: new Set(["b"]) }));
    expect(scene.cards.map((c) => c.key)).toEqual(["b"]);
    expect(scene.cards[0].upstream).toEqual({ count: 3, collapsed: true });
    expect(scene.flows).toEqual([]);
  });

  it("hides only its own subtree", () => {
    const scene = sceneOf(g, view({ collapsed: new Set(["a"]) }));
    expect(scene.cards.map((c) => c.key).sort()).toEqual(["a", "b", "side"]);
    expect(scene.flows.map((f) => `${f.from}>${f.to}`).sort()).toEqual(["a>b", "side>b"]);
  });

  it("survives a post-dominator cycle and a dangling key", () => {
    const odd = graphOf([node("x", { collapseUnder: "y" }), node("y", { collapseUnder: "x" }), node("z", { collapseUnder: "nowhere" })]);
    expect(() => sceneOf(odd, view({ collapsed: new Set(["x", "y", "z"]) }))).not.toThrow();
  });

  it("a card hidden by a folded storage hangs under the storage's own post-dominator", () => {
    const withStore = graphOf(
      [
        node("p", { collapseUnder: "s" }),
        node("s", { kind: "storage", role: "buffer", recipe: null, className: "Build_StorageContainerMk1_C", name: "Storage Container", collapseUnder: "q" }),
        node("q", { collapseUnder: null }),
      ],
      [belt("p", "s"), belt("s", "q")],
    );
    const scene = sceneOf(withStore, view({ storageDetail: false, collapsed: new Set(["q"]) }));
    expect(scene.cards.map((c) => c.key)).toEqual(["q"]);
  });
});

describe("foldStorage", () => {
  const store = (key: string, role: string) => node(key, { kind: "storage", role, recipe: null, className: "Build_StorageContainerMk1_C", name: "Storage Container" });
  const nodes = [node("a"), node("b"), node("c"), store("buf", "buffer"), store("end", "storage"), store("buf2", "buffer")];

  it("joins a buffer's belts, keeps the item and the carrier of the transport side", () => {
    const parts = [belt("a", "buf"), belt("buf", "b", { itemClassName: "Desc_X_C", ratePerMinute: 30 })];
    const { parts: out, removed } = foldStorage(nodes, parts);
    expect(removed.has("buf")).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ from: "a", to: "b", ratePerMinute: 30, rate: "measured" });
    const train = foldStorage(nodes, [belt("a", "buf", { carrier: "train", routeName: "Run" }), belt("buf", "b")]).parts[0];
    expect(train).toMatchObject({ carrier: "train", routeName: "Run" });
  });

  it("splits a buffer's output between several sources and calls the shares estimates", () => {
    const { parts } = foldStorage(nodes, [belt("a", "buf"), belt("c", "buf"), belt("buf", "b", { ratePerMinute: 60 })]);
    expect(parts.map((p) => [p.from, p.ratePerMinute, p.rate])).toEqual([
      ["a", 30, "estimated"],
      ["c", 30, "estimated"],
    ]);
  });

  it("joins a chain of buffers one by one, and turns terminal storage into a count", () => {
    const { parts, removed, chips } = foldStorage(nodes, [belt("a", "buf"), belt("buf", "buf2"), belt("buf2", "b"), belt("b", "end")]);
    expect([...removed].sort()).toEqual(["buf", "buf2", "end"]);
    expect(parts.map((p) => `${p.from}>${p.to}`)).toEqual(["a>b"]);
    expect(chips.get("b")).toBe(1);
  });

  it("leaves a buffer nothing feeds, drops a self-loop and ignores a station", () => {
    const station = node("st", { kind: "station", role: "buffer", recipe: null, className: "Build_TrainStation_C", name: "Station" });
    const { parts, removed } = foldStorage([...nodes, station], [belt("buf", "b"), belt("buf", "buf"), belt("a", "st"), belt("st", "b")]);
    expect(removed.has("buf")).toBe(false);
    expect(removed.has("st")).toBe(false);
    expect(parts.some((p) => p.from === p.to)).toBe(false);
  });

  it("does not change the parts when there is nothing to fold", () => {
    const parts = [belt("a", "b")];
    expect(foldStorage([node("a"), node("b")], parts)).toEqual({ parts, removed: new Set(), chips: new Map() });
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
    const scene = sceneOf(g, view({ storageDetail: false }));
    expect(scene.cards).toHaveLength(3);
    expect(scene.flows).toHaveLength(1);
  });
});

describe("bundleFlows: one line per pair of cards and carrier (2026-10-27)", () => {
  const link = (itemName: string | null, extra: Partial<AggregateFlow> = {}) =>
    canvasFlow({ from: "a", to: "b", itemClassName: itemName === null ? null : `Desc_${itemName}_C`, itemName, carrier: "belt", flow: "supply", unit: "items/min", mixed: false, parts: 1, ratePerMinute: 30, quality: "measured", ...extra });

  it("leaves a lone link as it is", () => {
    const one = link("Iron");
    expect(bundleFlows([one])).toEqual([{ flow: one, members: [0] }]);
  });

  it("names the known items, folds links of no known item into '+n unknown', and sums the rate as 'at least' when one has none", () => {
    const [b] = bundleFlows([link(null, { quality: "unknown", ratePerMinute: null }), link("Iron Ingot"), link("Steel Pipe", { ratePerMinute: 12.5 })]);
    expect(b.members).toEqual([0, 1, 2]);
    expect(b.flow.labelLines).toEqual(["Iron Ingot, Steel Pipe", "+1 unknown", "at least 42.5 items/min"]);
    expect(b.flow.quality).toBe("atLeast");
    expect(b.flow.rate).toBe("estimated");
    expect(b.flow.parts).toHaveLength(3);
  });

  it("sums measured links as measured, and an estimated one makes it 'about'", () => {
    expect(bundleFlows([link("A"), link("B", { ratePerMinute: 10 })])[0].flow.labelLines).toEqual(["A, B", "40 items/min"]);
    const about = bundleFlows([link("A"), link("B", { quality: "estimated" })])[0].flow;
    expect(about.labelLines[1]).toBe("about 60 items/min");
    expect(about.rate).toBe("estimated");
  });

  it("names at most BUNDLE_NAMES items, the rest '+k more', and with no rate at all prints none", () => {
    const flows = ["A", "B", "C", "D"].map((n) => link(n, { quality: "unknown", ratePerMinute: null }));
    const [b] = bundleFlows([...flows, link(null, { quality: "unknown", ratePerMinute: null })]);
    expect(BUNDLE_NAMES).toBe(2);
    expect(b.flow.labelLines).toEqual(["A, B", "+2 more, +1 unknown"]);
    expect(b.flow.rate).toBe("unknown");
  });

  it("words links of no known item alone as a count, and a mixed one as mixed", () => {
    const site = [link("A"), link("B", { mixed: true })];
    expect(bundleFlows(site)[0].flow.labelLines).toEqual(["A, B", "mixed", "60 items/min"]);
    expect(bundleFlows([link(null), link(null)])[0].flow.labelLines[0]).toBe("2 items unknown");
  });

  it("keeps other carriers, kinds and directions apart, in first-seen order", () => {
    const out = bundleFlows([link("A"), link("W", { carrier: "pipe", unit: "m3/min" }), link("B"), link("X", { flow: "excess" }), link("C", { from: "b", to: "a" })]);
    expect(out.map((b) => b.members)).toEqual([[0, 2], [1], [3], [4]]);
  });

  it("never sums items and m3 on one carrier into one rate", () => {
    const out = bundleFlows([link("Ore", { carrier: "train" }), link("Water", { carrier: "train", unit: "m3/min" }), link("Coal", { carrier: "train" })]);
    expect(out.map((b) => b.members)).toEqual([[0, 2], [1]]);
    expect(out[0].flow.labelLines).toEqual(["Ore, Coal", "60 items/min"]);
  });

  it("treats an empty item name as no known item", () => {
    const [b] = bundleFlows([link("A"), { ...link(null), itemName: "", itemClassName: "" }]);
    expect(b.flow.labelLines[0]).toBe("A");
    expect(b.flow.labelLines[1]).toContain("+1 unknown");
  });

  it("keeps every link in the tooltip, each with its own rate and sureness", () => {
    const [b] = bundleFlows([link("Iron Ingot"), link(null, { quality: "unknown", ratePerMinute: null })]);
    expect(flowTitle(b.flow, "A", "B")).toBe("A to B, 2 links: Iron Ingot · 30 items/min (measured); Item unknown (rate unknown)");
    const trains = bundleFlows([link("Ore", { carrier: "train", routeName: "North" }), link("Coal", { carrier: "train", routeName: "South" })])[0].flow;
    expect(flowTitle(trains, "A", "B")).toBe("Train: A to B, 2 links: route North, Ore · 30 items/min (measured); route South, Coal · 30 items/min (measured)");
  });
});
