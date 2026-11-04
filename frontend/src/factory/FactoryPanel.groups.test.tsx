import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { BrowserRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { endpoints, type FactoryResponse, type ProductionGraph } from "@satisfactory-dash/shared";
import { errorForbidden, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { factoryForGraph, factoriesGraph, graphResponse, groupedFactoriesWorld, manyPlateConstructorsWorld } from "../test/factoryGroups";
import { treeWorld, withoutParents } from "../test/plannerTree";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { FactoryPanel } from "./FactoryPanel";
import { FactoryView } from "./FactoryView";

afterEach(() => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0))));

const table = () => screen.getByRole("table", { name: "Machines by factory" });
/** A string name matches the whole accessible name in Testing Library (unlike Playwright), so "Smelters" never finds "Smelters (own machines)". */
const toggle = (name: string) => screen.getByRole("button", { name });
const open = (name: string) => fireEvent.click(toggle(name));
/** The table's row headers in order: groups ("4× Smelter") and machines. */
const rowNames = (t: HTMLElement = table()) => within(t).getAllByRole("rowheader").map((th) => th.textContent);
/** The factory rows' headings at a level, in order. */
const headings = (level: number) => within(table()).queryAllByRole("heading", { level }).map((h) => h.textContent);
/** The row a group's or a machine's button or name is in. */
const rowOf = (el: HTMLElement) => el.closest("tr")!;
const pick = (label: string) =>
  fireEvent.click(within(screen.getByRole("group", { name: "Filter machines" })).getByRole("button", { name: new RegExp(`^${label} \\d+$`) }));
const search = (value: string) => fireEvent.change(screen.getByRole("searchbox", { name: "Search machines" }), { target: { value } });

function renderGrouped(world: { graph: ProductionGraph; factory: FactoryResponse } = groupedFactoriesWorld(), extra: Partial<Parameters<typeof FactoryPanel>[0]> = {}) {
  return render(<FactoryPanel snapshot={world.factory} graph={world.graph} {...extra} />);
}

describe("FactoryPanel's folded table (ADR-0064 Decision 3)", () => {
  it("is one table with one header row, its factories folded, each a heading with its counts", () => {
    renderGrouped();
    expect(screen.getAllByRole("table")).toHaveLength(1);
    // This world's machines send no inputs, so no Inputs column.
    expect(within(table()).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Machine", "Recipe", "Outputs", "State"]);
    expect(headings(4)).toEqual(["Iron Plate factory · 11 machines · 1 backed up", "Iron Rod factory · 3 machines", "Other machines · 1 machine"]);
    for (const name of ["Iron Plate factory", "Iron Rod factory", "Other machines"]) expect(toggle(name)).toHaveAttribute("aria-expanded", "false");
    // Folded: no group or machine row yet.
    expect(within(table()).queryAllByRole("rowheader")).toHaveLength(0);
    // The filter toggles still count the whole factory read.
    expect(screen.getByRole("button", { name: /^All 15$/ })).toBeInTheDocument();
  });

  it("opens a factory to one row per group, and a group of one machine as that machine's row", () => {
    renderGrouped();
    open("Iron Plate factory");
    expect(rowNames()).toEqual(["Miner Mk.2", "Main Depot", "4× Smelter", "4× Constructor", "Storage Container"]);
    // A group row: its recipe, its outputs summed (the item named as the recipe drops its name), its states worth a word.
    const constructors = rowOf(toggle("4× Constructor"));
    const cells = within(constructors).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("Iron Plate");
    const outputs = within(constructors).getByRole("list", { name: "Outputs" });
    expect(outputs).toHaveTextContent(/^Iron Plate: 48 \/ 80 items\/min \(60%\)$/);
    // The item's name is for a screen reader only: the Recipe column says it.
    expect(outputs.querySelector(".sr-only")).toHaveTextContent("Iron Plate:");
    expect(cells.at(-1)).toHaveTextContent(/^1 backed up$/);
    // A healthy group says nothing in its State column.
    expect(within(rowOf(toggle("4× Smelter"))).getAllByRole("cell").at(-1)).toHaveTextContent(/^$/);
    // A one-machine group is the machine's own row: no disclosure.
    expect(screen.queryByRole("button", { name: "Miner Mk.2" })).not.toBeInTheDocument();
  });

  it("opens a group to its machines under it, and folds them again", () => {
    renderGrouped();
    open("Iron Plate factory");
    open("4× Constructor");
    expect(toggle("4× Constructor")).toHaveAttribute("aria-expanded", "true");
    expect(rowNames()).toEqual(["Miner Mk.2", "Main Depot", "4× Smelter", "4× Constructor", "Constructor", "Constructor", "Constructor", "Constructor", "Storage Container"]);
    // A machine row steps in under its group.
    const machine = within(table()).getAllByRole("rowheader")[4];
    expect(machine).toHaveClass("sm:ps-14");
    open("4× Constructor");
    expect(rowNames()).toHaveLength(5);
    open("Iron Plate factory");
    expect(within(table()).queryAllByRole("rowheader")).toHaveLength(0);
  });

  it("says nothing for a producing machine and names every other state", () => {
    renderGrouped();
    open("Iron Plate factory");
    open("4× Constructor");
    const states = within(table())
      .getAllByRole("rowheader")
      .filter((th) => th.textContent === "Constructor")
      .map((th) => within(rowOf(th)).getAllByRole("cell").at(-1)!.textContent);
    expect(states.sort()).toEqual(["", "", "", "Backed up"]);
    expect(screen.queryByText("Producing")).not.toBeInTheDocument();
  });

  it("puts the machines no group names under Other machines, after the factories", () => {
    renderGrouped();
    open("Other machines");
    expect(rowNames()).toEqual(["Refinery"]);
  });

  it("opens the only top-level row by itself: folding it would hide everything", () => {
    const graph = factoriesGraph();
    const plate = graph.factories!.find((f) => f.name === "Iron Plate factory")!;
    renderGrouped(factoryForGraph({ ...graph, nodes: graph.nodes.filter((n) => plate.nodeKeys.includes(n.key)), factories: [plate] }));
    expect(toggle("Iron Plate factory")).toHaveAttribute("aria-expanded", "true");
    expect(rowNames()).toContain("4× Smelter");
  });

  it("caps an open group at 50 machines on its own, with its own Show all in the table", () => {
    renderGrouped(manyPlateConstructorsWorld(55));
    open("Iron Plate factory");
    open("55× Constructor");
    // The group's machines: the rows stepped in under it (the factory's level 0, its groups 1, their machines 2).
    const machinesIn = () => within(table()).getAllByRole("rowheader").filter((th) => th.classList.contains("sm:ps-14"));
    expect(machinesIn()).toHaveLength(50);
    expect(within(table()).getByRole("status")).toHaveTextContent("Showing 50 of 55 machines.");
    expect(screen.getAllByRole("button", { name: /^Show all/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Show all 55 machines" }));
    expect(machinesIn()).toHaveLength(55);
    // Focus lands on the first newly shown machine.
    expect(machinesIn()[50]).toHaveFocus();
    // A new search caps the group again (the search also opens Iron Rod's constructors, so read the group's own status).
    search("constructor");
    expect(within(table()).getByRole("status")).toHaveTextContent("Showing 50 of 55 machines.");
  });

  it("opens everything while filtering, hiding what has no match, with 'N of M' counts", () => {
    renderGrouped();
    pick("Backed up");
    expect(headings(4)).toEqual(["Iron Plate factory · 1 of 11 machines · 1 backed up"]);
    expect(screen.queryByRole("button", { name: "Iron Rod factory" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Other machines" })).not.toBeInTheDocument();
    // The group row keeps its name and says "1 of 4"; it is open, so its one match shows.
    expect(rowOf(toggle("4× Constructor")).querySelector("th")).toHaveTextContent("4× Constructor · 1 of 4");
    expect(rowNames()).toEqual(["4× Constructor · 1 of 4", "Constructor"]);
    pick("All");
    expect(toggle("Iron Rod factory")).toHaveAttribute("aria-expanded", "false");
  });

  it("applies the search across groups, and says when nothing matches", () => {
    renderGrouped();
    search("iron rod");
    expect(within(table()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Iron Rod factory", "2× Constructor"]);
    expect(rowNames()).toEqual(["2× Constructor", "Constructor", "Constructor"]);
    search("no such machine");
    expect(screen.getByText("No machines match.")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Machines by factory" })).not.toBeInTheDocument();
  });

  it("keeps a factory the viewer folded folded while filtering, and their choices across a filter", () => {
    renderGrouped();
    open("Iron Plate factory");
    search("constructor");
    // The viewer opened it; a search keeps it open (and opens the rest).
    expect(toggle("Iron Plate factory")).toHaveAttribute("aria-expanded", "true");
    open("Iron Plate factory");
    expect(toggle("Iron Plate factory")).toHaveAttribute("aria-expanded", "false");
    search("constructo");
    expect(toggle("Iron Plate factory")).toHaveAttribute("aria-expanded", "false");
  });

  it("nests factories, parents then their parts one heading level deeper, and lists a world without parents flat", () => {
    const world = treeWorld();
    const { graph, factory } = factoryForGraph(world.graph);
    const { unmount } = render(<FactoryPanel snapshot={factory} graph={graph} designations={world.designations} />);
    expect(toggle("Main base").closest("h4")).toBeInTheDocument();
    open("Main base");
    expect(toggle("Smelters").closest("h5")).toBeInTheDocument();
    open("Smelters");
    expect(headings(6).map((h) => h?.split(" · ")[0])).toEqual(expect.arrayContaining(["Smelters (own machines)", "Plates", "Rods"]));
    expect(toggle("Screws").closest("h4")).toBeInTheDocument();
    unmount();
    const flatWorld = withoutParents(world);
    const flat = factoryForGraph(flatWorld.graph);
    render(<FactoryPanel snapshot={flat.factory} graph={flat.graph} designations={flatWorld.designations} />);
    expect(screen.queryByRole("button", { name: "Main base" })).not.toBeInTheDocument();
    expect(headings(4).map((h) => h?.split(" · ")[0])).toEqual(["Smelters", "Plates", "Screws", "Rods"]);
  });

  it("folds a factory of many groups as any other, and opens it while filtering", () => {
    const graph = factoriesGraph();
    const many = Array.from({ length: 21 }, (_, i) => ({ ...graph.nodes[3]!, key: `plate-${i}`, count: 1, recipe: `Plate ${i}` }));
    const world = factoryForGraph({ ...graph, nodes: [...many, graph.nodes[0]!], factories: [{ ...graph.factories![0]!, nodeKeys: many.map((n) => n.key) }] });
    renderGrouped(world);
    expect(toggle("Iron Plate factory")).toHaveAttribute("aria-expanded", "false");
    search("plate 7");
    expect(toggle("Iron Plate factory")).toHaveAttribute("aria-expanded", "true");
    expect(within(table()).getByRole("cell", { name: "Plate 7" })).toBeInTheDocument();
  });

  it("keeps the sticky bar with the filters and the search above the table", () => {
    const world = groupedFactoriesWorld();
    const { container } = render(
      <BrowserRouter>
        <FactoryPanel snapshot={world.factory} graph={world.graph} />
      </BrowserRouter>,
    );
    const scope = container.querySelector<HTMLElement>("[data-sticky-scope]")!;
    const bar = scope.querySelector<HTMLElement>("[data-filter-bar]")!;
    expect(bar).toHaveClass("sm:sticky");
    expect(within(bar).getByRole("group", { name: "Filter machines" })).toBeInTheDocument();
    expect(within(bar).getByRole("searchbox", { name: "Search machines" })).toBeInTheDocument();
    // The table is in the same scope, after the bar, so the bar sticks while it scrolls under it.
    expect(scope.contains(table())).toBe(true);
    expect(bar.compareDocumentPosition(table()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the table flat without a graph, as before", () => {
    render(<FactoryPanel snapshot={groupedFactoriesWorld().factory} />);
    expect(screen.queryByRole("table", { name: "Machines by factory" })).not.toBeInTheDocument();
    expect(rowNames(screen.getByRole("table"))).toHaveLength(15);
  });
});

describe("FactoryView reads the Planner's graph for the groups (ADR-0062 F.2)", () => {
  function renderPage() {
    return renderWithClient(
      <ServerContext value={serversSingle.servers[0]}>
        <BrowserRouter>
          <FactoryView />
        </BrowserRouter>
      </ServerContext>,
    );
  }

  it("groups the table once the graph answers", async () => {
    const world = groupedFactoriesWorld();
    server.use(
      http.get(endpoints.factory.route, () => HttpResponse.json(world.factory)),
      http.get(endpoints.productionGraph.route, () => HttpResponse.json(graphResponse(world.graph))),
    );
    renderPage();
    expect(await screen.findByRole("button", { name: "Iron Plate factory" })).toBeInTheDocument();
    expect(screen.queryByText(/could not be read/)).not.toBeInTheDocument();
  });

  it("shows the table flat, saying why, when the graph read fails", async () => {
    const world = groupedFactoriesWorld();
    server.use(
      http.get(endpoints.factory.route, () => HttpResponse.json(world.factory)),
      http.get(endpoints.productionGraph.route, () => HttpResponse.json(errorForbidden, { status: 403 })),
    );
    renderPage();
    expect(await screen.findByText("The Planner's factories could not be read, so the machines are listed in one table.", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Machines by factory" })).not.toBeInTheDocument();
    expect(rowNames(screen.getByRole("table"))).toHaveLength(15);
  });
});
