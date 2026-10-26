import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { http, HttpResponse, type JsonBodyType } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endpoints, ProductionGraphResponseSchema } from "@satisfactory-dash/shared";
import { productionGraphFactories, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../../servers/ServerContext";
import { renderWithClient } from "../../test/render";
import { server } from "../../test/server";
import { PlannerView } from "../PlannerView";
import { COLLAPSED_KEY, MOTION_KEY, STORAGE_DETAIL_KEY } from "./plannerPrefs";

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
});

const DATA = ProductionGraphResponseSchema.parse(productionGraphFactories).data;
const answer = (body: JsonBodyType) => server.use(http.get(endpoints.productionGraph.route, () => HttpResponse.json(body)));
const withData = (data: object) => ({ ...productionGraphFactories, data: { ...DATA, ...data } });

/** A wide screen (the graph is the default view), with the operator's reduced-motion setting on or off. */
function wideScreen(reducedMotion = false) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width") || (reducedMotion && query.includes("prefers-reduced-motion")),
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
/** Whether a card in the keyboard list starts with these words (its name goes on with the rest of its description). */
const hasCard = (prefix: string) => cardNames().some((n) => n?.startsWith(prefix));

async function openPlate() {
  renderView();
  await overview();
  fireEvent.click(await button(/^Open factory: Iron Plate factory./));
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
    expect(cardNames().map((n) => n?.split(". ")[0])).toEqual(["Open factory: Iron Plate factory", "Open factory: Iron Rod factory"]);
    // A factory card prints its name and one product line, with the main machine's count; the rest is in its tooltip and name.
    expect(within(svg).getByText("Iron Plate factory")).toBeInTheDocument();
    expect(within(svg).getByText("Iron Plate · 48/min")).toBeInTheDocument();
    expect(within(svg).getByText("×9")).toBeInTheDocument();
    expect(within(svg).queryByText("1 flow to storage")).not.toBeInTheDocument();
    expect(cardNames()[0]).toContain("9 machines");
    expect(cardNames()[0]).toContain("1 flow to storage");
    fireEvent.click(await button(/^Open factory: Iron Rod factory./));
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

  it("says where a remote group stands and how a shared one splits, in the card's tooltip and keyboard name", async () => {
    const svg = await openPlate();
    expect(within(svg).getAllByText(/60% here, 40% Iron Rod/)).toHaveLength(3);
    expect(within(svg).getAllByText(/by$|train$/).length).toBeGreaterThan(0);
  });

  it("draws no inline style anywhere in the picture", async () => {
    const svg = await openPlate();
    expect(svg.querySelector("[style]")).toBeNull();
  });

  it("draws the train as a glyph on its edge, named in the legend and the edge's tooltip", async () => {
    const svg = await openPlate();
    expect(svg.querySelector('[data-glyph="train"]')).not.toBeNull();
    const titles = [...svg.querySelectorAll("title")].map((t) => t.textContent);
    expect(titles.some((t) => t?.startsWith("Train, route Ore Run: Miner Mk.2 to Main Depot"))).toBe(true);
    const legend = screen.getByRole("list", { name: "Line styles" });
    expect(within(legend).getByText("train")).toBeInTheDocument();
    expect(within(legend).queryByText("truck")).not.toBeInTheDocument();
  });

  it("hides storage behind the toggle: terminal storage becomes a chip on the group that fills it, and the choice is remembered", async () => {
    const svg = await openPlate();
    const toggle = screen.getByRole("button", { name: "Storage detail" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(hasCard("Storage Container")).toBe(true);
    expect(within(svg).queryByText("1 flow to storage")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(hasCard("Storage Container")).toBe(false);
    expect(cardNames().some((n) => n?.includes("1 flow to storage"))).toBe(true);
    expect(window.localStorage.getItem(STORAGE_DETAIL_KEY)).toBe("off");
  });

  it("starts with storage hidden when the viewer chose that before", async () => {
    window.localStorage.setItem(STORAGE_DETAIL_KEY, "off");
    await openPlate();
    expect(screen.getByRole("button", { name: "Storage detail" })).toHaveAttribute("aria-pressed", "false");
    expect(hasCard("Storage Container")).toBe(false);
  });

  it("hides what only feeds a card behind a count, shows it again from the count, and Escape restores the last one", async () => {
    const svg = await openPlate();
    const hide = await button("Hide 1 group that only feeds Storage Container");
    expect(hasCard("4× Constructor, Iron Plate")).toBe(true);
    fireEvent.click(hide);
    expect(hasCard("4× Constructor, Iron Plate")).toBe(false);
    expect(svg.querySelector('[data-upstream="collapsed"]')).toHaveTextContent("+1");
    expect(window.localStorage.getItem(COLLAPSED_KEY)).not.toBeNull();
    const show = screen.getByRole("button", { name: "Show 1 group hidden behind Storage Container" });
    expect(show).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(show);
    expect(hasCard("4× Constructor, Iron Plate")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Hide 1 group that only feeds Storage Container" }));
    expect(hasCard("4× Constructor, Iron Plate")).toBe(false);
    fireEvent.keyDown(screen.getByRole("group", { name: /^Graph viewport/ }), { key: "Escape" });
    expect(hasCard("4× Constructor, Iron Plate")).toBe(true);
  });

  it("the minus on the card in the picture does the same", async () => {
    const svg = await openPlate();
    const pill = svg.querySelector('[data-upstream="open"]')!;
    expect(pill).toHaveTextContent("−");
    fireEvent.click(pill);
    expect(svg.querySelector('[data-upstream="collapsed"]')).not.toBeNull();
  });

  it("starts with the upstream hidden that the viewer hid before", async () => {
    const first = await openPlate();
    fireEvent.click(await button("Hide 1 group that only feeds Storage Container"));
    expect(first.querySelector('[data-upstream="collapsed"]')).not.toBeNull();
    cleanup();
    const again = await openPlate();
    expect(again.querySelector('[data-upstream="collapsed"]')).not.toBeNull();
    expect(hasCard("4× Constructor, Iron Plate")).toBe(false);
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
    expect(hasCard("4× Constructor, Iron Plate")).toBe(true);
    fireEvent.click(await button("Collapse 5× Constructor, Iron Plate, tree 1 of 2"));
    expect(svg.querySelectorAll("[data-frame]")).toHaveLength(0);
    expect(hasCard("4× Constructor, Iron Plate")).toBe(false);
    const bubble = screen.getByRole("button", { name: /^5× Constructor, Iron Plate, tree 1 of 2./ });
    expect(bubble).toHaveAttribute("aria-expanded", "false");
    expect(bubble.getAttribute("aria-label")).toContain("2 groups · tree 1 of 2");
    // Choosing the bubble opens it in place again.
    fireEvent.click(bubble);
    expect(svg.querySelectorAll("[data-frame]")).toHaveLength(1);
    expect(hasCard("4× Constructor, Iron Plate")).toBe(true);
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
    fireEvent.click(await button(/^4× Constructor, Iron Plate./));
    expect(await screen.findByRole("complementary", { name: /^4× Constructor, Iron Plate/ })).toBeInTheDocument();
  });

  it("lists in the panel what the card no longer prints: the recipe, the outputs and the share split", async () => {
    const svg = await openPlate();
    expect([...svg.querySelectorAll("text")].some((t) => /60% here/.test(t.textContent ?? ""))).toBe(false);
    fireEvent.click((await screen.findAllByRole("button", { name: /60% here, 40% Iron Rod/ }))[0]);
    const panel = await screen.findByRole("complementary");
    expect(panel).toHaveTextContent(/Recipe:/);
    expect(within(panel).getByRole("list", { name: "Outputs" })).toBeInTheDocument();
    expect(panel).toHaveTextContent(/60% here, 40% Iron Rod/);
  });
});

describe("the transport motion", () => {
  beforeEach(() => answer(productionGraphFactories));
  const moving = (svg: HTMLElement) => svg.querySelectorAll("animateMotion");

  it("moves the glyph along its edge under System when the operator has not asked for reduced motion", async () => {
    wideScreen(false);
    const svg = await openPlate();
    expect(moving(svg)).toHaveLength(1);
    const edge = svg.querySelector("animateMotion")!;
    expect(edge.getAttribute("path")).toMatch(/^M[\d. -]+L/);
    expect(edge.getAttribute("repeatCount")).toBe("indefinite");
    expect(edge.closest("g[data-moving]")?.getAttribute("data-moving")).toBe("true");
  });

  it("stays still under System with reduced motion, and the toggle's On overrides that", async () => {
    wideScreen(true);
    const svg = await openPlate();
    expect(moving(svg)).toHaveLength(0);
    expect(svg.querySelector('[data-glyph="train"]')).not.toBeNull();
    expect(svg.querySelector('g[class~="animate-graph-in"]')).toBeNull();
    fireEvent.change(screen.getByLabelText("Motion"), { target: { value: "on" } });
    expect(moving(svg)).toHaveLength(1);
    expect(window.localStorage.getItem(MOTION_KEY)).toBe("on");
  });

  it("Off stops it, and the choice is remembered", async () => {
    wideScreen(false);
    window.localStorage.setItem(MOTION_KEY, "off");
    const svg = await openPlate();
    expect(screen.getByLabelText("Motion")).toHaveValue("off");
    expect(moving(svg)).toHaveLength(0);
  });

  it("does not move in a hidden tab", async () => {
    wideScreen(false);
    const svg = await openPlate();
    expect(moving(svg)).toHaveLength(1);
    const show = (state: "hidden" | "visible") => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
    };
    show("hidden");
    expect(moving(svg)).toHaveLength(0);
    show("visible");
    expect(moving(svg)).toHaveLength(1);
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("has no motion control on a canvas with no transport", async () => {
    wideScreen(false);
    renderView();
    await overview();
    fireEvent.click(await button(/^Open factory: Iron Rod factory./));
    await screen.findByRole("img", { name: /^Graph of Iron Rod factory/ });
    expect(screen.queryByLabelText("Motion")).not.toBeInTheDocument();
  });
});
