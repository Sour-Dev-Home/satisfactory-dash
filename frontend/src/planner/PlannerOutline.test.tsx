import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endpoints, ProductionGraphResponseSchema, type Bottleneck, type PlannerNode, type PlannerRate } from "@satisfactory-dash/shared";
import { productionGraphTwoSites, serversRoleOwner, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { outlineRowOf, outlineRows, renderOutline } from "../test/outline";
import { treeGraphResponse, treeNode, treeWorld } from "../test/plannerTree";
import { renderWithClient } from "../test/render";
import { plannerLarge } from "../test/scenarios";
import { server } from "../test/server";
import { NESTING_KEY } from "./graph/plannerPrefs";
import { OUTLINE_OPEN_MAX, type OutlineConnection } from "./outlineModel";
import { PlannerPanel } from "./PlannerPanel";
import { PlannerView } from "./PlannerView";

// ADR-0062 Decision 3 (build PR 4): the outline replaces the two tables. These tests read it as a viewer would: headings,
// sentences, buttons and the one selection it shares with the graph.

afterEach(() => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0))));

const SITES = ProductionGraphResponseSchema.parse(productionGraphTwoSites);
const IRON_SITE = SITES.data.sites[0]!.key;

function renderSite(path: readonly string[] = [IRON_SITE]) {
  return render(
    <MemoryRouter>
      <PlannerPanel snapshot={SITES} path={path} onPath={() => {}} />
    </MemoryRouter>,
  );
}

const rate = (name: string, current: number, max: number): PlannerRate => ({ className: `Desc_${name}_C`, name, unit: "items/min", currentPerMinute: current, maxPerMinute: max });
const group = (key: string, over: Partial<PlannerNode> = {}): PlannerNode => ({
  key,
  kind: "machines",
  className: "Build_SmelterMk1_C",
  name: `Smelter ${key}`,
  recipe: "Iron Ingot",
  count: 1,
  machineIds: [`m-${key}`],
  stateCounts: { producing: 1 },
  products: [rate("Iron Ingot", 30, 30)],
  ingredients: [],
  at: { x: 0, y: 0 },
  siteKey: "s",
  loop: false,
  ...over,
});

describe("the outline's shape", () => {
  it("is a summary sentence, then Needs attention, the groups and All connections, headed one level below the site", () => {
    renderSite();
    const headings = screen.getAllByRole("heading").map((h) => `${h.tagName} ${h.textContent}`);
    expect(headings).toEqual(["H3 Production planner", "H4 Iron Plate site", "H5 Needs attention", "H5 Groups", "H5 All connections"]);
    expect(screen.getByText(/^15 machines in 5 groups: \d+ stalled, 2 in loops\.$/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Groups" })).toBeInTheDocument();
    // A nested list, not an ARIA tree.
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
    expect(outlineRows()).toHaveLength(5);
  });

  it("says each group as a sentence whose neighbours are buttons that move the keyboard to their rows", () => {
    renderSite();
    const smelter = outlineRowOf("Smelter")!;
    expect(smelter).toHaveTextContent(/^4× Smelter make Iron Ingot: /);
    expect(smelter).toHaveTextContent(/Gets Iron Ore from Miner Mk\.2 \(120 items\/min\)\./);
    expect(smelter).toHaveTextContent(/Sends Iron Ingot to 8× Constructor, Iron Plate/);
    fireEvent.click(within(smelter).getByRole("button", { name: "Miner Mk.2" }));
    expect(outlineRowOf("Miner Mk.2")).toHaveFocus();
  });

  it("puts the state's mark before its word, and the word is always there", () => {
    renderOutline([group("a", { products: [rate("Iron Ingot", 0, 60)], stateCounts: { backedUp: 1 } }), group("b", { products: [rate("Iron Ingot", 0, 30)], stateCounts: { producing: 1, idle: 1 } })]);
    const [a, b] = outlineRows();
    const mark = a!.querySelector('[data-state-mark="backedUp"]')!;
    expect(mark.closest("svg")?.nextSibling?.textContent).toBe("backed up");
    // Mixed states have no mark; the word stands alone.
    expect(b!.querySelector("[data-state-mark]")).toBeNull();
    expect(b).toHaveTextContent("Iron Ingot: 0 of 30 items/min, not producing.");
  });
});

describe("Needs attention", () => {
  const finding = (buildingId: string): Bottleneck => ({
    buildingId,
    buildingName: "Smelter",
    state: "underfed",
    rootCause: { kind: "deficit", text: "Not enough Iron Ore" } as Bottleneck["rootCause"],
    chain: [],
    text: "Underfed: not enough Iron Ore reaches it.",
  });

  it("orders stalled outputs (most lost first), then bottlenecks, then unknown ends, each with Show in graph", () => {
    const onShow = vi.fn();
    const nodes = [
      group("small", { products: [rate("Iron Ingot", 0, 30)], stateCounts: { underfed: 1 } }),
      group("big", { products: [rate("Iron Ingot", 0, 120)], stateCounts: { backedUp: 1 } }),
      group("slow"),
      group("lost"),
    ];
    const edge = { ...SITES.data.edges[0]!, from: "lost", to: "nowhere", destination: "unknown" };
    renderOutline(nodes, { findings: [finding("m-slow")], edges: [edge], onShowInGraph: onShow });
    const items = within(screen.getByRole("list", { name: "Needs attention" })).getAllByRole("listitem");
    expect(items.map((li) => li.firstElementChild?.textContent)).toEqual([
      "Smelter big, Iron Ingot: Iron Ingot: 0 of 120 items/min, backed up",
      "Smelter small, Iron Ingot: Iron Ingot: 0 of 30 items/min, underfed",
      "Smelter slow, Iron Ingot: Underfed: not enough Iron Ore reaches it.",
      "Smelter lost, Iron Ingot: 1 flow to unknown ends",
    ]);
    fireEvent.click(within(items[2]!).getByRole("button", { name: "Show in graph: Smelter slow, Iron Ingot" }));
    expect(onShow).toHaveBeenCalledWith("slow");
  });

  it("says when nothing needs attention, and when the bottlenecks have not been read", () => {
    renderOutline([group("a")]);
    expect(screen.getByText("Nothing needs attention.")).toBeInTheDocument();
    expect(screen.getByText("Bottlenecks not read yet.")).toBeInTheDocument();
  });
});

describe("All connections", () => {
  const row = (from: string, rateText: string, rateSort: number | null, carrier = "Belt"): OutlineConnection => ({
    key: from,
    fromKey: from,
    toKey: "b",
    from,
    to: "B",
    item: "Iron Ore",
    itemNote: null,
    rate: rateText,
    rateSort,
    carrier,
    capacity: "270 items/min",
    flow: "Supply",
  });

  it("is one 5-column table behind a disclosure, sorted by any header with aria-sort; the capacity and flow are a row's detail", () => {
    renderOutline([group("a")], { connections: [row("Mid", "60 items/min", 60), row("Unknown", "unknown", null), row("Fast", "about 480 items/min", 480), row("Slow", "10 items/min", 10, "Pipe")] });
    const disclosure = screen.getByRole("button", { name: "All connections" });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    const table = screen.getByRole("table");
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent?.replace(/[↕↑↓]/u, ""))).toEqual(["From", "To", "Item", "Rate", "Carrier"]);
    expect(headers.every((h) => !h.hasAttribute("aria-sort"))).toBe(true);
    const order = () => within(table).getAllByRole("rowheader").map((h) => h.textContent);
    expect(order()).toEqual(["Mid", "Unknown", "Fast", "Slow"]);
    fireEvent.click(within(headers[3]!).getByRole("button"));
    expect(headers[3]).toHaveAttribute("aria-sort", "ascending");
    expect(order()).toEqual(["Slow", "Mid", "Fast", "Unknown"]);
    fireEvent.click(within(headers[3]!).getByRole("button"));
    expect(headers[3]).toHaveAttribute("aria-sort", "descending");
    // An unknown rate stays last either way.
    expect(order()).toEqual(["Fast", "Mid", "Slow", "Unknown"]);
    fireEvent.click(within(headers[4]!).getByRole("button"));
    expect(headers[3]).not.toHaveAttribute("aria-sort");
    expect(headers[4]).toHaveAttribute("aria-sort", "ascending");
    expect(order()[0]).toBe("Mid");
    const details = within(table).getByRole("button", { name: "Details: Slow to B, Iron Ore" });
    expect(details).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(details);
    expect(details).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(details.getAttribute("aria-controls")!)).toHaveTextContent("Capacity: 270 items/min · Flow: Supply");
  });
});

describe("the overview's tree (ADR-0061 nesting)", () => {
  beforeEach(() => window.localStorage.setItem(NESTING_KEY, "on"));
  afterEach(() => {
    window.localStorage.removeItem(NESTING_KEY);
    vi.unstubAllGlobals();
  });

  function renderTree(world = treeWorld()) {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
    server.use(
      http.get(endpoints.productionGraph.route, () => HttpResponse.json(treeGraphResponse(world.graph))),
      http.get(endpoints.plannerDesignations.list.route, () => HttpResponse.json({ designations: world.designations, matches: [] })),
    );
    return renderWithClient(
      <MemoryRouter>
        <ServerContext value={serversRoleOwner.servers[0]}>
          <PlannerView />
        </ServerContext>
      </MemoryRouter>,
    );
  }

  it("lists parents with their parts under them, then each factory's groups, every disclosure saying whether it is open", async () => {
    renderTree();
    const main = (await screen.findByRole("button", { name: "Main base" })).closest("li")!;
    expect(within(main).getByRole("button", { name: "Main base" })).toHaveAttribute("aria-expanded", "true");
    const parts = within(main).getByRole("list", { name: "Parts of Main base" });
    expect(within(parts).getByRole("button", { name: "Smelters" })).toHaveAttribute("aria-expanded", "true");
    expect(within(main).getByRole("list", { name: "Parts of Smelters" })).toBeInTheDocument();
    // Headings follow the nesting: the level's sections h4, its factories h5, their parts h6.
    expect(within(main).getAllByRole("heading").map((h) => h.tagName)).toEqual(["H5", "H6", "H6", "H6", "H6"]);
    fireEvent.click(within(main).getByRole("button", { name: "Main base" }));
    expect(within(main).getByRole("button", { name: "Main base" })).toHaveAttribute("aria-expanded", "false");
    expect(within(main).queryByRole("list", { name: "Parts of Main base" })).not.toBeInTheDocument();
  });

  it(`starts a factory of more than ${OUTLINE_OPEN_MAX} groups closed, and a neighbour's button opens it to reach the row`, async () => {
    const world = treeWorld();
    const many = Array.from({ length: OUTLINE_OPEN_MAX + 1 }, (_, i) => ({ ...treeNode(`big${i}`, "Desc_IronScrew_C", 5, 10), name: `Big ${i}` }));
    const screws = world.graph.factories!.find((f) => f.name === "Screws")!;
    const graph = {
      ...world.graph,
      nodes: [...world.graph.nodes, ...many],
      edges: [...world.graph.edges, { ...world.graph.edges[0]!, from: "n3", to: "big0" }],
      factories: world.graph.factories!.map((f) => (f === screws ? { ...f, nodeKeys: [...f.nodeKeys, ...many.map((n) => n.key)] } : f)),
    };
    renderTree({ ...world, graph });
    const toggle = await screen.findByRole("button", { name: "Screws" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle.closest("li")).toHaveTextContent(`${OUTLINE_OPEN_MAX + 2} groups, folded`);
    // The Rods group sends to the first of them: its row (folded away) is a button in the Rods group's sentence.
    fireEvent.click(screen.getByRole("button", { name: /^2× Big 0\b/ }));
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(document.activeElement?.getAttribute("data-outline-row")).toBe("group"));
    expect(toggle.closest("li")!.contains(document.activeElement)).toBe(true);
  });

  it("with the nesting flag off, lists the factories flat", async () => {
    window.localStorage.removeItem(NESTING_KEY);
    renderTree();
    await screen.findByRole("button", { name: "Screws" });
    expect(screen.queryByRole("list", { name: /^Parts of / })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Smelters" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Main base" })).not.toBeInTheDocument();
  });

  it("keeps a parent's Open factory and its parts' actions as buttons in their rows", async () => {
    renderTree();
    const main = (await screen.findByRole("button", { name: "Main base" })).closest("li")!;
    expect(within(main).getByRole("button", { name: "Open factory: Main base" })).toBeInTheDocument();
    expect(within(main).getByRole("button", { name: "Select Main base" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(within(main).getByRole("button", { name: "Open factory: Smelters" }));
    expect(await screen.findByRole("heading", { name: "Smelters" })).toHaveFocus();
  });
});

describe("one selection with the graph (Decision 3, graph sync)", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("min-width"), addEventListener: () => {}, removeEventListener: () => {} }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderWide = () =>
    renderWithClient(
      <MemoryRouter>
        <ServerContext value={serversSingle.servers[0]}>
          <PlannerView />
        </ServerContext>
      </MemoryRouter>,
    );

  it("a card focused in the graph is the outline's current row, which takes the keyboard; Show in graph hands it back", async () => {
    renderWide();
    fireEvent.click(await screen.findByRole("button", { name: "Open site: Iron Plate site" }));
    await screen.findByRole("img", { name: /^Graph of Iron Plate site/ }, { timeout: 3_000 });
    const cards = screen.getByRole("list", { name: "Groups in the graph" });
    act(() => within(cards).getByRole("button", { name: /^4× Smelter, Iron Ingot\./ }).focus());
    fireEvent.click(screen.getByRole("button", { name: "Outline" }));
    const smelter = outlineRowOf("Smelter")!;
    expect(smelter).toHaveAttribute("aria-current", "true");
    await waitFor(() => expect(smelter).toHaveFocus());
    expect(outlineRows().filter((r) => r.hasAttribute("aria-current"))).toHaveLength(1);

    fireEvent.click(within(outlineRowOf("Miner Mk.2")!).getByRole("button", { name: "Show in graph: Miner Mk.2" }));
    await screen.findByRole("img", { name: /^Graph of Iron Plate site/ }, { timeout: 3_000 });
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Groups in the graph" })).getByRole("button", { name: /^Miner Mk\.2\./ })).toHaveFocus());
    // And back: the miner is now the outline's current row.
    fireEvent.click(screen.getByRole("button", { name: "Outline" }));
    expect(outlineRowOf("Miner Mk.2")).toHaveAttribute("aria-current", "true");
  });
});

describe("cost (Decision 3: virtualise only past 50 ms)", () => {
  it("renders the 160 groups of planner-large in one pass, and records the time", () => {
    const large = ProductionGraphResponseSchema.parse(plannerLarge);
    const site = large.data.sites[0]!.key;
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      const view = render(
        <MemoryRouter>
          <PlannerPanel snapshot={large} path={[site]} onPath={() => {}} />
        </MemoryRouter>,
      );
      times.push(performance.now() - start);
      expect(outlineRows()).toHaveLength(160);
      view.unmount();
    }
    // jsdom is slower than a browser; the ADR records these with the browser's own number from the e2e run.
    console.info(`[outline] planner-large, 160 groups, jsdom render ms: ${times.map((t) => t.toFixed(0)).join(", ")}`);
    expect(Math.min(...times)).toBeGreaterThan(0);
  });
});
