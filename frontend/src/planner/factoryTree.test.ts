import { describe, expect, it } from "vitest";
import { ProductionGraphSchema, type PlannerFactory, type ProductionGraph } from "@satisfactory-dash/shared";
import { productionGraphFactories } from "@satisfactory-dash/shared/fixtures";
import { AUTO_KEY, C1, C2, P, T, treeDesignation, treeEdge, treeFactory, treeId, treeNode, treeWorld as world } from "../test/plannerTree";
import { buildFactoryTree, designatedKeyOf, levelOf, levelOwner, ownKeyOf, pathBelow, resolvePath } from "./factoryTree";
import { overviewScene } from "./graph/canvasScene";
import { factoryModels } from "./graph/hierarchy";

const base: ProductionGraph = ProductionGraphSchema.parse(productionGraphFactories.data);
const rate = (model: { factory: PlannerFactory }, className: string) => model.factory.products.find((p) => p.className === className);

describe("buildFactoryTree", () => {
  it("nests three levels, a parent without machines of its own named from the list, and keeps the graph's order", () => {
    const { graph, designations } = world();
    const tree = buildFactoryTree(graph, designations);
    const top = designatedKeyOf(T);
    expect(tree.rootKeys).toEqual([top, AUTO_KEY]);
    expect(tree.nested).toBe(true);
    const t = tree.nodes.get(top)!;
    expect(t).toMatchObject({ kind: "parent", name: "Main base", depth: 1, parentKey: null, opens: undefined });
    expect(t.childKeys).toEqual([designatedKeyOf(P)]);
    const p = tree.nodes.get(designatedKeyOf(P))!;
    expect(p).toMatchObject({ kind: "parent", depth: 2, parentKey: top });
    // Its own machines first, then its children in the graph's order.
    expect(p.childKeys).toEqual([ownKeyOf(designatedKeyOf(P)), designatedKeyOf(C1), designatedKeyOf(C2)]);
    const own = tree.nodes.get(ownKeyOf(designatedKeyOf(P)))!;
    expect(own).toMatchObject({ kind: "own", name: "Smelters (own machines)", depth: 3 });
    expect(own.card.factory.key).toBe(ownKeyOf(designatedKeyOf(P)));
    // It opens into the graph's own factory, keyed as the graph keys it.
    expect(own.opens?.factory.key).toBe(designatedKeyOf(P));
    expect(tree.nodes.get(designatedKeyOf(C2))).toMatchObject({ kind: "leaf", depth: 3, parentKey: designatedKeyOf(P) });
    expect(tree.ofFactory.get(designatedKeyOf(P))).toBe(ownKeyOf(designatedKeyOf(P)));
  });

  it("rolls up a parent with machines of its own: sums, and products net of the flows between its parts", () => {
    const { graph, designations } = world();
    const p = buildFactoryTree(graph, designations).nodes.get(designatedKeyOf(P))!;
    expect(p.card.factory.machineCount).toBe(5);
    expect(p.card.stateCounts).toEqual({ operating: 5 });
    expect(p.card.nodes.map((n) => n.key).sort()).toEqual(["n1", "n2", "n3"]);
    // 60 ingots less 30 (measured) and 10 (estimated) to its children: at least 20.
    expect(rate(p.card, "Desc_IronIngot_C")).toMatchObject({ currentPerMinute: 20, maxPerMinute: 20 });
    expect(p.card.atLeast?.has("Desc_IronIngot_C")).toBe(true);
    // A flow leaving the parent (rods to the automatic factory) is not internal: all 10 rods are an output.
    expect(rate(p.card, "Desc_IronRod_C")).toMatchObject({ currentPerMinute: 10 });
    expect(p.card.atLeast?.has("Desc_IronRod_C")).toBe(false);
    expect(rate(p.card, "Desc_IronPlate_C")).toMatchObject({ currentPerMinute: 30, maxPerMinute: 40 });
  });

  it("rolls up a parent with no machines of its own from its children's roll-ups", () => {
    const { graph, designations } = world();
    const t = buildFactoryTree(graph, designations).nodes.get(designatedKeyOf(T))!;
    expect(t.card.factory).toMatchObject({ name: "Main base", designationId: T, machineCount: 5 });
    expect(rate(t.card, "Desc_IronIngot_C")?.currentPerMinute).toBe(20);
    expect(t.card.atLeast?.has("Desc_IronIngot_C")).toBe(true);
  });

  it("drops a product its parts use up between them, and clamps at 0", () => {
    const { graph, designations } = world();
    const all = { ...graph, edges: [...graph.edges, treeEdge("n1", "n2", "Desc_IronIngot_C", 50, "measured")] };
    const p = buildFactoryTree(all, designations).nodes.get(designatedKeyOf(P))!;
    expect(rate(p.card, "Desc_IronIngot_C")).toBeUndefined();
  });

  it("keeps a product that already read 0 (a stalled one is still an output)", () => {
    const { graph, designations } = world();
    const stalled = treeNode("n1", "Desc_IronIngot_C", 0, 60);
    const factories = graph.factories!.map((f) => (f.designationId === P ? treeFactory(f.key, f.name, [stalled], P, T) : f));
    const nodes = graph.nodes.map((n) => (n.key === "n1" ? stalled : n));
    const p = buildFactoryTree({ ...graph, nodes, factories }, designations).nodes.get(designatedKeyOf(P))!;
    expect(rate(p.card, "Desc_IronIngot_C")).toMatchObject({ currentPerMinute: 0 });
  });

  it("treats a child whose parent is missing as top level, and leaves out a designation with no machines anywhere", () => {
    const { graph, designations } = world();
    const tree = buildFactoryTree(graph, [...designations.filter((d) => d.id !== T), treeDesignation(treeId(9), "Empty", null, 0)]);
    expect(tree.rootKeys).toEqual([designatedKeyOf(P), AUTO_KEY]);
    expect(tree.nodes.has(designatedKeyOf(treeId(9)))).toBe(false);
  });

  it("reads the graph's parentDesignationId when the list has not answered (a parent known only to the list is then missing)", () => {
    const { graph } = world();
    const tree = buildFactoryTree(graph, undefined);
    // T is unknown, so P is top level; P still nests C1 and C2.
    expect(tree.rootKeys).toEqual([designatedKeyOf(P), AUTO_KEY]);
    expect(tree.nodes.get(designatedKeyOf(P))?.childKeys).toHaveLength(3);
  });

  it("is cycle-safe: a loop of parents is cut at its smallest id, and nothing is lost", () => {
    const { graph, designations } = world();
    // T's parent is C1: T > P > C1 > T. Cut at T (the smallest id), so the tree is as before.
    const looped = designations.map((d) => (d.id === T ? { ...d, parentId: C1 } : d));
    const tree = buildFactoryTree(graph, looped);
    expect(tree.rootKeys).toEqual([designatedKeyOf(T), AUTO_KEY]);
    const self = buildFactoryTree(
      graph,
      designations.map((d) => (d.id === C2 ? { ...d, parentId: C2 } : d)),
    );
    expect(self.rootKeys).toContain(designatedKeyOf(C2));
    // Every group is drawn once at the top level, whatever the data.
    for (const t of [tree, self]) expect([...levelOwner(graph, t, null).keys()].sort()).toEqual(["n1", "n2", "n3", "n4"]);
  });

  it("hangs anything deeper than three levels under its ancestor on level two", () => {
    const { graph, designations } = world();
    const D = treeId(5);
    const n5 = treeNode("n5", "Desc_Wire_C", 5, 5);
    const deep = { ...graph, nodes: [...graph.nodes, n5], factories: [...graph.factories!, treeFactory(designatedKeyOf(D), "Wire", [n5], D, C2)] };
    const tree = buildFactoryTree(deep, [...designations, treeDesignation(D, "Wire", C2)]);
    // C2 is on level 3, so D (level 4) moves under P (level 2), beside C2.
    expect(tree.nodes.get(designatedKeyOf(D))).toMatchObject({ depth: 3, parentKey: designatedKeyOf(P) });
    expect(tree.nodes.get(designatedKeyOf(C2))?.kind).toBe("leaf");
  });

  it("with nesting off every factory is top level, in the graph's order", () => {
    const { graph, designations } = world();
    const tree = buildFactoryTree(graph, designations, false);
    expect(tree.nested).toBe(false);
    expect(tree.rootKeys).toEqual(graph.factories!.map((f) => f.key));
  });
});

describe("paths", () => {
  const { graph, designations } = world();
  const tree = buildFactoryTree(graph, designations);
  const top = designatedKeyOf(T);
  const p = designatedKeyOf(P);

  it("keeps a valid path whole and trims a bad tail", () => {
    expect(resolvePath(tree, [top, p, designatedKeyOf(C1)])).toEqual([top, p, designatedKeyOf(C1)]);
    expect(resolvePath(tree, [top, p, "gone", designatedKeyOf(C1)])).toEqual([top, p]);
    expect(resolvePath(tree, ["gone"])).toEqual([]);
    expect(resolvePath(tree, [])).toEqual([]);
  });

  it("refuses a key that is in the tree but not a part of the one before", () => {
    expect(resolvePath(tree, [p])).toEqual([]);
    expect(resolvePath(tree, [top, designatedKeyOf(C1)])).toEqual([top]);
    // A leaf has no parts.
    expect(resolvePath(tree, [AUTO_KEY, AUTO_KEY])).toEqual([AUTO_KEY]);
  });

  it("a #776 single key to a top-level factory is a path of one", () => {
    const flat = buildFactoryTree(base, undefined);
    const key = base.factories![0]!.key;
    expect(resolvePath(flat, [key])).toEqual([key]);
  });

  it("levelOf shows a parent's parts, else the top level", () => {
    expect(levelOf(tree, []).entries.map((e) => e.key)).toEqual([top, AUTO_KEY]);
    expect(levelOf(tree, [top, p]).parent?.key).toBe(p);
    expect(levelOf(tree, [top, p]).entries).toHaveLength(3);
    expect(levelOf(tree, [AUTO_KEY]).parent).toBeUndefined();
  });
});

describe("pathBelow (opening a card drawn inside a blow-up, ADR-0061 Decision 5)", () => {
  const { graph, designations } = world();
  const tree = buildFactoryTree(graph, designations);
  const top = designatedKeyOf(T);
  const mid = designatedKeyOf(P);
  it("is the chain from the level down to the card, root first", () => {
    expect(pathBelow(tree, null, top)).toEqual([top]);
    expect(pathBelow(tree, null, mid)).toEqual([top, mid]);
    expect(pathBelow(tree, null, designatedKeyOf(C1))).toEqual([top, mid, designatedKeyOf(C1)]);
    expect(pathBelow(tree, top, designatedKeyOf(C2))).toEqual([mid, designatedKeyOf(C2)]);
    expect(pathBelow(tree, mid, ownKeyOf(mid))).toEqual([ownKeyOf(mid)]);
  });
  it("gives a key the level does not hold back alone, for the path's validation to trim", () => {
    expect(pathBelow(tree, null, "nothing")).toEqual(["nothing"]);
    expect(pathBelow(tree, mid, AUTO_KEY)).toEqual([AUTO_KEY]);
  });
});

describe("overviewScene(path)", () => {
  const { graph, designations } = world();
  const tree = buildFactoryTree(graph, designations);
  const models = factoryModels(graph);

  it("draws the top level of the tree, summing flows between the shown cards", () => {
    const scene = overviewScene(graph, models, [], tree);
    expect(scene.name).toBe("Factories");
    expect(scene.cards.map((c) => c.key)).toEqual([designatedKeyOf(T), AUTO_KEY]);
    expect(scene.flows.map((f) => [f.from, f.to])).toEqual([[designatedKeyOf(T), AUTO_KEY]]);
    expect(scene.cards[0]!.description).toContain("Desc_IronIngot_C: at least");
  });

  it("a card whose first product is a floor prints it with its at least", () => {
    const { graph: g, designations: ds } = world();
    // Without the plates, the ingots are the parent's first product.
    const factories = g.factories!.filter((f) => f.designationId !== C1);
    const flat = { ...g, factories, nodes: g.nodes.filter((n) => n.key !== "n2"), edges: g.edges.filter((e) => e.to !== "n2") };
    const scene = overviewScene(flat, factoryModels(flat), [], buildFactoryTree(flat, ds.filter((d) => d.id !== C1)));
    // A long name gives way; the floor's words are never cut.
    expect(scene.cards[0]!.lines[1]).toMatch(/^Desc_Ir.* · at least 50\/min$/);
  });

  it("draws a parent's parts with its name, its own machines as one card, and drops the flows that leave it", () => {
    const path = [designatedKeyOf(T), designatedKeyOf(P)];
    const scene = overviewScene(graph, models, path, tree);
    expect(scene.name).toBe("Factories in Smelters");
    expect(scene.path).toEqual(path);
    expect(scene.cards.map((c) => c.label)).toEqual(["Smelters (own machines)", "Plates", "Rods"]);
    expect(scene.flows.map((f) => [f.from, f.to]).sort()).toEqual([
      [ownKeyOf(designatedKeyOf(P)), designatedKeyOf(C1)],
      [ownKeyOf(designatedKeyOf(P)), designatedKeyOf(C2)],
    ]);
  });

  it("without a tree is today's overview", () => {
    const scene = overviewScene(graph, models);
    expect(scene.cards.map((c) => c.key)).toEqual(graph.factories!.map((f) => f.key));
  });
});
