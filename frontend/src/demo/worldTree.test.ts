import { afterEach, describe, expect, it } from "vitest";
import { PLANNER_DESIGNATION_MAX_DEPTH, PlannerDesignationsResponseSchema, ProductionGraphResponseSchema } from "@satisfactory-dash/shared";
import { buildFactoryTree, designatedKeyOf, ownKeyOf } from "../planner/factoryTree";
import { demoDesignationsResponse, resetDemoDesignations, withDemoDesignations } from "./designations";
import * as world from "./world";

// ADR-0061 build PR 6: the demo world's nested iron works, three levels deep, for the owner's review on the demo site.

afterEach(() => resetDemoDesignations());

const tree = world.DEMO_TREE;
const graphNow = () => ProductionGraphResponseSchema.parse(withDemoDesignations(world.productionGraph(world.DEMO_EPOCH))).data;
const listNow = () => PlannerDesignationsResponseSchema.parse(demoDesignationsResponse());

describe("the demo world's factory tree", () => {
  it("lists every designation with a parent that exists, parents first, within the depth cap", () => {
    const { designations } = listNow();
    const at = new Map(designations.map((d, i) => [d.id, i]));
    const byId = new Map(designations.map((d) => [d.id, d]));
    const depth = (id: string): number => {
      const parent = byId.get(id)!.parentId ?? null;
      return parent === null ? 1 : 1 + depth(parent);
    };
    for (const d of designations) {
      const parent = d.parentId ?? null;
      if (parent !== null) expect(at.get(parent)).toBeLessThan(at.get(d.id)!);
      expect(depth(d.id)).toBeLessThanOrEqual(PLANNER_DESIGNATION_MAX_DEPTH);
    }
    expect(Math.max(...designations.map((d) => depth(d.id)))).toBe(3);
    expect(designations.map((d) => d.name)).toEqual(["Plastic line", "Main base", "Smelting", "Components", "Reinforced plates", "Rods and screws"]);
  });

  it("finds every member: each is a building of the Factory read, of its class, held by one designation only", () => {
    const { designations, matches } = listNow();
    const buildings = new Map(world.factory(world.DEMO_EPOCH).data.buildings.map((b) => [b.id, b]));
    const held = designations.flatMap((d) => d.members.map((m) => m.id));
    expect(new Set(held).size).toBe(held.length);
    for (const d of designations) {
      for (const m of d.members) expect(buildings.get(m.id!)?.className).toBe(m.c);
      // Empty members only on a parent (ADR-0061 Contracts 3).
      if (d.members.length === 0) expect(designations.some((c) => c.parentId === d.id)).toBe(true);
    }
    for (const m of matches) expect(m.missing).toBe(0);
  });

  it("builds one graph factory per designation with machines, each naming its designation's parent", () => {
    const graph = graphNow();
    const { designations } = listNow();
    const factories = new Map(graph.factories!.map((f) => [f.designationId, f]));
    for (const d of designations) {
      const f = factories.get(d.id);
      if (d.members.length === 0) {
        expect(f).toBeUndefined();
        continue;
      }
      expect(f).toMatchObject({ key: designatedKeyOf(d.id), name: d.name, parentDesignationId: d.parentId ?? null });
      expect(f!.machineCount).toBeGreaterThan(0);
      expect(f!.products.length).toBeGreaterThan(0);
    }
    // The iron works is designated whole, so no automatic factory is left.
    expect(graph.factories!.every((f) => f.designationId !== null)).toBe(true);
  });

  it("owns every group exactly once, keeps the ends with their neighbours and post-dominators inside a factory", () => {
    const graph = graphNow();
    const owned = graph.factories!.flatMap((f) => f.nodeKeys);
    expect(new Set(owned).size).toBe(owned.length);
    expect([...owned].sort()).toEqual(graph.nodes.map((n) => n.key).sort());
    const home = new Map(graph.nodes.map((n) => [n.key, n.factoryKey]));
    const homeOf = (className: string) => graph.nodes.filter((n) => n.className === className).map((n) => home.get(n.key));
    const smelting = designatedKeyOf(tree.smelting.id);
    // The miners and both freight platforms follow the smelters they feed; the sink follows the plates.
    for (const cls of ["Build_MinerMk2_C", "Build_MinerMk1_C", "Build_TrainDockingStation_C"]) for (const at of homeOf(cls)) expect(at).toBe(smelting);
    expect(homeOf("Build_ResourceSink_C")).toEqual([designatedKeyOf(tree.plates.id)]);
    for (const n of graph.nodes) {
      if (typeof n.collapseUnder === "string") expect(home.get(n.collapseUnder)).toBe(n.factoryKey);
      if (n.shares) {
        expect(n.shares.map((s) => s.factoryKey)).toContain(n.factoryKey);
        expect(n.shares.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 9);
      }
    }
  });

  it("draws three levels: Main base with its own machines, Smelting and Components, and Components' two factories", () => {
    const factoryTree = buildFactoryTree(graphNow(), listNow().designations);
    const main = designatedKeyOf(tree.mainBase.id);
    const components = designatedKeyOf(tree.components.id);
    expect(factoryTree.nested).toBe(true);
    expect(factoryTree.rootKeys.map((k) => factoryTree.nodes.get(k)!.name)).toEqual(["Plastic line", "Main base"]);
    expect(factoryTree.nodes.get(main)!.childKeys).toEqual([ownKeyOf(main), designatedKeyOf(tree.smelting.id), components]);
    expect(factoryTree.nodes.get(ownKeyOf(main))).toMatchObject({ kind: "own", name: "Main base (own machines)", depth: 2 });
    expect(factoryTree.nodes.get(components)).toMatchObject({ kind: "parent", depth: 2, opens: undefined });
    const leaves = factoryTree.nodes.get(components)!.childKeys.map((k) => factoryTree.nodes.get(k)!);
    expect(leaves.map((n) => [n.name, n.kind, n.depth])).toEqual([
      ["Reinforced plates", "leaf", 3],
      ["Rods and screws", "leaf", 3],
    ]);
    // Main base's card rolls up every machine below it: all of the iron works.
    const ironMachines = graphNow()
      .factories!.filter((f) => f.key !== designatedKeyOf(world.DEMO_DESIGNATION_ID))
      .reduce((sum, f) => sum + f.machineCount, 0);
    expect(factoryTree.nodes.get(main)!.card.factory.machineCount).toBe(ironMachines);
  });
});
