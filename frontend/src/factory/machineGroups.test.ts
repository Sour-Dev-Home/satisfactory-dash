import { describe, expect, it } from "vitest";
import { isBackedUpState } from "@satisfactory-dash/shared";
import { factoryMixed } from "@satisfactory-dash/shared/fixtures";
import { DEMO_EPOCH, factory as demoFactory, plannerDesignations as demoDesignations, productionGraph as demoGraph } from "../demo/world";
import { factoriesGraph, factoryForGraph, groupedFactoriesWorld } from "../test/factoryGroups";
import { treeWorld } from "../test/plannerTree";
import { backedUpIn, groupMachines, narrowGrouping, startsOpen, type MachineFactory } from "./machineGroups";

const names = (factories: readonly MachineFactory[]): unknown =>
  factories.map((f) => (f.parts.length > 0 ? { [f.name]: names(f.parts) } : f.name));

describe("groupMachines (ADR-0062 F.2)", () => {
  it("groups the machines by the Planner's factories, then by group, in the graph's order, with counts", () => {
    const { graph, factory } = groupedFactoriesWorld();
    const grouping = groupMachines(factory.data.buildings, graph, undefined, false)!;
    expect(grouping.factories.map((f) => [f.name, f.machineCount, f.groupCount])).toEqual([
      ["Iron Plate factory", 11, 5],
      ["Iron Rod factory", 3, 2],
    ]);
    expect(grouping.factories[0]!.groups.map((g) => g.label)).toEqual([
      "Miner Mk.2",
      "Main Depot",
      "4× Smelter, Iron Ingot",
      "4× Constructor, Iron Plate",
      "Storage Container",
    ]);
    expect(grouping.factories[1]!.groups.map((g) => g.label)).toEqual(["2× Constructor, Iron Rod", "AWESOME Sink"]);
    expect(backedUpIn(grouping.factories[0]!)).toBe(1);
    expect(grouping.groups).toEqual([]);
  });

  it("lists the machines no group names under Other machines, every machine exactly once", () => {
    const { graph, factory } = groupedFactoriesWorld();
    const grouping = groupMachines(factory.data.buildings, graph, undefined, false)!;
    expect(grouping.other.map((b) => b.className)).toEqual(["Build_OilRefinery_C"]);
    const listed = [...grouping.factories.flatMap((f) => f.groups.flatMap((g) => g.buildings)), ...grouping.other].map((b) => b.id);
    expect(listed.sort()).toEqual(factory.data.buildings.map((b) => b.id).sort());
  });

  it("puts a group two factories list under the factory that owns it, once", () => {
    const { graph, factory } = groupedFactoriesWorld();
    const smelter = graph.nodes.find((n) => n.recipe === "Iron Ingot")!;
    const shared = { ...graph, factories: graph.factories!.map((f) => (f.name === "Iron Rod factory" ? { ...f, nodeKeys: [smelter.key, ...f.nodeKeys] } : f)) };
    const grouping = groupMachines(factory.data.buildings, shared, undefined, false)!;
    const smelters = grouping.factories.flatMap((f) => f.groups.filter((g) => g.label.includes("Smelter")).map(() => f.name));
    expect(smelters).toEqual(["Iron Plate factory"]);
  });

  it("is null (the flat table) without a graph, or when the graph names none of the machines", () => {
    const { graph } = groupedFactoriesWorld();
    expect(groupMachines(factoryMixed.data.buildings, undefined, undefined, false)).toBeNull();
    expect(groupMachines(factoryMixed.data.buildings, graph, undefined, false)).toBeNull();
  });

  it("lists groups at the top level from a backend without factories", () => {
    const { graph, factory } = factoryForGraph({ ...factoriesGraph(), factories: undefined });
    const grouping = groupMachines(factory.data.buildings, graph, undefined, false)!;
    expect(grouping.factories).toEqual([]);
    expect(grouping.groups).toHaveLength(7);
    expect(grouping.other).toEqual([]);
  });

  it("nests factories with nesting on (parents, then their parts, own machines first) and lists them flat with it off", () => {
    const world = treeWorld();
    const { graph, factory } = factoryForGraph(world.graph);
    const on = groupMachines(factory.data.buildings, graph, world.designations, true)!;
    expect(names(on.factories)).toEqual([{ "Main base": [{ Smelters: ["Smelters (own machines)", "Plates", "Rods"] }] }, "Screws"]);
    expect(on.factories[0]!.machineCount).toBe(5);
    expect(on.factories[0]!.groupCount).toBe(3);
    const off = groupMachines(factory.data.buildings, graph, world.designations, false)!;
    expect(names(off.factories)).toEqual(["Smelters", "Plates", "Screws", "Rods"]);
  });

  it("narrows to the filter's machines, dropping empty groups and factories but keeping each total", () => {
    const { graph, factory } = groupedFactoriesWorld();
    const grouping = groupMachines(factory.data.buildings, graph, undefined, false)!;
    expect(narrowGrouping(grouping, null)).toBe(grouping);
    const backed = narrowGrouping(grouping, isBackedUpState);
    expect(backed.factories.map((f) => [f.name, f.machineCount, f.total, f.groupCount])).toEqual([["Iron Plate factory", 1, 11, 5]]);
    expect(backed.factories[0]!.groups.map((g) => [g.label, g.buildings.length, g.total])).toEqual([["4× Constructor, Iron Plate", 1, 4]]);
    expect(backed.other).toEqual([]);
  });

  it("groups the demo world's machines (the demo shows grouped sections)", () => {
    const now = DEMO_EPOCH + 60_000;
    const buildings = demoFactory(now).data.buildings;
    const grouping = groupMachines(buildings, demoGraph(now).data, demoDesignations().designations, true)!;
    expect(grouping.factories.length).toBeGreaterThan(1);
    expect(grouping.other.length).toBeLessThan(buildings.length / 10);
  });

  it("starts a factory of more than 20 groups closed, like the outline", () => {
    expect(startsOpen({ groupCount: 20 })).toBe(true);
    expect(startsOpen({ groupCount: 21 })).toBe(false);
  });
});
