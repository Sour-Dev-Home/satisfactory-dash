import { describe, expect, it } from "vitest";
import { ProductionGraphResponseSchema, type PlannerNode, type ProductionGraph } from "@satisfactory-dash/shared";
import { productionGraphFactories, productionGraphTwoSites } from "@satisfactory-dash/shared/fixtures";
import {
  aggregateFlows,
  bubblesOf,
  connectionRows,
  factoryAsSite,
  factoryModels,
  factoryOfNode,
  flowParts,
  foldBubbles,
  hasFactories,
  remoteInfo,
  shareSplit,
  unassignedCount,
  type FlowPart,
} from "./hierarchy";

const FACTORY_GRAPH: ProductionGraph = ProductionGraphResponseSchema.parse(productionGraphFactories).data;
const TWO_SITES: ProductionGraph = ProductionGraphResponseSchema.parse(productionGraphTwoSites).data;

function group(over: Partial<PlannerNode> & { key: string }): PlannerNode {
  return {
    kind: "machines",
    className: "Build_ConstructorMk1_C",
    name: "Constructor",
    recipe: "Iron Plate",
    count: 1,
    machineIds: [over.key],
    stateCounts: {},
    products: [{ className: "Desc_IronPlate_C", name: "Iron Plate", unit: "items/min", currentPerMinute: 10, maxPerMinute: 20 }],
    ingredients: [],
    at: { x: 0, y: 0 },
    siteKey: "site|0|0",
    loop: false,
    ...over,
  };
}

const part = (over: Partial<FlowPart> = {}): FlowPart => ({
  from: "a",
  to: "b",
  itemClassName: "Desc_IronPlate_C",
  itemName: "Iron Plate",
  ratePerMinute: 10,
  rate: "measured",
  mixed: false,
  carrier: "belt",
  flow: "supply",
  unit: "items/min",
  ...over,
});

const cards = (map: Record<string, string>) => (key: string) => map[key];

describe("hasFactories", () => {
  it("is false for an older backend (no field) and for an empty list, true when factories came", () => {
    expect(hasFactories(TWO_SITES)).toBe(false);
    expect(hasFactories({ ...TWO_SITES, factories: [] })).toBe(false);
    expect(hasFactories(FACTORY_GRAPH)).toBe(true);
  });
});

describe("bubblesOf", () => {
  it("groups by treeKey: the same recipe from two trees is two bubbles, ordinals largest first", () => {
    const nodes = [
      group({ key: "p1", treeKey: "tree|1", count: 2 }),
      group({ key: "p2", treeKey: "tree|2", count: 5 }),
      group({ key: "p3", treeKey: "tree|1", count: 1 }),
    ];
    const bubbles = bubblesOf(nodes);
    expect(bubbles.map((b) => [b.key, b.nodes.map((n) => n.key), b.machineCount])).toEqual([
      ["tree|1", ["p1", "p3"], 3],
      ["tree|2", ["p2"], 5],
    ]);
    expect(bubbles.map((b) => [b.ordinal, b.of])).toEqual([
      [2, 2],
      [1, 2],
    ]);
  });

  it("sums the products of the groups in a bubble", () => {
    const [bubble] = bubblesOf([group({ key: "p1", treeKey: "t" }), group({ key: "p2", treeKey: "t" })]);
    expect(bubble.products).toEqual([{ className: "Desc_IronPlate_C", name: "Iron Plate", unit: "items/min", currentPerMinute: 20, maxPerMinute: 40 }]);
  });

  it("falls back to site, class, recipe and mined item when there is no treeKey (an older backend)", () => {
    const ore = (key: string, item: string) =>
      group({ key, kind: "extractor", className: "Build_MinerMk2_C", name: "Miner", recipe: null, products: [{ className: item, name: item, currentPerMinute: 1, maxPerMinute: 2 }] });
    const bubbles = bubblesOf([
      group({ key: "a" }),
      group({ key: "b" }),
      group({ key: "c", siteKey: "site|9|9" }),
      ore("m1", "Desc_OreIron_C"),
      ore("m2", "Desc_OreCopper_C"),
      ore("m3", "Desc_OreIron_C"),
    ]);
    expect(bubbles.map((b) => b.nodes.map((n) => n.key))).toEqual([["a", "b"], ["c"], ["m1", "m3"], ["m2"]]);
    // Plates in two sites are two trees of one recipe; the two ores are different families, so no ordinals.
    expect(bubbles.map((b) => `${b.ordinal}/${b.of}`)).toEqual(["1/2", "2/2", "1/1", "1/1"]);
  });

  it("prefers the resource the backend inferred over the first product for an extractor's family", () => {
    const base = { kind: "extractor", className: "Build_MinerMk2_C", name: "Miner", recipe: null, products: [] };
    const bubbles = bubblesOf([
      group({ key: "m1", ...base, resource: { className: "Desc_OreIron_C", name: "Iron Ore" } }),
      group({ key: "m2", ...base, resource: { className: "Desc_OreCopper_C", name: "Copper Ore" } }),
    ]);
    expect(bubbles).toHaveLength(2);
  });

  it("returns no bubbles for no groups", () => {
    expect(bubblesOf([])).toEqual([]);
  });
});

describe("foldBubbles", () => {
  const trees = (n: number, recipe = "Iron Ingot") =>
    Array.from({ length: n }, (_, i) => group({ key: `${recipe}-${i}`, treeKey: `${recipe}|${i}`, recipe, count: 100 - i }));

  it("leaves a recipe with the cap's number of trees (6) alone", () => {
    const entries = foldBubbles(bubblesOf(trees(6)));
    expect(entries).toHaveLength(6);
    expect(entries.every((e) => e.type === "bubble")).toBe(true);
  });

  it("keeps the 5 largest of 7 and folds the other 2 into one entry where the first folded one stood", () => {
    // Order of appearance is reversed from size, so the fold lands after the big ones that stay.
    const nodes = trees(7).reverse();
    const entries = foldBubbles(bubblesOf(nodes));
    expect(entries.map((e) => e.type)).toEqual(["fold", "bubble", "bubble", "bubble", "bubble", "bubble"]);
    const fold = entries.find((e) => e.type === "fold");
    expect(fold?.type === "fold" && fold.bubbles.map((b) => b.ordinal)).toEqual([6, 7]);
    const kept = entries.flatMap((e) => (e.type === "bubble" ? [e.bubble.ordinal] : []));
    expect(kept.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("does not touch other recipes", () => {
    const entries = foldBubbles(bubblesOf([...trees(8), group({ key: "screw", recipe: "Screw", treeKey: "screw" })]));
    expect(entries.filter((e) => e.type === "fold")).toHaveLength(1);
    expect(entries.filter((e) => e.type === "bubble")).toHaveLength(6);
  });

  it("honours another cap", () => {
    const entries = foldBubbles(bubblesOf(trees(4)), 3, 2);
    expect(entries.map((e) => e.type)).toEqual(["bubble", "bubble", "fold"]);
  });
});

describe("aggregateFlows", () => {
  const where = cards({ a1: "A", a2: "A", b1: "B", b2: "B" });

  it("drops what stays inside a card and what has an end in no card", () => {
    const flows = aggregateFlows([part({ from: "a1", to: "a2" }), part({ from: "a1", to: "zz" }), part({ from: "a1", to: "b1" })], where);
    expect(flows.map((f) => [f.from, f.to])).toEqual([["A", "B"]]);
  });

  it("says measured only when every part is measured, and sums them", () => {
    const [flow] = aggregateFlows([part({ from: "a1", to: "b1", ratePerMinute: 10 }), part({ from: "a2", to: "b2", ratePerMinute: 5 })], where);
    expect(flow).toMatchObject({ quality: "measured", ratePerMinute: 15, parts: 2 });
  });

  it("says estimated when every part has a number and one is estimated", () => {
    const [flow] = aggregateFlows([part({ from: "a1", to: "b1" }), part({ from: "a2", to: "b2", rate: "estimated", ratePerMinute: 2.5 })], where);
    expect(flow).toMatchObject({ quality: "estimated", ratePerMinute: 12.5 });
  });

  it("says at least when some part has no number, summing the known ones", () => {
    const [flow] = aggregateFlows([part({ from: "a1", to: "b1" }), part({ from: "a2", to: "b2", rate: "unknown", ratePerMinute: null })], where);
    expect(flow).toMatchObject({ quality: "atLeast", ratePerMinute: 10 });
  });

  it("gives no number when no part has one, and treats a rate marked unknown as no number even if one is set", () => {
    const [none] = aggregateFlows([part({ from: "a1", to: "b1", rate: "unknown", ratePerMinute: null })], where);
    expect(none).toMatchObject({ quality: "unknown", ratePerMinute: null });
    const [odd] = aggregateFlows([part({ from: "a1", to: "b1", rate: "unknown", ratePerMinute: 99 })], where);
    expect(odd).toMatchObject({ quality: "unknown", ratePerMinute: null });
  });

  it("keeps items, carriers and flow classes apart, and is mixed when any part is", () => {
    const flows = aggregateFlows(
      [
        part({ from: "a1", to: "b1" }),
        part({ from: "a2", to: "b2", mixed: true }),
        part({ from: "a1", to: "b1", carrier: "train" }),
        part({ from: "a1", to: "b1", flow: "excess" }),
        part({ from: "a1", to: "b1", itemClassName: null, itemName: null }),
      ],
      where,
    );
    expect(flows).toHaveLength(4);
    expect(flows.find((f) => f.carrier === "belt" && f.flow === "supply" && f.itemClassName !== null)).toMatchObject({ mixed: true, parts: 2 });
  });

  it("is the same whatever order the parts come in", () => {
    const parts = [
      part({ from: "a1", to: "b1", ratePerMinute: 1 }),
      part({ from: "b1", to: "a1", itemClassName: "X", itemName: "X" }),
      part({ from: "a2", to: "b2", ratePerMinute: 2, rate: "estimated" }),
      part({ from: "a1", to: "b1", carrier: "train" }),
    ];
    expect(aggregateFlows([...parts].reverse(), where)).toEqual(aggregateFlows(parts, where));
  });

  it("does not mix a pipe's m3/min with a belt's items/min", () => {
    const flows = aggregateFlows([part({ from: "a1", to: "b1" }), part({ from: "a2", to: "b2", unit: "m3/min", carrier: "pipe" })], where);
    expect(flows).toHaveLength(2);
  });
});

describe("flowParts and connectionRows", () => {
  it("turns edges and transports into parts, a missing flow being supply and a pipe in m3/min", () => {
    const parts = flowParts({
      ...TWO_SITES,
      edges: [{ ...TWO_SITES.edges[0], kind: "pipe", flow: undefined }],
      transports: FACTORY_GRAPH.transports,
    });
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({ carrier: "pipe", unit: "m3/min", flow: "supply" });
    expect(parts[1]).toMatchObject({ carrier: "train", unit: "items/min" });
  });

  it("lists the belts, pipes and transports that touch a set of nodes, edges first", () => {
    const nodes = FACTORY_GRAPH.nodes.filter((n) => n.name === "Miner Mk.2" || n.name === "Main Depot").map((n) => n.key);
    const rows = connectionRows(FACTORY_GRAPH, new Set(nodes));
    expect(rows.map((r) => r.carrier)).toEqual(["belt", "train"]);
    expect(rows[1]).toMatchObject({ carriers: 2, routeName: "Ore Run", capacityPerMinute: null, itemFrom: "resourceNode" });
    expect(connectionRows(FACTORY_GRAPH, new Set())).toEqual([]);
  });
});

describe("factoryModels", () => {
  const models = factoryModels(FACTORY_GRAPH);
  const [plate, rod] = models;

  it("gives one model per factory with its groups in its own order", () => {
    expect(models.map((m) => m.factory.name)).toEqual(["Iron Plate factory", "Iron Rod factory"]);
    expect(plate.nodes.map((n) => n.name)).toEqual(["Miner Mk.2", "Main Depot", "Smelter", "Constructor", "Storage Container"]);
  });

  it("puts the home on the site with most machines and lists the rest as remote", () => {
    expect(plate.home?.name).toBe("Main base");
    expect(plate.remoteSites.map((s) => s.name)).toEqual(["Site near (5000, 5000)"]);
    expect(rod.remoteSites).toEqual([]);
  });

  it("counts where flows end, leaving out flows that go on to machines", () => {
    expect(plate.destinations).toEqual([{ destination: "storage", count: 1 }]);
    expect(rod.destinations).toEqual([{ destination: "sink", count: 1 }]);
  });

  it("sums states, finds the shared groups, and skips a key no node answers to", () => {
    expect(plate.stateCounts).toEqual({});
    const withStates = factoryModels({
      ...FACTORY_GRAPH,
      nodes: FACTORY_GRAPH.nodes.map((n) => (n.name === "Smelter" || n.name === "Constructor" ? { ...n, stateCounts: { producing: 2, underfed: 1 } } : n)),
    });
    expect(withStates[0].stateCounts).toEqual({ producing: 4, underfed: 2 });
    expect(plate.sharedNodes).toHaveLength(3);
    const broken = factoryModels({ ...FACTORY_GRAPH, factories: [{ ...FACTORY_GRAPH.factories![1], nodeKeys: ["nope", ...FACTORY_GRAPH.factories![1].nodeKeys] }] });
    expect(broken[0].nodes).toHaveLength(2);
  });

  it("has no home site for a factory whose groups are in no listed site", () => {
    const m = factoryModels({ ...FACTORY_GRAPH, sites: [] })[0];
    expect(m.home).toBeNull();
    expect(m.remoteSites).toEqual([]);
  });

  it("returns nothing when the backend sent no factories", () => {
    expect(factoryModels(TWO_SITES)).toEqual([]);
  });

  it("orders destination chips storage, depot, sink, power, export, unknown, then others", () => {
    const edge = FACTORY_GRAPH.edges[3];
    const dests = ["zeta", "unknown", "export", "power", "sink", "depot", "storage"];
    const graph = { ...FACTORY_GRAPH, edges: dests.map((destination) => ({ ...edge, destination })) };
    expect(factoryModels(graph)[0].destinations.map((d) => d.destination)).toEqual(["storage", "depot", "sink", "power", "export", "unknown", "zeta"]);
  });
});

describe("factoryOfNode and unassignedCount", () => {
  it("maps each group to its factory, preferring the factory's list over the node's own key", () => {
    const owner = factoryOfNode(FACTORY_GRAPH);
    expect(owner.size).toBe(FACTORY_GRAPH.nodes.length);
    expect(unassignedCount(FACTORY_GRAPH)).toBe(0);
  });

  it("counts a group in no factory, and uses factoryKey when a factory does not list the group", () => {
    const [first, ...rest] = FACTORY_GRAPH.factories!;
    const trimmed = { ...FACTORY_GRAPH, factories: [{ ...first, nodeKeys: first.nodeKeys.slice(1) }, ...rest] };
    const dropped = first.nodeKeys[0];
    // The dropped group still carries its factoryKey, so it is assigned through that.
    expect(factoryOfNode(trimmed).get(dropped)).toBe(first.key);
    const bare = { ...trimmed, nodes: trimmed.nodes.map((n) => (n.key === dropped ? { ...n, factoryKey: undefined } : n)) };
    expect(unassignedCount(bare)).toBe(1);
  });
});

describe("remoteInfo", () => {
  const model = factoryModels(FACTORY_GRAPH)[0];

  it("gives the remote group its site, its straight-line distance from the home site and the transport mode", () => {
    const info = remoteInfo(FACTORY_GRAPH, model);
    expect([...info.keys()]).toEqual([FACTORY_GRAPH.nodes[0].key]);
    const miner = info.get(FACTORY_GRAPH.nodes[0].key)!;
    expect(miner.siteName).toBe("Site near (5000, 5000)");
    expect(miner.distanceM).toBe(Math.round(Math.hypot(5000 - 900, 5000 - 40)));
    expect(miner.modes).toEqual(["train"]);
  });

  it("has no distance without a home site, and says so for a site the graph does not list", () => {
    const noHome = remoteInfo(FACTORY_GRAPH, { ...model, home: null });
    expect(noHome.size).toBe(0);
    const unlisted = remoteInfo({ ...FACTORY_GRAPH, sites: FACTORY_GRAPH.sites.slice(0, 1) }, model);
    expect(unlisted.get(FACTORY_GRAPH.nodes[0].key)?.siteName).toBe("Site not listed");
  });
});

describe("shareSplit", () => {
  const node = FACTORY_GRAPH.nodes.find((n) => n.name === "Smelter")!;

  it("splits a shared group into here, the others and the unaccounted rest, in whole percents", () => {
    expect(shareSplit(node)).toEqual({ here: 60, others: [{ factoryKey: "factory|Desc_IronRod_C|1250|100", percent: 40 }], rest: 0 });
    const partial = shareSplit({ factoryKey: "f", shares: [{ factoryKey: "f", share: 0.5 }, { factoryKey: "g", share: 0.25 }] });
    expect(partial).toEqual({ here: 50, others: [{ factoryKey: "g", percent: 25 }], rest: 25 });
  });

  it("is null for a group that is not shared, and has no 'here' when the group names no factory", () => {
    expect(shareSplit({ factoryKey: "f", shares: undefined })).toBeNull();
    expect(shareSplit({ factoryKey: "f", shares: [] })).toBeNull();
    expect(shareSplit({ factoryKey: undefined, shares: [{ factoryKey: "g", share: 1 }] })?.here).toBeNull();
  });

  it("lists the larger other share first, ties by key", () => {
    const split = shareSplit({
      factoryKey: "f",
      shares: [
        { factoryKey: "f", share: 0.4 },
        { factoryKey: "b", share: 0.3 },
        { factoryKey: "a", share: 0.3 },
      ],
    });
    expect(split?.others.map((o) => o.factoryKey)).toEqual(["a", "b"]);
  });
});

describe("factoryAsSite", () => {
  it("presents a factory as a site for the canvas, weighting its centre by machines", () => {
    const model = factoryModels(FACTORY_GRAPH)[1];
    const site = factoryAsSite(model);
    expect(site).toMatchObject({ key: model.factory.key, name: "Iron Rod factory", machineCount: 3, nodeKeys: model.factory.nodeKeys });
    expect(site.topOutputs).toEqual(model.factory.products);
  });

  it("copes with a factory of no listed groups", () => {
    const site = factoryAsSite({ ...factoryModels(FACTORY_GRAPH)[1], nodes: [] });
    expect(site.at).toEqual({ x: 0, y: 0 });
  });
});
