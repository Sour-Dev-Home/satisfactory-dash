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
});
