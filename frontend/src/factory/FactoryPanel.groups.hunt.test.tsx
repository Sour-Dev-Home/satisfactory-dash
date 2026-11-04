import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { factoriesGraph, factoryForGraph, groupedFactoriesWorld } from "../test/factoryGroups";
import { groupMachines } from "./machineGroups";
import { FactoryPanel } from "./FactoryPanel";

afterEach(() => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0))));

const toggle = (name: string) => screen.getByRole("button", { name });
const search = (value: string) => fireEvent.change(screen.getByRole("searchbox", { name: "Search machines" }), { target: { value } });

describe("FactoryPanel grouping, hunted edges", () => {
  it("keeps the viewer's choices across a poll that hands it a new snapshot and graph", () => {
    const first = groupedFactoriesWorld();
    const view = render(<FactoryPanel snapshot={first.factory} graph={first.graph} />);
    fireEvent.click(toggle("Iron Plate factory"));
    fireEvent.click(toggle("4× Smelter"));
    const next = groupedFactoriesWorld();
    view.rerender(<FactoryPanel snapshot={next.factory} graph={next.graph} />);
    expect(toggle("Iron Plate factory")).toHaveAttribute("aria-expanded", "true");
    expect(toggle("4× Smelter")).toHaveAttribute("aria-expanded", "true");
    expect(toggle("Iron Rod factory")).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps a section the viewer closed closed while filtering", () => {
    const world = groupedFactoriesWorld();
    render(<FactoryPanel snapshot={world.factory} graph={world.graph} />);
    search("constructor");
    fireEvent.click(toggle("Iron Plate factory"));
    search("constructo");
    expect(toggle("Iron Plate factory")).toHaveAttribute("aria-expanded", "false");
    expect(toggle("Iron Rod factory")).toHaveAttribute("aria-expanded", "true");
  });

  it("groups a repeated building id's first building and lists the copy under Other machines, as the flat table would", () => {
    const { graph, factory } = groupedFactoriesWorld();
    const dup = { ...factory.data.buildings[0]! };
    const grouping = groupMachines([...factory.data.buildings, dup], graph, undefined)!;
    expect(grouping.factories[0]!.groups[0]!.buildings).toEqual([factory.data.buildings[0]]);
    expect(grouping.other.filter((b) => b.id === dup.id)).toEqual([dup]);
  });

  it("lists a graph without factories as its groups' rows at the top level, with no factory heading", () => {
    const { graph, factory } = factoryForGraph({ ...factoriesGraph(), factories: undefined });
    render(<FactoryPanel snapshot={factory} graph={graph} />);
    const table = screen.getByRole("table", { name: "Machines by factory" });
    expect(within(table).getAllByRole("rowheader")).toHaveLength(7);
    expect(within(table).queryAllByRole("heading")).toHaveLength(0);
  });

  it("opens a factory and a group independently when a factory's key equals a group's node key", () => {
    const g = factoriesGraph();
    const plate = g.factories!.find((f) => f.name === "Iron Plate factory")!;
    const smelter = g.nodes.find((n) => plate.nodeKeys.includes(n.key) && n.count > 1)!;
    const { graph, factory } = factoryForGraph({ ...g, factories: g.factories!.map((f) => (f === plate ? { ...f, key: smelter.key } : f)) });
    render(<FactoryPanel snapshot={factory} graph={graph} />);
    fireEvent.click(toggle("Iron Plate factory"));
    const group = screen.getAllByRole("button", { expanded: false }).find((b) => /^\d+× /.test(b.textContent ?? ""))!;
    fireEvent.click(group);
    expect(toggle("Iron Plate factory")).toHaveAttribute("aria-expanded", "true");
    expect(group).toHaveAttribute("aria-expanded", "true");
  });

  it("says 'Several recipes' for a group whose machines changed recipe since the graph, keeping the outputs' names", () => {
    const { graph, factory } = groupedFactoriesWorld();
    const ids = graph.nodes.find((n) => n.recipe === "Iron Plate")!.machineIds;
    const buildings = factory.data.buildings.map((b) => (b.id === ids[0] ? { ...b, recipe: "Alternate: Coated Iron Plate" } : b));
    render(<FactoryPanel snapshot={{ ...factory, data: { ...factory.data, buildings } }} graph={graph} />);
    fireEvent.click(toggle("Iron Plate factory"));
    const row = toggle("4× Constructor").closest("tr")!;
    expect(within(row).getAllByRole("cell")[0]).toHaveTextContent(/^Several recipes$/);
    expect(within(row).getByRole("list", { name: "Outputs" }).querySelector(".sr-only")).toBeNull();
  });

  it("rolls a group's rates up to 0%, never NaN, when its machines can make nothing", () => {
    const { graph, factory } = groupedFactoriesWorld();
    const ids = new Set(graph.nodes.find((n) => n.recipe === "Iron Plate")!.machineIds);
    const buildings = factory.data.buildings.map((b) =>
      ids.has(b.id) ? { ...b, production: b.production.map((p) => ({ ...p, currentPerMinute: 5, maxPerMinute: 0, percent: 0 })) } : b,
    );
    render(<FactoryPanel snapshot={{ ...factory, data: { ...factory.data, buildings } }} graph={graph} />);
    fireEvent.click(toggle("Iron Plate factory"));
    const row = toggle("4× Constructor").closest("tr")!;
    expect(row.textContent).not.toMatch(/NaN|Infinity/);
    expect(within(row).getByRole("list", { name: "Outputs" })).toHaveTextContent(/\(0%\)$/);
  });
});
