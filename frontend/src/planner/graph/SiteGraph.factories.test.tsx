import { act, fireEvent, screen, within } from "@testing-library/react";
import { http, HttpResponse, type JsonBodyType } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endpoints, ProductionGraphResponseSchema } from "@satisfactory-dash/shared";
import { productionGraphFactories, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../../servers/ServerContext";
import { renderWithClient } from "../../test/render";
import { server } from "../../test/server";
import { PlannerView } from "../PlannerView";

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
});

const DATA = ProductionGraphResponseSchema.parse(productionGraphFactories).data;
const answer = (body: JsonBodyType) => server.use(http.get(endpoints.productionGraph.route, () => HttpResponse.json(body)));
const withData = (data: object) => ({ ...productionGraphFactories, data: { ...DATA, ...data } });

/** A wide screen: the graph is the default view. */
function wideScreen() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width"),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function renderView() {
  return renderWithClient(
    <MemoryRouter>
      <ServerContext value={serversSingle.servers[0]}>
        <PlannerView />
      </ServerContext>
    </MemoryRouter>,
  );
}

const overview = () => screen.findByRole("img", { name: /^Graph of Factories/ }, { timeout: 3_000 });
const plateGraph = () => screen.findByRole("img", { name: /^Graph of Iron Plate factory/ }, { timeout: 3_000 });
const button = (name: string | RegExp) => screen.findByRole("button", { name });
/** The groups in the graph's keyboard list, by their accessible names. */
const cardNames = () => within(screen.getByRole("list", { name: /in the graph$/ })).getAllByRole("button").map((b) => b.getAttribute("aria-label"));

async function openPlate() {
  renderView();
  await overview();
  fireEvent.click(await button("Open factory: Iron Plate factory"));
  return plateGraph();
}

/** The plate groups as two trees: a tree of two groups (4 + 1 machines) and one of a single group. */
function twoTrees() {
  const first = DATA.nodes.find((n) => n.recipe === "Iron Plate")!;
  const sibling = { ...first, key: "sibling", count: 1, treeKey: "tree|a", machineIds: ["s"], at: { x: 1, y: 1 } };
  const other = { ...first, key: "other", count: 1, treeKey: "tree|b", machineIds: ["o"], at: { x: 2, y: 2 } };
  const factories = DATA.factories!.map((f) => (f.key === first.factoryKey ? { ...f, nodeKeys: [...f.nodeKeys, "sibling", "other"] } : f));
  return withData({ nodes: [...DATA.nodes.map((n) => (n === first ? { ...n, treeKey: "tree|a" } : n)), sibling, other], factories });
}

describe("the factory overview on the canvas", () => {
  beforeEach(() => {
    answer(productionGraphFactories);
    wideScreen();
  });

  it("draws a card per factory with the flow between them, and opens a factory from its card", async () => {
    renderView();
    const svg = await overview();
    expect(svg).toHaveAccessibleName("Graph of Factories: 2 factories, 1 connection. The Tables view lists the same.");
    expect(cardNames()).toEqual(["Open factory: Iron Plate factory", "Open factory: Iron Rod factory"]);
    expect(within(svg).getByText("9 machines")).toBeInTheDocument();
    expect(within(svg).getByText("1 flow to storage")).toBeInTheDocument();
    fireEvent.click(await button("Open factory: Iron Rod factory"));
    expect(await screen.findByRole("img", { name: /^Graph of Iron Rod factory: 2 groups, 1 connection/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Iron Rod factory (+ Iron Rod)" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "All factories" }));
    expect(await overview()).toBeInTheDocument();
  });

  it("clicking the card in the picture opens it too", async () => {
    renderView();
    const svg = await overview();
    fireEvent.click(within(svg).getByText("Iron Rod factory (+ Iron Rod)"));
    expect(await screen.findByRole("img", { name: /^Graph of Iron Rod factory/ })).toBeInTheDocument();
  });

  it("keeps the cards and the flows table as the Tables view", async () => {
    renderView();
    await overview();
    fireEvent.click(screen.getByRole("button", { name: "Tables" }));
    expect(await screen.findByRole("list", { name: "Factories" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Flows between factories" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /^Graph of/ })).not.toBeInTheDocument();
  });
});

describe("an opened factory", () => {
  beforeEach(() => {
    answer(productionGraphFactories);
    wideScreen();
  });

  it("says where a remote group stands and how a shared one splits, on the card", async () => {
    const svg = await openPlate();
    expect(within(svg).getAllByText(/60% here, 40% Iron Rod/)).toHaveLength(3);
    expect(within(svg).getAllByText(/by$|train$/).length).toBeGreaterThan(0);
  });

  it("draws no inline style anywhere in the picture", async () => {
    const svg = await openPlate();
    expect(svg.querySelector("[style]")).toBeNull();
  });

  it("draws the train as an ordinary line with its mode in the tooltip", async () => {
    const svg = await openPlate();
    const titles = [...svg.querySelectorAll("title")].map((t) => t.textContent);
    expect(titles.some((t) => t?.startsWith("Train: Miner Mk.2 to Main Depot"))).toBe(true);
  });
});

describe("drill-down into a bubble", () => {
  beforeEach(() => {
    answer(twoTrees());
    wideScreen();
  });

  it("a factory of few groups opens with its trees expanded in frames, and the Collapse button folds one into a card", async () => {
    const svg = await openPlate();
    expect(svg.querySelectorAll("[data-frame]")).toHaveLength(1);
    expect(cardNames()).toContain("4× Constructor, Iron Plate");
    fireEvent.click(await button("Collapse 5× Constructor, Iron Plate, tree 1 of 2"));
    expect(svg.querySelectorAll("[data-frame]")).toHaveLength(0);
    expect(cardNames()).not.toContain("4× Constructor, Iron Plate");
    const bubble = screen.getByRole("button", { name: "5× Constructor, Iron Plate, tree 1 of 2" });
    expect(bubble).toHaveAttribute("aria-expanded", "false");
    expect(within(svg).getByText("2 groups · tree 1 of 2")).toBeInTheDocument();
    // Choosing the bubble opens it in place again.
    fireEvent.click(bubble);
    expect(svg.querySelectorAll("[data-frame]")).toHaveLength(1);
    expect(cardNames()).toContain("4× Constructor, Iron Plate");
  });

  it("Collapse all and Expand all flip every bubble", async () => {
    const svg = await openPlate();
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(svg.querySelectorAll("[data-card='bubble']")).toHaveLength(1);
    expect(svg.querySelectorAll("[data-frame]")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(svg.querySelectorAll("[data-frame]")).toHaveLength(1);
  });

  it("opens a group inside a frame in the side panel", async () => {
    await openPlate();
    fireEvent.click(await button("4× Constructor, Iron Plate"));
    expect(await screen.findByRole("complementary", { name: /^4× Constructor, Iron Plate/ })).toBeInTheDocument();
  });
});
