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
    expect(names.some((n) => n?.startsWith("8× Constructor, Iron Plate. ") && n.includes("In a loop"))).toBe(true);
    expect(names.every((n) => n !== null && n.length > 0)).toBe(true);
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

  it("a drag on the canvas selects no text and never drags a building icon away as an image", async () => {
    const svg = await openGraph();
    expect(svg).toHaveClass("select-none");
    // fireEvent returns false when a handler cancelled the event.
    expect(fireEvent.dragStart(svg.querySelector("text") ?? svg)).toBe(false);
  });

  it("a mouse press cancels the browser's text selection, clears one already made, and focuses the viewport for the keys", async () => {
    const svg = await openGraph();
    const removeAllRanges = vi.fn();
    const getSelection = vi.spyOn(window, "getSelection").mockReturnValue({ removeAllRanges } as unknown as Selection);
    // fireEvent returns false when a handler cancelled the event.
    expect(fireEvent.pointerDown(svg, { button: 0, pointerId: 1, pointerType: "mouse", clientX: 100, clientY: 100 })).toBe(false);
    pointer("pointerup", 1, 100, 100);
    expect(removeAllRanges).toHaveBeenCalled();
    expect(screen.getByRole("group", { name: /^Graph viewport/ })).toHaveFocus();
    getSelection.mockRestore();
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
    const button = await groupButton(/^8× Constructor, Iron Plate\..*In a loop$/);
    button.focus();
    fireEvent.click(button);
    const panel = await screen.findByRole("complementary", { name: "8× Constructor, Iron Plate" });
    const machines = await within(panel).findByRole("list", { name: "Machines in 8× Constructor, Iron Plate" });
    // What the card no longer prints is in the panel: the recipe, every output and the loop marker.
    expect(within(panel).getByText("Iron Plate", { selector: "p" })).toBeInTheDocument();
    expect(within(panel).getByRole("list", { name: "Outputs" })).toHaveTextContent(/^Iron Plate: /);
    expect(within(panel).getByText("In a loop")).toBeInTheDocument();
    const items = within(machines).getAllByRole("listitem");
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
    const button = await groupButton(/^Miner Mk\.2\b/);
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
    const button = await groupButton(/^8× Constructor, Iron Plate\..*In a loop, 1 bottleneck$/);
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

  it("draws every line before every label, so no line runs over another edge's label (2026-10-27)", async () => {
    const svg = await openGraph();
    const paths = [...svg.querySelectorAll('[data-edge-layer="lines"] path')];
    const pills = [...svg.querySelectorAll("[data-label-pill]")];
    expect(paths.length).toBeGreaterThan(1);
    expect(pills).toHaveLength(paths.length);
    for (const pill of pills) for (const path of paths) expect(path.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("draws two links between the same groups as one line, its tooltip listing each with its rate, lit by either item", async () => {
    const data = productionGraphTwoSites.data;
    const lime = { ...data.edges[0], itemClassName: "Desc_Stone_C", itemName: "Limestone", ratePerMinute: 30, rate: "measured" as const };
    server.use(http.get(endpoints.productionGraph.route, () => HttpResponse.json({ ...productionGraphTwoSites, data: { ...data, edges: [...data.edges, lime] } })));
    const svg = await openGraph();
    // One bubble per item, the faster first, over the summed rate (ADR-0060 Decision 1).
    const label = [...svg.querySelectorAll("[data-edge-label]")].find((g) => g.querySelectorAll("[data-bubble]").length === 2)!;
    expect([...label.querySelectorAll("[data-bubble]")].map((b) => b.getAttribute("data-bubble"))).toEqual(["Desc_OreIron_C", "Desc_Stone_C"]);
    expect(label.querySelector(":scope > text")?.textContent).toBe("150 items/min");
    const title = label.querySelector("title")!.textContent!;
    expect(title).toContain("2 links: Iron Ore · 120 items/min (measured); Limestone · 30 items/min (measured)");
    // The summary still counts every link; the lines layer draws one line fewer.
    expect(svg.getAttribute("aria-label")).toMatch(/6 connections/);
    expect(svg.querySelectorAll('[data-edge-layer="lines"] path')).toHaveLength(5);
    fireEvent.change(screen.getByRole("combobox", { name: "Item" }), { target: { value: "Desc_Stone_C" } });
    expect(label).not.toHaveClass("opacity-graph-dim");
    // The text path keeps a row per link.
    fireEvent.click(screen.getByRole("button", { name: "Tables" }));
    const rows = screen.getAllByRole("row").map((r) => r.textContent ?? "");
    expect(rows.some((r) => r.includes("Limestone") && r.includes("30"))).toBe(true);
    expect(rows.some((r) => r.includes("Iron Ore") && r.includes("120"))).toBe(true);
  });

  it("draws card text at the readable sizes, and edge labels as an item bubble over halo rate text with a named class", async () => {
    const svg = await openGraph();
    expect(svg.querySelector("text.text-base.font-semibold")).not.toBeNull();
    const label = [...svg.querySelectorAll("[data-edge-label] > text")].find((t) => t.textContent === "120 items/min")!;
    expect(label).toHaveClass("text-sm", "paint-stroke-first");
    // The item is its icon, and its name is in the tooltip, not printed.
    const row = label.closest("[data-edge-label]")!;
    expect(row.querySelector('[data-bubble="Desc_OreIron_C"] image')?.getAttribute("href")).toMatch(/\/items\/iron-new-32\.webp$/);
    expect(row.querySelector("title")?.textContent).toContain("Iron Ore");
    expect(label.getAttribute("class")).not.toContain("[paint-order");
    // One line of plain text under each icon row: nothing is muted any more.
    expect(svg.querySelectorAll("text.fill-muted").length).toBe(0);
  });

  it("is icon-first: every card has a large icon or a glyph, a count and one line, and the full words in its tooltip", async () => {
    const svg = await openGraph();
    const cards = [...svg.querySelectorAll("[data-card]")];
    expect(cards).toHaveLength(5);
    for (const card of cards) {
      expect(card.querySelectorAll("[data-icon]")).toHaveLength(1);
      expect(card.querySelectorAll("[data-count]")).toHaveLength(1);
      // One line, except storage, which makes nothing: its icon says what it is (the owner, 2026-10-27).
      const storage = /^(storage|Build_Storage)/i.test(card.getAttribute("data-node") ?? "");
      expect(card.querySelectorAll(":scope > text")).toHaveLength(storage ? 0 : 1);
      // Storage's tooltip is its name alone ("2× Storage", with no output words); every other card's says more.
      expect(card.querySelector(":scope > title")?.textContent?.length).toBeGreaterThan(storage ? 0 : 20);
    }
    // The icon is 40 units, not the 18 of a title-row icon.
    expect(svg.querySelector("[data-card] image")).toHaveAttribute("width", "40");
    // The recipe is in the tooltip, not printed.
    const plates = cards.find((c) => c.querySelector("title")?.textContent?.startsWith("8× Constructor, Iron Plate"))!;
    expect(plates.querySelector("title")?.textContent).toContain("In a loop");
    expect(plates.textContent).toContain("×8");
    expect(plates.querySelector(":scope > text")?.textContent).toMatch(/^Iron Plate · /);
  });

  it("draws the kind's glyph in place of an icon that is missing or fails to load, never a bare box", async () => {
    const svg = await openGraph();
    const images = [...svg.querySelectorAll("[data-card] image")];
    expect(images.length).toBeGreaterThan(0);
    const before = svg.querySelectorAll('[data-icon="glyph"]').length;
    fireEvent.error(images[0]);
    expect(svg.querySelectorAll('[data-icon="glyph"]').length).toBe(before + 1);
    expect(svg.querySelectorAll("[data-card] image")).toHaveLength(images.length - 1);
    for (const g of svg.querySelectorAll('[data-icon="glyph"]')) expect(g.querySelector("[data-building-glyph]")).not.toBeNull();
  });

  it("draws an item bubble's initials when its icon fails to load, never a blank disc (ADR-0060)", async () => {
    const svg = await openGraph();
    const bubble = svg.querySelector('[data-bubble="Desc_OreIron_C"]')!;
    expect(bubble).toHaveAttribute("data-icon", "image");
    fireEvent.error(bubble.querySelector("image")!);
    expect(bubble).toHaveAttribute("data-icon", "text");
    expect(bubble.querySelector("image")).toBeNull();
    expect(bubble.querySelector("text")?.textContent).toBe("IO");
  });

  it("says how to see more only while the drawing runs past the canvas, and fades the clipped edges", async () => {
    const svg = await openGraph();
    const hint = "Drag or use the arrow keys to see more →";
    const fades = () => [...document.querySelectorAll("[data-fade]")].filter((f) => f.getAttribute("data-clipped") === "true").map((f) => f.getAttribute("data-fade"));
    // The compact cards fit jsdom's 1000 x 600 stage whole; zoom in until the drawing runs past the canvas, so the hint
    // and the fades come.
    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText(hint)).toBeInTheDocument();
    expect(fades().length).toBeGreaterThan(0);
    for (const f of document.querySelectorAll("[data-fade]")) {
      expect(f).toHaveAttribute("aria-hidden", "true");
      expect(f.getAttribute("style")).toBeNull();
    }
    // Zoomed out to fit inside, nothing is clipped and the hint goes.
    const zoomOut = screen.getByRole("button", { name: "Zoom out" });
    for (let i = 0; i < 12; i++) fireEvent.click(zoomOut);
    expect(scaleOf(svg)).toBeLessThan(0.5);
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
    expect(fades()).toEqual([]);
    for (let i = 0; i < 12; i++) fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText(hint)).toBeInTheDocument();
    expect(fades().length).toBeGreaterThan(1);
  });

});

describe("the floating group panel (the owner, 2026-10-27: an overlay, not a full-height drawer)", () => {
  const nums = (re: RegExp, s: string) => re.exec(s)!.slice(1).map(Number);
  /** A card's box on screen (stage px): its translate inside the drawing, through the view's translate and scale. */
  const cardRect = (svg: HTMLElement, text: string) => {
    const g = [...svg.querySelectorAll("[data-node]")].find((el) => el.textContent?.includes(text))!;
    const [x, y] = nums(/translate\((-?[\d.e-]+) (-?[\d.e-]+)\)/, g.getAttribute("transform")!);
    const [vx, vy, k] = nums(/translate\((-?[\d.e-]+) (-?[\d.e-]+)\) scale\(([\d.e-]+)\)/, transformOf(svg));
    const rect = g.querySelector("rect.fill-surface-2")!;
    return { left: vx + x! * k!, top: vy + y! * k!, width: Number(rect.getAttribute("width")) * k!, height: Number(rect.getAttribute("height")) * k! };
  };
  const overlayBox = () => {
    const fo = document.querySelector("[data-overlay] foreignObject")!;
    const [x, y, width, height] = ["x", "y", "width", "height"].map((a) => Number(fo.getAttribute(a)));
    return { fo, x: x!, y: y!, width: width!, height: height! };
  };
  const covers = (o: ReturnType<typeof overlayBox>, c: ReturnType<typeof cardRect>) =>
    o.x < c.left + c.width && c.left < o.x + o.width && o.y < c.top + c.height && c.top < o.y + o.height;
  const largeScreen = () =>
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("min-width"), addEventListener: () => {}, removeEventListener: () => {} }));
  /** jsdom lays nothing out: every element says it is `h` tall, so the content measures `h` and the frame has no border. */
  const contentHeight = (h: number) => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(h);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(h);
  };
  afterEach(() => vi.restoreAllMocks());

  it("from lg stands beside the clicked card, as tall as its content, placed by SVG attributes only", async () => {
    largeScreen();
    contentHeight(200);
    const svg = await openGraph();
    fireEvent.click(await groupButton(/Miner Mk\.2/));
    const panel = await screen.findByRole("complementary", { name: "Miner Mk.2" });
    const o = overlayBox();
    expect(o.fo.contains(panel)).toBe(true);
    expect(o.height).toBe(200);
    expect(o.width).toBe(352);
    expect(["right", "left", "below", "above"]).toContain(o.fo.getAttribute("data-side"));
    expect(covers(o, cardRect(svg, "Miner Mk.2"))).toBe(false);
    // No fixed full height: the frame and the panel fill the foreignObject, which is the content's height (above).
    const frame = o.fo.firstElementChild!;
    expect(frame.className).not.toMatch(/inset-y-0|h-screen|min-h/);
    expect(panel.className).not.toMatch(/inset-y-0|h-screen|min-h/);
    // The CSP forbids inline styles: nothing in the overlay carries one.
    const overlay = document.querySelector("[data-overlay]")!;
    expect([overlay, ...overlay.querySelectorAll("*")].every((el) => el.getAttribute("style") === null)).toBe(true);
  });

  it("caps its height inside the canvas and scrolls past it", async () => {
    largeScreen();
    contentHeight(5000);
    await openGraph();
    fireEvent.click(await groupButton(/Miner Mk\.2/));
    await screen.findByRole("complementary");
    const o = overlayBox();
    // jsdom's stage is 1000 x 600; the margin is 12 px each side.
    expect(o.height).toBe(600 - 24);
  });

  it("keeps the heading and Close outside the part that scrolls, and marks the scroll", async () => {
    contentHeight(100);
    await openGraph();
    fireEvent.click(await groupButton(/Miner Mk\.2/));
    const panel = await screen.findByRole("complementary", { name: "Miner Mk.2" });
    const o = overlayBox();
    // The shadow is not clipped to the foreignObject's box, and the frame's edge reads over the lines without it.
    expect(o.fo).toHaveClass("overflow-visible");
    const frame = o.fo.firstElementChild as HTMLElement;
    expect(frame).toHaveClass("border-info-edge", "overflow-hidden");
    const header = panel.querySelector("[data-overlay-header]")!;
    const body = panel.querySelector("[data-overlay-body]") as HTMLElement;
    expect(body).toHaveClass("overflow-y-auto");
    expect(body.contains(header)).toBe(false);
    expect(within(header as HTMLElement).getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(within(header as HTMLElement).getByRole("heading", { name: "Miner Mk.2" })).toBeInTheDocument();
    expect(body.contains(within(panel).getByText(/^\d+ machines? · /))).toBe(true);
    // Not scrolled, nothing below: no rule under the header, no fade.
    expect(frame).not.toHaveAttribute("data-scrolled");
    expect(frame.querySelector("[data-overlay-more]")).toBeNull();
    // More below the cap: the fade shows; scrolled down, the header draws its rule (group-data-scrolled).
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(400);
    fireEvent.scroll(body);
    expect(frame.querySelector("[data-overlay-more]")).toHaveClass("opacity-100");
    vi.spyOn(HTMLElement.prototype, "scrollTop", "get").mockReturnValue(50);
    fireEvent.scroll(body);
    expect(frame).toHaveAttribute("data-scrolled", "true");
    expect(header).toHaveClass("group-data-scrolled:border-line");
  });

  it("follows the card when the view pans", async () => {
    largeScreen();
    contentHeight(100);
    await openGraph();
    fireEvent.click(await groupButton(/Miner Mk\.2/));
    await screen.findByRole("complementary");
    const before = overlayBox();
    const viewport = screen.getByRole("group", { name: /^Graph viewport/ });
    fireEvent.keyDown(viewport, { key: "ArrowDown" });
    const after = overlayBox();
    expect(after.y).not.toBe(before.y);
    expect(screen.getByRole("complementary")).toBeInTheDocument();
  });

  it("below lg lies over the canvas's bottom (not stacked under it), and the view moves so the card stays clear", async () => {
    const svg = await openGraph();
    fireEvent.click(await groupButton(/Storage/));
    const panel = await screen.findByRole("complementary");
    const o = overlayBox();
    expect(o.fo.getAttribute("data-side")).toBe("bottom");
    // Unmeasured in jsdom, it takes the most it may: half the 600 px stage, its bottom 12 px above the canvas's.
    expect(o.height).toBe(300);
    expect(o.y + o.height).toBe(600 - 12);
    // Capped at the token's width, centred on the 1000 px stage (not a banner across it).
    expect(o.width).toBe(352);
    expect(o.x).toBe((1000 - 352) / 2);
    // Inside the canvas's box: the overlay svg sits over the viewport, in the same positioned wrapper.
    const overlay = document.querySelector("[data-overlay]")!;
    expect(overlay).toHaveClass("absolute", "inset-0");
    expect(overlay.parentElement!.contains(screen.getByRole("group", { name: /^Graph viewport/ }))).toBe(true);
    expect(covers(o, cardRect(svg, "Storage"))).toBe(false);
    expect(panel.contains(document.activeElement)).toBe(true);
  });

  it("closes on a click on the canvas's background, not on a card; focus stays on the canvas", async () => {
    const svg = await openGraph();
    fireEvent.click(await groupButton(/Miner Mk\.2/));
    await screen.findByRole("complementary", { name: "Miner Mk.2" });
    // A click on a card is not the background: it opens that card instead.
    const card = [...svg.querySelectorAll("[data-node]")].find((el) => el.textContent?.includes("Storage"))!;
    fireEvent.click(card.querySelector("rect")!);
    expect(await screen.findByRole("complementary")).not.toHaveAccessibleName("Miner Mk.2");
    fireEvent.click(svg);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: /^Graph viewport/ })).toHaveFocus();
  });

  it("closes with Escape from the canvas too, handing focus back to the card", async () => {
    await openGraph();
    const button = await groupButton(/^Miner Mk\.2\b/);
    fireEvent.click(button);
    await screen.findByRole("complementary");
    fireEvent.keyDown(screen.getByRole("group", { name: /^Graph viewport/ }), { key: "Escape" });
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });
});
