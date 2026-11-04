import { describe, expect, it } from "vitest";
import { isBackedUpState, type FactoryBuilding } from "@satisfactory-dash/shared";
import { factoryMixed } from "@satisfactory-dash/shared/fixtures";
import { DEMO_EPOCH, factory as demoFactory, plannerDesignations as demoDesignations, productionGraph as demoGraph } from "../demo/world";
import { factoriesGraph, factoryForGraph, groupedFactoriesWorld } from "../test/factoryGroups";
import { treeWorld, withoutParents } from "../test/plannerTree";
import { backedUpIn, groupMachines, groupTitle, narrowGrouping, notableStates, stateCounts, sumRates, type MachineFactory } from "./machineGroups";

const names = (factories: readonly MachineFactory[]): unknown =>
  factories.map((f) => (f.parts.length > 0 ? { [f.name]: names(f.parts) } : f.name));

describe("groupMachines (ADR-0062 F.2)", () => {
  it("groups the machines by the Planner's factories, then by group, in the graph's order, with counts", () => {
    const { graph, factory } = groupedFactoriesWorld();
    const grouping = groupMachines(factory.data.buildings, graph, undefined)!;
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
    const grouping = groupMachines(factory.data.buildings, graph, undefined)!;
    expect(grouping.other.map((b) => b.className)).toEqual(["Build_OilRefinery_C"]);
    const listed = [...grouping.factories.flatMap((f) => f.groups.flatMap((g) => g.buildings)), ...grouping.other].map((b) => b.id);
    expect(listed.sort()).toEqual(factory.data.buildings.map((b) => b.id).sort());
  });

  it("puts a group two factories list under the factory that owns it, once", () => {
    const { graph, factory } = groupedFactoriesWorld();
    const smelter = graph.nodes.find((n) => n.recipe === "Iron Ingot")!;
    const shared = { ...graph, factories: graph.factories!.map((f) => (f.name === "Iron Rod factory" ? { ...f, nodeKeys: [smelter.key, ...f.nodeKeys] } : f)) };
    const grouping = groupMachines(factory.data.buildings, shared, undefined)!;
    const smelters = grouping.factories.flatMap((f) => f.groups.filter((g) => g.label.includes("Smelter")).map(() => f.name));
    expect(smelters).toEqual(["Iron Plate factory"]);
  });

  it("is null (the flat table) without a graph, or when the graph names none of the machines", () => {
    const { graph } = groupedFactoriesWorld();
    expect(groupMachines(factoryMixed.data.buildings, undefined, undefined)).toBeNull();
    expect(groupMachines(factoryMixed.data.buildings, graph, undefined)).toBeNull();
  });

  it("lists groups at the top level from a backend without factories", () => {
    const { graph, factory } = factoryForGraph({ ...factoriesGraph(), factories: undefined });
    const grouping = groupMachines(factory.data.buildings, graph, undefined)!;
    expect(grouping.factories).toEqual([]);
    expect(grouping.groups).toHaveLength(7);
    expect(grouping.other).toEqual([]);
  });

  it("nests factories under their parents (parts, own machines first) and lists a world without parents flat", () => {
    const world = treeWorld();
    const { graph, factory } = factoryForGraph(world.graph);
    const nested = groupMachines(factory.data.buildings, graph, world.designations)!;
    expect(names(nested.factories)).toEqual([{ "Main base": [{ Smelters: ["Smelters (own machines)", "Plates", "Rods"] }] }, "Screws"]);
    expect(nested.factories[0]!.machineCount).toBe(5);
    expect(nested.factories[0]!.groupCount).toBe(3);
    const flatWorld = withoutParents(world);
    const flat = factoryForGraph(flatWorld.graph);
    const top = groupMachines(flat.factory.data.buildings, flat.graph, flatWorld.designations)!;
    expect(names(top.factories)).toEqual(["Smelters", "Plates", "Screws", "Rods"]);
  });

  it("narrows to the filter's machines, dropping empty groups and factories but keeping each total", () => {
    const { graph, factory } = groupedFactoriesWorld();
    const grouping = groupMachines(factory.data.buildings, graph, undefined)!;
    expect(narrowGrouping(grouping, null)).toBe(grouping);
    const backed = narrowGrouping(grouping, isBackedUpState);
    expect(backed.factories.map((f) => [f.name, f.machineCount, f.total, f.groupCount])).toEqual([["Iron Plate factory", 1, 11, 5]]);
    expect(backed.factories[0]!.groups.map((g) => [g.label, g.buildings.length, g.total])).toEqual([["4× Constructor, Iron Plate", 1, 4]]);
    expect(backed.other).toEqual([]);
  });

  it("groups the demo world's machines (the demo shows grouped sections)", () => {
    const now = DEMO_EPOCH + 60_000;
    const buildings = demoFactory(now).data.buildings;
    const grouping = groupMachines(buildings, demoGraph(now).data, demoDesignations().designations)!;
    expect(grouping.factories.length).toBeGreaterThan(1);
    expect(grouping.other.length).toBeLessThan(buildings.length / 10);
  });

});

// ADR-0064 Decision 3: what a group's one row says.
describe("a group's row", () => {
  const rate = (className: string, name: string, current: number, max: number, unit: "items/min" | "m3/min" | null = "items/min") =>
    ({ className, name, currentPerMinute: current, maxPerMinute: max, percent: max > 0 ? (current / max) * 100 : 0, unit });
  const machine = (over: Partial<FactoryBuilding> = {}): FactoryBuilding =>
    ({ id: "m", name: "Constructor", className: "Build_ConstructorMk1_C", recipe: "Iron Plate", production: [], isProducing: true, isPaused: false, isBackedUp: false, state: "producing", ...over }) as FactoryBuilding;

  it("is titled by its count and building, plain for one", () => {
    expect(groupTitle({ buildings: [machine(), machine()] })).toBe("2× Constructor");
    expect(groupTitle({ buildings: [machine()] })).toBe("Constructor");
    expect(groupTitle({ buildings: [machine()] }, 4)).toBe("4× Constructor");
  });

  it("sums each item's current and max over its machines, the percent of the sums, in first-seen order", () => {
    const a = machine({ production: [rate("Plate", "Iron Plate", 12, 20), rate("Scrap", "Scrap", 1, 2)] });
    const b = machine({ production: [rate("Plate", "Iron Plate", 20, 20)] });
    const summed = sumRates([a, b], (m) => m.production);
    expect(summed.map((r) => [r.name, r.currentPerMinute, r.maxPerMinute, r.percent])).toEqual([
      ["Iron Plate", 32, 40, 80],
      ["Scrap", 1, 2, 50],
    ]);
  });

  it("says 0% for an item nothing can make, and adds nothing for a machine without the list", () => {
    const idle = machine({ production: [rate("Plate", "Iron Plate", 0, 0)], ingredients: undefined });
    expect(sumRates([idle], (m) => m.production)[0]?.percent).toBe(0);
    expect(sumRates([idle, idle], (m) => m.ingredients)).toEqual([]);
  });

  it("counts the states worth a word, never producing nor an unknown state, and a flag the state doesn't say", () => {
    const counts = stateCounts([
      machine(),
      machine({ state: "backedUp", isBackedUp: true }),
      machine({ state: "backedUp", isBackedUp: true }),
      machine({ state: "idle", isPaused: true }),
      machine({ state: "somethingNew" }),
    ]);
    expect(counts.map((c) => [c.view.label, c.count])).toEqual([
      ["Backed up", 2],
      ["Idle", 1],
      ["Paused", 1],
    ]);
    expect(notableStates(machine())).toEqual([]);
  });
});
