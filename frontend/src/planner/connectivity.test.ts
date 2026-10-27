import { describe, expect, it } from "vitest";
import { ProductionGraphResponseSchema, type PlannerEdge, type PlannerNode, type PlannerTransport, type ProductionGraph } from "@satisfactory-dash/shared";
import { productionGraphFactories } from "@satisfactory-dash/shared/fixtures";
import { factoriesConnected, factoryLinks, partsOf } from "./connectivity";

const fixture = ProductionGraphResponseSchema.parse(productionGraphFactories).data;

const node = (key: string, factoryKey?: string, shares?: PlannerNode["shares"]): PlannerNode => ({
  key,
  kind: "machines",
  className: "Build_ConstructorMk1_C",
  name: "Constructor",
  recipe: null,
  count: 1,
  machineIds: [`${key}-1`],
  stateCounts: {},
  products: [],
  ingredients: [],
  at: { x: 0, y: 0 },
  siteKey: "site",
  loop: false,
  ...(factoryKey === undefined ? {} : { factoryKey }),
  ...(shares === undefined ? {} : { shares }),
});

const edge = (from: string, to: string): PlannerEdge => ({
  from,
  to,
  kind: "belt",
  itemClassName: null,
  itemName: null,
  ratePerMinute: null,
  rate: "unknown",
  mixed: false,
  capacityPerMinute: null,
  conveyorCount: 1,
});

const transport = (from: string, to: string): PlannerTransport => ({
  from,
  to,
  mode: "train",
  itemClassName: null,
  itemName: null,
  ratePerMinute: null,
  rate: "unknown",
  carriers: 1,
  routeName: null,
});

const factory = (key: string, nodeKeys: string[]) => ({
  key,
  name: key,
  designationId: null,
  products: [],
  sideProducts: [],
  nodeKeys,
  siteKeys: ["site"],
  machineCount: nodeKeys.length,
  sharedNodeCount: 0,
});

/** Factories A..D, one node each (a..d), joined by what each test adds. */
function graphOf(extra: { edges?: PlannerEdge[]; transports?: PlannerTransport[]; nodes?: PlannerNode[] } = {}): ProductionGraph {
  const nodes = extra.nodes ?? ["a", "b", "c", "d"].map((k) => node(k, k.toUpperCase()));
  return {
    nodes,
    edges: extra.edges ?? [],
    sites: [],
    unconnectedMachineIds: [],
    beltData: "present",
    connectionsRefreshMinutes: 5,
    notes: [],
    factories: ["A", "B", "C", "D"].map((k) => factory(k, [k.toLowerCase()])),
    ...(extra.transports === undefined ? {} : { transports: extra.transports }),
  };
}

describe("factoriesConnected", () => {
  it("joins factories through an edge, ignoring its direction", () => {
    const graph = graphOf({ edges: [edge("b", "a")] });
    expect(factoriesConnected(graph, ["A", "B"])).toBe(true);
    expect(factoriesConnected(graph, ["B", "A"])).toBe(true);
    expect(factoriesConnected(graph, ["A", "C"])).toBe(false);
  });

  it("joins factories through a transport", () => {
    const graph = graphOf({ transports: [transport("c", "d")] });
    expect(factoriesConnected(graph, ["C", "D"])).toBe(true);
    expect(factoriesConnected(graph, ["A", "D"])).toBe(false);
  });

  it("joins factories that share a node", () => {
    const shared = node("s", "A", [
      { factoryKey: "A", share: 0.7 },
      { factoryKey: "C", share: 0.3 },
    ]);
    const graph = graphOf({ nodes: [shared, node("a", "A"), node("b", "B"), node("c", "C"), node("d", "D")] });
    expect(factoriesConnected(graph, ["A", "C"])).toBe(true);
    expect(factoriesConnected(graph, ["A", "B"])).toBe(false);
  });

  it("needs the selection itself to be one piece: a path through an unselected factory does not count", () => {
    const graph = graphOf({ edges: [edge("a", "b"), edge("b", "c")] });
    expect(factoriesConnected(graph, ["A", "B", "C"])).toBe(true);
    expect(factoriesConnected(graph, ["A", "C"])).toBe(false);
  });

  it("is true for a chain of three and false when one is left apart", () => {
    const graph = graphOf({ edges: [edge("a", "b"), edge("c", "b")] });
    expect(factoriesConnected(graph, ["A", "B", "C"])).toBe(true);
    expect(factoriesConnected(graph, ["A", "B", "C", "D"])).toBe(false);
  });

  it("counts automatic (suggested) factories like designated ones", () => {
    const graph = graphOf({ edges: [edge("a", "b")] });
    const designated = { ...graph, factories: graph.factories!.map((f) => (f.key === "A" ? { ...f, designationId: "6f1c2a9e-3b7d-4e58-9a41-0c5d8e2f7b10" } : f)) };
    expect(factoriesConnected(designated, ["A", "B"])).toBe(true);
  });

  it("ignores a link inside one factory and an edge to a node no factory holds", () => {
    const graph = graphOf({ edges: [edge("a", "a"), edge("a", "zz")] });
    expect(factoryLinks(graph).get("A") ?? new Set()).toEqual(new Set());
    expect(factoriesConnected(graph, ["A", "B"])).toBe(false);
  });

  it("treats one factory, or a repeated key, as trivially connected and an unknown key as not", () => {
    const graph = graphOf();
    expect(factoriesConnected(graph, ["A"])).toBe(true);
    expect(factoriesConnected(graph, ["A", "A"])).toBe(true);
    expect(factoriesConnected(graph, ["A", "nope"])).toBe(false);
  });

  it("finds the fixture's two factories connected by their shared smelter and edges", () => {
    const keys = fixture.factories!.map((f) => f.key);
    expect(keys).toHaveLength(2);
    expect(factoriesConnected(fixture, keys)).toBe(true);
  });

  it("is safe with keys that look like object properties", () => {
    const graph = graphOf({ nodes: [node("__proto__", "constructor"), node("b", "B")], edges: [edge("__proto__", "b")] });
    graph.factories = [factory("constructor", ["__proto__"]), factory("B", ["b"])];
    expect(factoriesConnected(graph, ["constructor", "B"])).toBe(true);
  });
});

describe("partsOf", () => {
  it("counts the pieces the given groups make through edges and transports between them", () => {
    const graph = graphOf({ edges: [edge("a", "b")], transports: [transport("c", "d")] });
    expect(partsOf(graph, new Set(["a", "b"]))).toBe(1);
    expect(partsOf(graph, new Set(["a", "b", "c"]))).toBe(2);
    expect(partsOf(graph, new Set(["a", "b", "c", "d"]))).toBe(2);
    expect(partsOf(graph, new Set(["a", "c"]))).toBe(2);
  });

  it("is zero for no groups", () => {
    expect(partsOf(graphOf(), new Set())).toBe(0);
  });
});
