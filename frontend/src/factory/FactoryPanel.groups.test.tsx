import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { BrowserRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { endpoints, type FactoryResponse, type ProductionGraph } from "@satisfactory-dash/shared";
import { errorForbidden, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { factoryForGraph, factoriesGraph, graphResponse, groupedFactoriesWorld, manyPlateConstructorsWorld } from "../test/factoryGroups";
import { treeWorld } from "../test/plannerTree";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { FactoryPanel } from "./FactoryPanel";
import { FactorySectionsNav } from "./FactorySectionsNav";
import { FactoryView } from "./FactoryView";

afterEach(() => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0))));

const sections = () => screen.getByRole("list", { name: "Machines by factory" });
/** A string name matches the whole accessible name in Testing Library (unlike Playwright), so "Smelters" never finds "Smelters (own machines)". */
const toggle = (name: string) => screen.getByRole("button", { name });
const rowNames = (table: HTMLElement) => within(table).getAllByRole("rowheader").map((th) => th.textContent);
const pick = (label: string) =>
  fireEvent.click(within(screen.getByRole("group", { name: "Filter machines" })).getByRole("button", { name: label }));
const search = (value: string) => fireEvent.change(screen.getByRole("searchbox", { name: "Search machines" }), { target: { value } });
/** The section a disclosure button heads (its `li`). */
const sectionOf = (name: string) => toggle(name).closest("li")!;

function renderGrouped(world: { graph: ProductionGraph; factory: FactoryResponse } = groupedFactoriesWorld(), extra: Partial<Parameters<typeof FactoryPanel>[0]> = {}) {
  return render(<FactoryPanel snapshot={world.factory} graph={world.graph} {...extra} />);
}

describe("FactoryPanel grouped by Planner factory and group (ADR-0062 F.2)", () => {
  it("shows each factory, then its groups, as headings with disclosure buttons and counts", () => {
    renderGrouped();
    const plate = toggle("Iron Plate factory");
    expect(plate).toHaveAttribute("aria-expanded", "true");
    expect(plate.closest("h4")).toHaveTextContent("Iron Plate factory · 11 machines · 1 backed up");
    expect(toggle("Iron Rod factory").closest("h4")).toHaveTextContent(/^Iron Rod factory · 3 machines$/);
    const groups = within(sectionOf("Iron Plate factory")).getByRole("list", { name: "Groups of Iron Plate factory" });
    const heads = within(groups).getAllByRole("heading", { level: 5 }).map((h) => h.textContent);
    expect(heads).toEqual(["Miner Mk.2", "Main Depot", "4× Smelter, Iron Ingot", "4× Constructor, Iron Plate · 1 backed up", "Storage Container"]);
    const constructors = within(sectionOf("4× Constructor, Iron Plate")).getByRole("table");
    expect(rowNames(constructors)).toEqual(["Constructor", "Constructor", "Constructor", "Constructor"]);
    // Each group's table is named by its heading, so a screen reader tells the page's many tables apart.
    expect(constructors).toHaveAccessibleName("4× Constructor, Iron Plate · 1 backed up");
    // The summary above still counts the whole factory read.
    expect(screen.getByText(/^15 machines · 1 backed up/)).toBeInTheDocument();
  });

  it("puts the machines no group names under Other machines, after the factories", () => {
    renderGrouped();
    const items = within(sections()).getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    expect(items).toEqual(["Iron Plate factory · 11 machines · 1 backed up", "Iron Rod factory · 3 machines", "Other machines · 1 machine"]);
    expect(rowNames(within(sectionOf("Other machines")).getByRole("table"))).toEqual(["Refinery"]);
  });

  it("collapses and expands a factory and a group, saying what is folded", () => {
    renderGrouped();
    fireEvent.click(toggle("Iron Plate factory"));
    expect(toggle("Iron Plate factory")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "4× Smelter, Iron Ingot" })).not.toBeInTheDocument();
    expect(within(sectionOf("Iron Plate factory")).getByText("5 groups, folded")).toBeInTheDocument();
    const controls = toggle("Iron Plate factory").getAttribute("aria-controls")!;
    expect(document.getElementById(controls)).toHaveAttribute("hidden");
    fireEvent.click(toggle("Iron Plate factory"));
    expect(toggle("Iron Plate factory")).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(toggle("AWESOME Sink"));
    expect(toggle("AWESOME Sink")).toHaveAttribute("aria-expanded", "false");
    expect(within(sectionOf("AWESOME Sink")).queryByRole("table")).not.toBeInTheDocument();
    fireEvent.click(toggle("AWESOME Sink"));
    expect(within(sectionOf("AWESOME Sink")).getByRole("table")).toBeInTheDocument();
  });

  it("caps each group at 50 rows on its own, with its own Show all", () => {
    renderGrouped(manyPlateConstructorsWorld(55));
    const group = sectionOf("55× Constructor, Iron Plate");
    expect(rowNames(within(group).getByRole("table"))).toHaveLength(50);
    expect(within(group).getByRole("status")).toHaveTextContent("Showing 50 of 55 machines.");
    // The other groups are under the cap: no control of their own, all their rows.
    expect(screen.getAllByRole("button", { name: /^Show all/ })).toHaveLength(1);
    expect(rowNames(within(sectionOf("4× Smelter, Iron Ingot")).getByRole("table"))).toHaveLength(4);
    fireEvent.click(within(group).getByRole("button", { name: "Show all 55 machines" }));
    expect(rowNames(within(group).getByRole("table"))).toHaveLength(55);
    expect(within(group).getAllByRole("rowheader")[50]).toHaveFocus();
    // A new search caps the group again.
    search("constructor");
    expect(rowNames(within(sectionOf("55× Constructor, Iron Plate")).getByRole("table"))).toHaveLength(50);
  });

  it("applies the state filter across groups, hiding the groups and factories with no match, with 'N of M' counts", () => {
    renderGrouped();
    pick("Backed up");
    expect(within(sections()).getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual(["Iron Plate factory · 1 of 11 machines · 1 backed up"]);
    expect(screen.queryByRole("button", { name: "Iron Rod factory" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Other machines" })).not.toBeInTheDocument();
    expect(toggle("4× Constructor, Iron Plate").closest("h5")).toHaveTextContent("4× Constructor, Iron Plate · 1 of 4 machines · 1 backed up");
    pick("All");
    expect(toggle("Iron Rod factory")).toBeInTheDocument();
  });

  it("applies the search across groups, and says when nothing matches", () => {
    renderGrouped();
    search("iron rod");
    expect(within(sections()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Iron Rod factory", "2× Constructor, Iron Rod"]);
    search("no such machine");
    expect(screen.getByText("No machines match.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Machines by factory" })).not.toBeInTheDocument();
  });

  it("nests factories with nesting on, parents then their parts, and lists them flat with it off", () => {
    const world = treeWorld();
    const { graph, factory } = factoryForGraph(world.graph);
    const { unmount } = render(<FactoryPanel snapshot={factory} graph={graph} designations={world.designations} nesting />);
    expect(toggle("Main base").closest("h4")).toBeInTheDocument();
    expect(toggle("Smelters").closest("h5")).toBeInTheDocument();
    const parts = within(sectionOf("Smelters")).getByRole("list", { name: "Parts of Smelters" });
    expect(within(parts).getAllByRole("heading", { level: 6 }).map((h) => h.textContent?.split(" · ")[0])).toEqual(
      expect.arrayContaining(["Smelters (own machines)", "Plates", "Rods"]),
    );
    expect(toggle("Screws").closest("h4")).toBeInTheDocument();
    unmount();
    render(<FactoryPanel snapshot={factory} graph={graph} designations={world.designations} nesting={false} />);
    expect(screen.queryByRole("button", { name: "Main base" })).not.toBeInTheDocument();
    expect(within(sections()).getAllByRole("heading", { level: 4 }).map((h) => h.textContent?.split(" · ")[0])).toEqual(["Smelters", "Plates", "Screws", "Rods"]);
  });

  it("starts a factory of more than 20 groups closed, and opens it while filtering", () => {
    const graph = factoriesGraph();
    const many = Array.from({ length: 21 }, (_, i) => ({ ...graph.nodes[3]!, key: `plate-${i}`, count: 1, recipe: `Plate ${i}` }));
    const world = factoryForGraph({ ...graph, nodes: many, factories: [{ ...graph.factories![0]!, nodeKeys: many.map((n) => n.key) }] });
    renderGrouped(world);
    expect(toggle("Iron Plate factory")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("21 groups, folded")).toBeInTheDocument();
    search("plate 7");
    expect(toggle("Iron Plate factory")).toHaveAttribute("aria-expanded", "true");
    expect(toggle("Constructor, Plate 7")).toBeInTheDocument();
  });

  it("keeps the sticky bar with the nav, the search and the filters above the groups", () => {
    const world = groupedFactoriesWorld();
    const { container } = render(
      <BrowserRouter>
        <FactoryPanel snapshot={world.factory} graph={world.graph} nav={<FactorySectionsNav />} />
      </BrowserRouter>,
    );
    const scope = container.querySelector<HTMLElement>("[data-sticky-scope]")!;
    const bar = scope.querySelector<HTMLElement>("[data-filter-bar]")!;
    expect(bar).toHaveClass("sm:sticky");
    expect(within(bar).getByRole("navigation", { name: "Factory sections" })).toBeInTheDocument();
    expect(within(bar).getByRole("searchbox", { name: "Search machines" })).toBeInTheDocument();
    // The groups are in the same scope, after the bar, so the bar sticks while they scroll under it.
    expect(scope.contains(sections())).toBe(true);
    expect(bar.compareDocumentPosition(sections()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the table flat without a graph, as before", () => {
    render(<FactoryPanel snapshot={groupedFactoriesWorld().factory} />);
    expect(screen.queryByRole("list", { name: "Machines by factory" })).not.toBeInTheDocument();
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
    expect(screen.queryByRole("list", { name: "Machines by factory" })).not.toBeInTheDocument();
    expect(rowNames(screen.getByRole("table"))).toHaveLength(15);
  });
});
