import { act, fireEvent, screen, within } from "@testing-library/react";
import { http, HttpResponse, type JsonBodyType } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { endpoints, ProductionGraphResponseSchema } from "@satisfactory-dash/shared";
import { bottlenecksEmpty, productionGraphFactories, productionGraphTwoSites, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { PlannerView } from "./PlannerView";

afterEach(() => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0))));

function renderView() {
  return renderWithClient(
    <MemoryRouter>
      <ServerContext value={serversSingle.servers[0]}>
        <PlannerView />
      </ServerContext>
    </MemoryRouter>,
  );
}

const FACTORY_DATA = ProductionGraphResponseSchema.parse(productionGraphFactories).data;
const answer = (body: JsonBodyType) => server.use(http.get(endpoints.productionGraph.route, () => HttpResponse.json(body)));
const withData = (data: object) => ({ ...productionGraphFactories, data: { ...FACTORY_DATA, ...data } });
const card = async (name: string) => (await screen.findByRole("heading", { name })).closest("li") as HTMLElement;

describe("PlannerView: the factory overview (ADR-0055)", () => {
  beforeEach(() => answer(productionGraphFactories));

  it("shows a card per factory: machines, states, where it stands, products, shared groups and where its flows end", async () => {
    renderView();
    const plate = await card("Iron Plate factory");
    expect(plate).toHaveTextContent("9 machines · No machine states");
    expect(plate).toHaveTextContent("Where: Main base + 1 remote");
    expect(within(plate).getByRole("list", { name: "Products of Iron Plate factory" })).toHaveTextContent("Iron Plate: 48 / 80 items/min");
    expect(plate).toHaveTextContent("3 shared groups, also feeding other factories");
    expect(within(plate).getByRole("list", { name: "Where Iron Plate factory sends its output" })).toHaveTextContent("1 flow to storage");
    const rod = await card("Iron Rod factory (+ Iron Rod)");
    expect(rod).toHaveTextContent("3 machines");
    expect(rod).toHaveTextContent("Where: Main base");
    expect(rod).not.toHaveTextContent("shared");
    expect(within(rod).getByRole("list", { name: "Where Iron Rod factory sends its output" })).toHaveTextContent("1 flow to the Sink");
    expect(screen.getByText(/2 factories · 13 machines in 7 groups/)).toBeInTheDocument();
    // The factory level replaces the site cards.
    expect(screen.queryByRole("list", { name: "Sites" })).not.toBeInTheDocument();
  });

  it("reserves a factory card's bottleneck line before the late bottlenecks read answers, then fills it in place", async () => {
    // Not a read the reveal waits for: answering after the cards were drawn, a new line pushed every card, the notes and
    // the footer down on a phone (the Planner's page-reveal layout shift).
    let answer: () => void = () => {};
    const answered = new Promise<void>((resolve) => (answer = resolve));
    server.use(
      http.get(endpoints.bottlenecks.route, async () => {
        await answered;
        return HttpResponse.json(bottlenecksEmpty);
      }),
    );
    renderView();
    const plate = await card("Iron Plate factory");
    const line = plate.querySelector("[data-bottleneck-line]");
    expect(line).toHaveClass("min-h-lh");
    expect(line).toBeEmptyDOMElement();
    answer();
    expect(await within(plate).findByText("No bottlenecks")).toBeInTheDocument();
    expect(plate.querySelector("[data-bottleneck-line]")).toBe(line);
  });

  it("lists the flows between factories as a table with headers, the carrier and the flow class", async () => {
    renderView();
    const heading = await screen.findByRole("heading", { name: "Flows between factories" });
    const table = within(heading.closest("section") as HTMLElement).getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["From", "To", "Item", "Rate per minute", "Carrier", "Flow"]);
    const row = within(table).getAllByRole("row")[1];
    expect(within(row).getByRole("rowheader")).toHaveTextContent("Iron Plate factory");
    expect(row).toHaveTextContent("Iron Rod factory");
    expect(row).toHaveTextContent("Iron Ingot");
    expect(row).toHaveTextContent("about 48 items/min");
    expect(row).toHaveTextContent("Belt");
    expect(row).toHaveTextContent("Supply");
  });

  it("leaves out the flows table when the factories stand alone", async () => {
    const { nodes, edges } = FACTORY_DATA;
    answer(withData({ edges: edges.filter((e) => e.to !== nodes[4].key && e.from !== nodes[2].key), transports: [] }));
    renderView();
    await card("Iron Plate factory");
    expect(screen.queryByRole("heading", { name: "Flows between factories" })).not.toBeInTheDocument();
  });

  it("falls back to the site cards when the backend sent no factories (an older backend), or an empty list", async () => {
    answer(productionGraphTwoSites);
    renderView();
    expect(await screen.findByRole("button", { name: "Open site: Iron Plate site" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Factories" })).not.toBeInTheDocument();
  });

  it("falls back to sites for an empty factory list too", async () => {
    answer({ ...productionGraphTwoSites, data: { ...productionGraphTwoSites.data, factories: [] } });
    renderView();
    expect(await screen.findByRole("list", { name: "Sites" })).toBeInTheDocument();
  });

  it("notes a group that no factory lists", async () => {
    const { factories } = FACTORY_DATA;
    const first = factories![1];
    answer(withData({ factories: [factories![0], { ...first, nodeKeys: first.nodeKeys.slice(1) }], nodes: FACTORY_DATA.nodes.map((n) => ({ ...n, factoryKey: undefined })) }));
    renderView();
    expect(await screen.findByRole("list", { name: "Planner notes" })).toHaveTextContent("1 group belongs to no factory, so it is not listed under one.");
  });
});

describe("PlannerView: an opened factory", () => {
  beforeEach(() => answer(productionGraphFactories));

  async function openPlate() {
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Open factory: Iron Plate factory" }));
    return screen.findByRole("heading", { name: "Iron Plate factory", level: 4 });
  }

  it("moves focus to the factory's heading and goes back to the overview", async () => {
    const heading = await openPlate();
    expect(heading).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "All factories" }));
    expect(await screen.findByRole("button", { name: "Open factory: Iron Rod factory" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Production planner" })).toHaveFocus();
  });

  it("names the remote sites it spans and what each part is", async () => {
    await openPlate();
    expect(screen.getByText(/Where: Main base \+ 1 remote \(Site near \(5000, 5000\)\)/)).toBeInTheDocument();
  });

  it("lists the groups with role, remote place and how a shared group splits, under proper headers", async () => {
    await openPlate();
    const table = screen.getAllByRole("table")[0];
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Group",
      "Count",
      "Recipe",
      "Output, actual / max",
      "States",
      "Loop",
      "Bottlenecks",
      "Place and split",
    ]);
    const rows = within(table).getAllByRole("row").slice(1);
    const miner = rows.find((r) => r.textContent?.includes("Miner Mk.2")) as HTMLElement;
    // 4100 m east and 4960 m south of the home site's centre.
    expect(miner).toHaveTextContent("Site near (5000, 5000), 6.4 km, by train");
    expect(miner).toHaveTextContent("Shared: 60% here, 40% Iron Rod factory");
    const depot = rows.find((r) => r.textContent?.includes("Main Depot")) as HTMLElement;
    expect(depot).toHaveTextContent("Dimensional Depot");
    const store = rows.find((r) => r.textContent?.includes("Storage Container")) as HTMLElement;
    expect(store).toHaveTextContent("Storage");
    expect(store).toHaveTextContent("Home site");
    // Groups of the other factory are not listed here.
    expect(rows.some((r) => r.textContent?.includes("Iron Rod: 30"))).toBe(false);
  });

  it("lists connections with transports, flow classes, how an item was inferred and which factory the other end is in", async () => {
    await openPlate();
    const table = screen.getAllByRole("table")[1];
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "From",
      "To",
      "Item",
      "Rate per minute",
      "Capacity",
      "Carrier",
      "Flow",
    ]);
    const rows = within(table).getAllByRole("row");
    const train = rows.find((r) => r.textContent?.includes("Train")) as HTMLElement;
    expect(train).toHaveTextContent("Train: Ore Run (2 trains)");
    expect(train).toHaveTextContent("Iron Ore");
    expect(train).toHaveTextContent("(inferred from the resource node)");
    expect(train).toHaveTextContent("about 120 items/min");
    const toRod = rows.find((r) => r.textContent?.includes("Iron Rod factory")) as HTMLElement;
    expect(within(toRod).getByRole("rowheader")).toHaveTextContent("4× Smelter, Iron Ingot");
    expect(toRod).toHaveTextContent("2× Constructor, Iron Rod (Iron Rod factory)");
    const output = rows.find((r) => r.textContent?.includes("Output to storage")) as HTMLElement;
    expect(output).toHaveTextContent("Iron Plate");
    expect(output).toHaveTextContent("48 items/min");
  });

  it("says the excess goes to the sink in the other factory's table", async () => {
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Open factory: Iron Rod factory" }));
    const rows = within(screen.getAllByRole("table")[1]).getAllByRole("row");
    expect(rows.some((r) => r.textContent?.includes("Excess to the AWESOME Sink"))).toBe(true);
  });

  it("shows words it does not know as the backend's own text, not as markup", async () => {
    const edge = { ...FACTORY_DATA.edges[3], flow: "<b>spill</b>", destination: "<i>bin</i>" };
    const nodes = FACTORY_DATA.nodes.map((n, i) => (i === 5 ? { ...n, role: "<u>hub</u>" } : n));
    answer(withData({ nodes, edges: [...FACTORY_DATA.edges.slice(0, 3), edge] }));
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Open factory: Iron Plate factory" }));
    expect((await screen.findAllByText("<b>spill</b> to <i>bin</i>")).length).toBe(1);
    expect(screen.getAllByText(/<u>hub<\/u>/).length).toBeGreaterThan(0);
    expect(document.querySelector("b, i, u")).toBeNull();
  });
});

describe("PlannerView: trees in a factory", () => {
  /** The plate groups as two trees: a tree of two groups (4 + 1 machines) and one of a single group. */
  function twoTrees() {
    const data = FACTORY_DATA;
    const first = data.nodes.find((n) => n.recipe === "Iron Plate")!;
    const sibling = { ...first, key: "sibling", count: 1, treeKey: "tree|a", machineIds: ["s"], at: { x: 1, y: 1 } };
    const other = { ...first, key: "other", count: 1, treeKey: "tree|b", machineIds: ["o"], at: { x: 2, y: 2 } };
    const factories = data.factories!.map((f) => (f.key === first.factoryKey ? { ...f, nodeKeys: [...f.nodeKeys, "sibling", "other"] } : f));
    return withData({ nodes: [...data.nodes.map((n) => (n === first ? { ...n, treeKey: "tree|a" } : n)), sibling, other], factories });
  }

  it("indents a tree's groups under a row that names it with its ordinal, and numbers a lone group's tree", async () => {
    answer(twoTrees());
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Open factory: Iron Plate factory" }));
    const table = screen.getAllByRole("table")[0];
    const group = within(table).getByRole("rowheader", { name: "5× Constructor, Iron Plate, tree 1 of 2" });
    expect(group).toHaveAttribute("scope", "rowgroup");
    expect(group.closest("tbody")?.querySelectorAll("tr")).toHaveLength(3);
    expect(within(table).getByText("tree 2 of 2")).toBeInTheDocument();
  });

  it("folds trees beyond the cap behind one button that shows and hides them", async () => {
    const data = FACTORY_DATA;
    const first = data.nodes.find((n) => n.recipe === "Iron Plate")!;
    const extra = Array.from({ length: 7 }, (_, i) => ({ ...first, key: `t${i}`, treeKey: `tree|${i}`, count: 1, machineIds: [`t${i}`], at: { x: i, y: i } }));
    const factories = data.factories!.map((f) => (f.key === first.factoryKey ? { ...f, nodeKeys: [...f.nodeKeys, ...extra.map((e) => e.key)] } : f));
    answer(withData({ nodes: [...data.nodes.filter((n) => n !== first), ...extra], factories: factories.map((f) => ({ ...f, nodeKeys: f.nodeKeys.filter((k) => k !== first.key) })) }));
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Open factory: Iron Plate factory" }));
    const table = screen.getAllByRole("table")[0];
    const rowsOf = () => within(table).getAllByRole("row").filter((r) => r.textContent?.includes("Constructor")).length;
    expect(rowsOf()).toBe(5);
    const button = within(table).getByRole("button", { name: "Show 2 more Iron Plate trees" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(rowsOf()).toBe(7);
    expect(within(table).getByRole("button", { name: "Hide 2 more Iron Plate trees" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(within(table).getByRole("button", { name: "Hide 2 more Iron Plate trees" }));
    expect(rowsOf()).toBe(5);
  });
});

describe("PlannerView: sites keep their tables when there are no factories", () => {
  it("shows a transport and a flow class in a site's connections too", async () => {
    answer({
      ...productionGraphTwoSites,
      data: {
        ...productionGraphTwoSites.data,
        edges: productionGraphTwoSites.data.edges.map((e, i) => (i === 3 ? { ...e, flow: "output", destination: "storage" } : e)),
      },
    });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Open site: Iron Plate site" }));
    const rows = within(screen.getAllByRole("table")[1]).getAllByRole("row");
    expect(rows.some((r) => r.textContent?.includes("Output to storage"))).toBe(true);
    expect(rows.some((r) => r.textContent?.includes("Supply"))).toBe(true);
  });
});
