import { act, fireEvent, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { bottlenecksBeltLevel, factoryMixed, productionGraphTwoSites, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../../servers/ServerContext";
import { renderWithClient } from "../../test/render";
import { server } from "../../test/server";
import { PlannerView } from "../PlannerView";
import { joinMachines } from "./panelJoin";

afterEach(() => {
  vi.unstubAllGlobals();
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
});

const building = factoryMixed.data.buildings[0];
const machine = (id: string, extra: Partial<typeof building> = {}) => ({
  ...building,
  id,
  name: "Constructor",
  state: "producing",
  clockSpeedPercent: 100,
  production: [{ className: "Desc_IronPlate_C", name: "Iron Plate", unit: "items/min" as const, currentPerMinute: 18, maxPerMinute: 20, percent: 90 }],
  ...extra,
});
const factoryWithPlannerMachines = {
  ...factoryMixed,
  data: {
    ...factoryMixed.data,
    buildings: [machine("Build_ConstructorMk1_C_1"), machine("Build_ConstructorMk1_C_2", { state: "underfed", clockSpeedPercent: 160 }), machine("Build_ConstructorMk1_C_3")],
  },
};
const findingOnConstructors = {
  ...bottlenecksBeltLevel,
  data: {
    ...bottlenecksBeltLevel.data,
    findings: [{ ...bottlenecksBeltLevel.data.findings[0], buildingId: "Build_ConstructorMk1_C_2", affectedCount: 1,
        affected: [{ buildingId: "Build_ConstructorMk1_C_2", buildingName: "Constructor", recipe: "Iron Plate" }],
      },
    ],
  },
};

function renderView() {
  server.use(http.get(endpoints.factory.route, () => HttpResponse.json(factoryWithPlannerMachines)));
  return renderWithClient(
    <MemoryRouter>
      <ServerContext value={serversSingle.servers[0]}>
        <PlannerView />
      </ServerContext>
    </MemoryRouter>,
  );
}

async function openGraph() {
  renderView();
  fireEvent.click(await screen.findByRole("button", { name: "Open site: Iron Plate site" }));
  fireEvent.click(await screen.findByRole("button", { name: "Graph" }));
  return screen.findByRole("img", { name: /^Graph of Iron Plate site/ }, { timeout: 3_000 });
}

/** The drawing's transform: the <g> that holds edges and nodes. */
const transformOf = (svg: HTMLElement) => svg.querySelector(":scope > g")!.getAttribute("transform")!;
const scaleOf = (svg: HTMLElement) => Number(/scale\(([\d.e-]+)\)/.exec(transformOf(svg))![1]);
/** A window-level pointer event (jsdom has no PointerEvent, so the id is put on a MouseEvent). */
const pointer = (type: string, pointerId: number, clientX: number, clientY: number) =>
  fireEvent(window, Object.assign(new MouseEvent(type, { clientX, clientY }), { pointerId }));
const groupButton =(name: RegExp) => screen.findByRole("button", { name });
const dimmed = (svg: HTMLElement) => svg.querySelectorAll(":scope > g > g.opacity-graph-dim").length;

describe("the site view toggle", () => {
  it("opens on the tables where there is no wide screen, and the graph is one press away", async () => {
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Open site: Iron Plate site" }));
    expect(await screen.findByRole("button", { name: "Tables" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("table")).toHaveLength(2);
    expect(screen.queryByRole("img", { name: /^Graph of/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Graph" }));
    expect(await screen.findByRole("img", { name: /^Graph of Iron Plate site/ }, { timeout: 3_000 })).toBeInTheDocument();
    // The tables are the text alternative: still in the page, hidden from view while the graph shows.
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tables" }));
    expect(screen.getAllByRole("table")).toHaveLength(2);
  });

  it("opens on the graph on a wide screen", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("min-width"),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Open site: Iron Plate site" }));
    expect(await screen.findByRole("img", { name: /^Graph of Iron Plate site/ }, { timeout: 3_000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Graph" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("the site graph", () => {
  it("is an image with a summary, and every group is a keyboard button with a name", async () => {
    const svg = await openGraph();
    expect(svg).toHaveAccessibleName("Graph of Iron Plate site: 5 groups, 5 connections, 2 in a loop. The Tables view lists the same.");
    const list = screen.getByRole("list", { name: "Groups in the graph" });
    const names = within(list).getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(names).toHaveLength(5);
    expect(names).toContain("8× Constructor, Iron Plate, in a loop");
    expect(names.some((n) => n?.endsWith(", in a loop"))).toBe(true);
    // Edge words per Decision 2, drawn in the picture.
    expect(svg.textContent).toContain("Iron Ore");
    expect(svg.textContent).toContain("120 items/min");
    expect(svg.textContent).toContain("about 102.2 items/min");
  });

  it("zooms and pans from the keyboard and the buttons, and fits again", async () => {
    const svg = await openGraph();
    const viewport = screen.getByRole("group", { name: /^Graph viewport/ });
    const start = scaleOf(svg);
    const before0 = transformOf(svg);
    fireEvent.keyDown(viewport, { key: "+" });
    expect(scaleOf(svg)).toBeGreaterThan(start);
    fireEvent.keyDown(viewport, { key: "-" });
    fireEvent.keyDown(viewport, { key: "-" });
    expect(scaleOf(svg)).toBeLessThan(start);
    const before = transformOf(svg);
    fireEvent.keyDown(viewport, { key: "ArrowLeft" });
    expect(transformOf(svg)).not.toBe(before);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(scaleOf(svg)).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Fit to view" }));
    expect(transformOf(svg)).toBe(before0);
  });

  it("sizes the canvas from the drawing through the SVG height attribute, not an inline style", async () => {
    const svg = await openGraph();
    expect(Number(svg.getAttribute("height"))).toBeGreaterThan(0);
    expect(svg.getAttribute("viewBox")).toMatch(/^0 0 \d+ \d+$/);
    expect(svg.getAttribute("style")).toBeNull();
  });

  it("pans by dragging, and zooms with the wheel", async () => {
    const svg = await openGraph();
    const before = transformOf(svg);
    fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    pointer("pointermove", 1, 160, 130);
    pointer("pointerup", 1, 160, 130);
    expect(transformOf(svg)).not.toBe(before);
    const k = scaleOf(svg);
    fireEvent.wheel(svg, { deltaY: -200, clientX: 10, clientY: 10 });
    expect(scaleOf(svg)).toBeGreaterThan(k);
  });

  it("pinches with two pointers: the distance scales the view, and a lifted finger leaves a one-finger pan", async () => {
    const svg = await openGraph();
    const k0 = scaleOf(svg);
    fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(svg, { button: 0, pointerId: 2, clientX: 200, clientY: 100 });
    pointer("pointermove", 2, 300, 100);
    expect(scaleOf(svg)).toBeCloseTo(k0 * 2, 5);
    pointer("pointerup", 2, 300, 100);
    const after = transformOf(svg);
    // The remaining finger pans from where it was, not from where it started.
    pointer("pointermove", 1, 110, 100);
    expect(transformOf(svg)).not.toBe(after);
    expect(scaleOf(svg)).toBeCloseTo(k0 * 2, 5);
    pointer("pointerup", 1, 110, 100);
  });

  it("filters by item: lights what carries it upstream and downstream, dims the rest, and clears", async () => {
    // Without the recycle loop's two connections, the recycler stands alone: no item reaches it.
    const data = productionGraphTwoSites.data;
    server.use(
      http.get(endpoints.productionGraph.route, () =>
        HttpResponse.json({ ...productionGraphTwoSites, data: { ...data, edges: data.edges.filter((_, i) => i !== 2 && i !== 3) } }),
      ),
    );
    const svg = await openGraph();
    expect(dimmed(svg)).toBe(0);
    const select = screen.getByRole("combobox", { name: "Item" });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["All items", "Iron Ingot", "Iron Ore", "Iron Plate"]);
    fireEvent.change(select, { target: { value: "Desc_IronIngot_C" } });
    // Ingot goes smelter -> plates: the miner is upstream, the storage downstream, the recycler neither.
    expect(await screen.findByRole("status")).toHaveTextContent("4 of 5 groups");
    expect(dimmed(svg)).toBe(1);
    fireEvent.change(select, { target: { value: "Desc_OreIron_C" } });
    expect(screen.getByRole("status")).toHaveTextContent("4 of 5 groups");
    fireEvent.change(select, { target: { value: "" } });
    expect(dimmed(svg)).toBe(0);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("opens a group's machines in a side panel from the factory read, and Escape returns focus to the group", async () => {
    const svg = await openGraph();
    const button = await groupButton(/^8× Constructor, Iron Plate, in a loop$/);
    button.focus();
    fireEvent.click(button);
    const panel = await screen.findByRole("complementary", { name: "8× Constructor, Iron Plate" });
    await within(panel).findByRole("list", { name: "Machines in 8× Constructor, Iron Plate" });
    const items = within(panel).getAllByRole("listitem");
    // Three of the group's eight ids are in the factory read; the rest are said to be missing.
    expect(items).toHaveLength(3);
    expect(items[1]).toHaveTextContent("Constructor");
    expect(items[1]).toHaveTextContent("Underfed · Clock 160%");
    expect(items[1]).toHaveTextContent("Iron Plate: 18 / 20 items/min");
    expect(items[0]).not.toHaveTextContent("Clock");
    expect(panel).toHaveTextContent("5 machines are not in the latest factory read.");
    expect(panel.contains(document.activeElement)).toBe(true);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(svg.querySelector("rect.stroke-accent")).not.toBeNull();

    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("closes the panel with its Close button and hands focus back", async () => {
    await openGraph();
    const button = await groupButton(/^Miner Mk\.2$/);
    fireEvent.click(button);
    const panel = await screen.findByRole("complementary", { name: "Miner Mk.2" });
    fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("badges a group with a finding, in the picture, its button name and the panel's link", async () => {
    server.use(http.get(endpoints.bottlenecks.route, () => HttpResponse.json(findingOnConstructors)));
    // The finding sits on a machine of the constructor manifold; the factory read carries that machine.
    const svg = await openGraph();
    const button = await groupButton(/^8× Constructor, Iron Plate, in a loop, 1 bottleneck$/);
    expect(svg.textContent).toContain("Bottleneck");
    fireEvent.click(button);
    const panel = await screen.findByRole("complementary");
    expect(within(panel).getByRole("link", { name: /1 bottleneck in 8× Constructor, Iron Plate/ })).toHaveAttribute(
      "href",
      "/app/factory#bottlenecks-heading",
    );
  });

  it("leaves the badge out while the bottlenecks read has not answered", async () => {
    server.use(http.get(endpoints.bottlenecks.route, () => new Promise<never>(() => {})));
    const svg = await openGraph();
    expect(svg.textContent).not.toContain("Bottleneck");
  });
});

describe("joinMachines", () => {
  const buildings = factoryWithPlannerMachines.data.buildings;
  it("joins by id in the group's order, counts the missing, and words state and clock like the Factory page", () => {
    const joined = joinMachines({ machineIds: ["Build_ConstructorMk1_C_2", "gone", "Build_ConstructorMk1_C_1"] }, buildings);
    expect(joined.missing).toBe(1);
    expect(joined.machines.map((m) => m.id)).toEqual(["Build_ConstructorMk1_C_2", "Build_ConstructorMk1_C_1"]);
    expect(joined.machines[0]).toMatchObject({ state: "Underfed", clock: "Clock 160%", outputs: ["Iron Plate: 18 / 20 items/min"] });
    expect(joined.machines[1].clock).toBeNull();
  });

  it("a state this build does not know has no label, and a machine with no recipe has no outputs", () => {
    const odd = [{ ...buildings[0], id: "x", state: "melting", production: [] }];
    expect(joinMachines({ machineIds: ["x"] }, odd).machines[0]).toMatchObject({ state: null, outputs: [] });
  });
});

describe("the graph's readable chrome", () => {
  it("has an icon toolbar with the three named buttons, and each is a touch target", async () => {
    await openGraph();
    for (const name of ["Zoom in", "Zoom out", "Fit to view"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveClass("min-h-touch", "min-w-touch");
      expect(button.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    }
  });

  it("draws a legend of line samples with text labels", async () => {
    await openGraph();
    const legend = screen.getByRole("list", { name: "Line styles" });
    expect(within(legend).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "measured",
      "about (estimated)",
      "unknown",
      "mixed belt",
      "pipe",
    ]);
    for (const svg of legend.querySelectorAll("svg")) expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(legend.querySelectorAll("line[stroke-dasharray]")).toHaveLength(2);
    expect(legend.textContent).not.toMatch(/drag|scroll/i);
  });

  it("draws card text at the readable sizes, and edge labels as halo text with a named class", async () => {
    const svg = await openGraph();
    expect(svg.querySelector("text.text-base.font-semibold")).not.toBeNull();
    const label = [...svg.querySelectorAll("text")].find((t) => t.textContent === "Iron Ore120 items/min")!;
    expect(label).toHaveClass("text-sm", "paint-stroke-first");
    expect(label.getAttribute("class")).not.toContain("[paint-order");
    // The rate and state lines are in full colour; only the recipe line is muted.
    expect(svg.querySelectorAll("text.fill-muted").length).toBe(5);
  });

  it("says how to see more only while the drawing runs past the canvas, and fades the clipped edges", async () => {
    const svg = await openGraph();
    const hint = "Drag or use the arrow keys to see more →";
    const fades = () => [...document.querySelectorAll("[data-fade]")].filter((f) => f.getAttribute("data-clipped") === "true").map((f) => f.getAttribute("data-fade"));
    // jsdom's 1000 x 600 stage holds the fixture's drawing at the fit (two-line labels keep it narrow): nothing is clipped.
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
    expect(fades()).toEqual([]);
    // Zoomed in, the right edge runs past the canvas: the hint and the fades come.
    for (let i = 0; i < 2; i++) fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText(hint)).toBeInTheDocument();
    expect(fades().length).toBeGreaterThan(0);
    for (const f of document.querySelectorAll("[data-fade]")) {
      expect(f).toHaveAttribute("aria-hidden", "true");
      expect(f.getAttribute("style")).toBeNull();
    }
    // Zoomed out to fit inside, nothing is clipped and the hint goes.
    const zoomOut = screen.getByRole("button", { name: "Zoom out" });
    for (let i = 0; i < 4; i++) fireEvent.click(zoomOut);
    expect(scaleOf(svg)).toBeLessThan(0.5);
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
    expect(fades()).toEqual([]);
    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText(hint)).toBeInTheDocument();
    expect(fades().length).toBeGreaterThan(1);
  });

  it("opens the panel as a drawer from lg and brings the group into the part left of it", async () => {
    const svg = await openGraph();
    const tx = (el: Element) => Number(/translate\((-?[\d.e-]+)/.exec(el.getAttribute("transform")!)![1]);
    const storage = [...svg.querySelectorAll(":scope > g > g")].find((g) => g.hasAttribute("transform") && g.textContent?.includes("Storage"))!;
    const left = () => tx(svg.querySelector(":scope > g")!) + scaleOf(svg) * tx(storage);
    const before = left();
    const real = window.getComputedStyle.bind(window);
    // From lg the panel's wrapper is absolute (the CSS is not loaded in jsdom): say so for the panel's wrapper only.
    vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) =>
      el.querySelector?.("aside")
        ? new Proxy(real(el, pseudo), {
            get: (target, prop) => {
              const value: unknown = Reflect.get(target, prop);
              return prop === "position" ? "absolute" : typeof value === "function" ? value.bind(target) : value;
            },
          })
        : real(el, pseudo),
    );
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
    fireEvent.click(await groupButton(/Storage/));
    await screen.findByRole("complementary");
    // The stage is 1000 wide in jsdom, the drawer 800: the card must now end inside the 200 px left of it.
    expect(left()).toBeLessThan(before);
    expect(left() + scaleOf(svg) * 120).toBeLessThanOrEqual(200 + 1);
    vi.restoreAllMocks();
  });

  it("leaves the view alone when the panel is stacked (not absolute)", async () => {
    const svg = await openGraph();
    const before = transformOf(svg);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
    fireEvent.click(await groupButton(/Miner Mk\.2/));
    await screen.findByRole("complementary");
    expect(transformOf(svg)).toBe(before);
    vi.restoreAllMocks();
  });
});
