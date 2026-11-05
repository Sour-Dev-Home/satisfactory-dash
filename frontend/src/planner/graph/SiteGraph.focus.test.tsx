import { act, fireEvent, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { productionGraphTwoSites, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../../servers/ServerContext";
import { renderWithClient } from "../../test/render";
import { server } from "../../test/server";
import { PlannerView } from "../PlannerView";
import { FOCUS_CARD_H, FOCUS_CARD_W, clearLayoutMemo } from "./layoutSite";
import { ITEM_FOCUS_KEY } from "./plannerPrefs";

// ADR-0060 build PR 3: focusing a link's item bubble, behind the `planner.itemFocus` flag (off by default).

beforeEach(() => window.localStorage.clear());
afterEach(() => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0))));

const data = productionGraphTwoSites.data;
/** The first link (Miner to Smelters) carries three more items: with ports, a line each (ADR-0063, one line per item). */
const extra = (className: string, itemName: string, ratePerMinute: number) => ({ ...data.edges[0], itemClassName: className, itemName, ratePerMinute, rate: "measured" as const });
const withFourItems = { ...productionGraphTwoSites, data: { ...data, edges: [...data.edges, extra("Desc_Stone_C", "Limestone", 30), extra("Desc_Coal_C", "Coal", 20), extra("Desc_Sulfur_C", "Sulfur", 10)] } };
/**
 * Every line here draws end labels beside its ports and no middle bubble (ADR-0063 Decision 2). This one gives the Iron Ore
 * line a rate too wide for a label's rate row, so its labels do not fit and it draws its middle bubble (the fallback), where
 * ADR-0060's drawn bubble, its make-room and its morph apply as before.
 */
const withOreBubble = {
  ...productionGraphTwoSites,
  data: { ...data, edges: data.edges.map((e) => (e.itemClassName === "Desc_OreIron_C" ? { ...e, ratePerMinute: 123456789012.5 } : e)) },
};

let client: ReturnType<typeof renderWithClient>["client"];

async function openGraph({ flag, fourItems = false, oreBubble = false }: { flag: boolean; fourItems?: boolean; oreBubble?: boolean }) {
  if (flag) window.localStorage.setItem(ITEM_FOCUS_KEY, "on");
  if (fourItems) server.use(http.get(endpoints.productionGraph.route, () => HttpResponse.json(withFourItems)));
  if (oreBubble) server.use(http.get(endpoints.productionGraph.route, () => HttpResponse.json(withOreBubble)));
  ({ client } = renderWithClient(
    <MemoryRouter>
      <ServerContext value={serversSingle.servers[0]}>
        <PlannerView />
      </ServerContext>
    </MemoryRouter>,
  ));
  fireEvent.click(await screen.findByRole("button", { name: "Open site: Iron Plate site" }));
  fireEvent.click(await screen.findByRole("button", { name: "Graph" }));
  return screen.findByRole("img", { name: /^Graph of Iron Plate site/ }, { timeout: 3_000 });
}

const bubbleList = () => screen.queryByRole("list", { name: "Items on the lines" });
const dimmed = (svg: HTMLElement, selector: string) => [...svg.querySelectorAll(selector)].filter((g) => g.hasAttribute("data-dim")).length;
const ironOreButton = () => screen.getByRole("button", { name: /^Iron Ore, 120 items\/min, from / });
/** The open item card (ADR-0060 build PR 5): drawn while an item is in focus, at its line's label box. */
const itemCard = (svg: HTMLElement) => svg.querySelector("[data-item-card]:not([data-closing])");
const oreLabel = (svg: HTMLElement) => svg.querySelector('[data-end-label="c:Desc_OreIron_C"]');
const litLines = (svg: HTMLElement) =>
  [...svg.querySelectorAll('[data-edge-layer="lines"] [data-edge]')].filter((g) => !g.hasAttribute("data-dim")).map((g) => g.querySelector("title")?.textContent ?? "");

describe("item focus, flag off (the default)", () => {
  it("adds no buttons and no click, and the status line says nothing: the bubbles and end labels are only a picture", async () => {
    const svg = await openGraph({ flag: false, oreBubble: true });
    expect(bubbleList()).toBeNull();
    const bubble = svg.querySelector('[data-bubble="Desc_OreIron_C"]')!;
    const label = svg.querySelector("[data-end-label]")!;
    for (const drawn of [bubble, label]) {
      expect(drawn).not.toHaveClass("cursor-pointer");
      fireEvent.click(drawn);
    }
    expect(svg.querySelector("[data-focused]")).toBeNull();
    expect(itemCard(svg)).toBeNull();
    expect(dimmed(svg, "[data-card]")).toBe(0);
    // The status line stays mounted since the ports flag went (ADR-0063 build PR 7), empty here.
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

describe("item focus, flag on", () => {
  it("gives every bubble a named button behind one tab stop, moved by the arrow keys", async () => {
    await openGraph({ flag: true });
    const buttons = within(bubbleList()!).getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(1);
    expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute("tabindex", "0");
    expect(buttons[0]).toHaveAttribute("aria-expanded", "false");
    act(() => buttons[0].focus());
    fireEvent.keyDown(buttons[0], { key: "ArrowRight" });
    expect(buttons[1]).toHaveFocus();
    fireEvent.keyDown(buttons[1], { key: "ArrowLeft" });
    expect(buttons[0]).toHaveFocus();
    fireEvent.keyDown(buttons[0], { key: "End" });
    expect(buttons.at(-1)).toHaveFocus();
    // The last one focused keeps the tab stop.
    expect(buttons.at(-1)).toHaveAttribute("tabindex", "0");
    expect(buttons[0]).toHaveAttribute("tabindex", "-1");
  });

  it("focuses an item on Enter: its line and two cards stay lit, the rest dims, and the status line says so", async () => {
    const svg = await openGraph({ flag: true });
    const button = ironOreButton();
    act(() => button.focus());
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    // Its line draws end labels, so no bubble: the item's card opens at the line's box, and only its line stays lit.
    expect(itemCard(svg)).toHaveAttribute("data-item-card", "Desc_OreIron_C");
    expect(litLines(svg)).toEqual([expect.stringMatching(/: Iron Ore · /)]);
    expect(oreLabel(svg)).not.toHaveAttribute("data-dim");
    const cards = svg.querySelectorAll("[data-card]");
    expect(cards.length - dimmed(svg, "[data-card]")).toBe(2);
    expect(screen.getByRole("status")).toHaveTextContent(/Focused Iron Ore from .+ to .+/);
  });

  it("leaves focus on Escape, back to the bubble's button, and says Overview", async () => {
    const svg = await openGraph({ flag: true });
    const button = ironOreButton();
    act(() => button.focus());
    fireEvent.click(button);
    expect(itemCard(svg)).not.toBeNull();
    fireEvent.keyDown(button, { key: "Escape" });
    expect(itemCard(svg)).toBeNull();
    expect(dimmed(svg, "[data-card]")).toBe(0);
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("status")).toHaveTextContent("Overview");
  });

  it("focuses on a click on an end label, toggles on a second, and leaves on a background click", async () => {
    const svg = await openGraph({ flag: true });
    const label = () => oreLabel(svg)!;
    expect(label()).toHaveAttribute("data-lines", "1");
    expect(label()).toHaveClass("cursor-pointer");
    fireEvent.click(label());
    expect(itemCard(svg)).toHaveAttribute("data-item-card", "Desc_OreIron_C");
    fireEvent.click(label());
    expect(itemCard(svg)).toBeNull();
    fireEvent.click(label());
    // A click on a card keeps focus; one on the background leaves it.
    fireEvent.click(svg.querySelector("[data-card]")!);
    expect(itemCard(svg)).not.toBeNull();
    fireEvent.click(svg);
    expect(itemCard(svg)).toBeNull();
  });

  it("focuses on a click on a fallback line's drawn bubble, toggles on a second, and leaves on a background click", async () => {
    const svg = await openGraph({ flag: true, oreBubble: true });
    const bubble = () => svg.querySelector('[data-bubble="Desc_OreIron_C"]')!;
    expect(bubble()).toHaveClass("cursor-pointer");
    fireEvent.click(bubble());
    expect(bubble()).toHaveAttribute("data-focused", "true");
    fireEvent.click(bubble());
    expect(svg.querySelector("[data-focused]")).toBeNull();
    fireEvent.click(bubble());
    fireEvent.click(svg.querySelector("[data-card]")!);
    expect(svg.querySelector("[data-focused]")).not.toBeNull();
    fireEvent.click(svg);
    expect(svg.querySelector("[data-focused]")).toBeNull();
  });

  // ADR-0060's "+k" chip was a line's way to items past its third bubble; with ports a line carries one item (ADR-0063), so
  // four items between the same cards are four lines, each with its own button and no chip.
  it("draws a line per item between the same two cards, each item its own button and none behind a chip", async () => {
    const svg = await openGraph({ flag: true, fourItems: true });
    expect(svg.querySelector("[data-bubble-more]")).toBeNull();
    expect(screen.queryByRole("button", { name: /more items? from / })).toBeNull();
    const fromMiner = [...svg.querySelectorAll('[data-edge-layer="lines"] [data-edge] > title')].filter((t) => /^Miner Mk\.2 to 4× Smelter: /.test(t.textContent ?? ""));
    expect(fromMiner.map((t) => /: ([^·]+) · /.exec(t.textContent!)![1].trim()).sort()).toEqual(["Coal", "Iron Ore", "Limestone", "Sulfur"]);
    // The fourth item has its own button: focusing it lights its line alone, and Escape hands the keyboard back to it.
    const sulfur = screen.getByRole("button", { name: /^Sulfur, 10 items\/min, from / });
    act(() => sulfur.focus());
    fireEvent.click(sulfur);
    expect(screen.getByRole("status")).toHaveTextContent(/Focused Sulfur from /);
    expect(litLines(svg)).toEqual([expect.stringMatching(/: Sulfur · /)]);
    expect(dimmed(svg, "[data-card]")).toBeGreaterThan(0);
    fireEvent.keyDown(sulfur, { key: "Escape" });
    expect(itemCard(svg)).toBeNull();
    expect(dimmed(svg, "[data-card]")).toBe(0);
    expect(sulfur).toHaveFocus();
  });

  it("swaps a port's line list and the group panel in one overlay, and a background click closes either", async () => {
    const svg = await openGraph({ flag: true });
    const several = () => svg.querySelector('[data-end-label]:not([data-lines="1"])')!;
    fireEvent.click(several());
    const list = screen.getByRole("region", { name: /^\d+ lines of / });
    // It floats over the canvas in the group panel's place (CanvasOverlay), not in a drawer or stacked under it.
    expect(list.closest("[data-overlay] foreignObject")).not.toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /Miner|Smelter|Constructor|Storage|Assembler/ })[0]!);
    expect(screen.queryByRole("region", { name: /^\d+ lines of / })).toBeNull();
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-overlay]")).toHaveLength(1);
    // The panel replaced the list for good: closing the panel does not bring the list back (it used to, hidden underneath).
    fireEvent.click(within(screen.getByRole("complementary")).getAllByRole("button", { name: /^Close/ })[0]!);
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByRole("region", { name: /^\d+ lines of / })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /Miner|Smelter|Constructor|Storage|Assembler/ })[0]!);
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    // And the label's next click opens the list at once, in the panel's place.
    fireEvent.click(several());
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.getByRole("region", { name: /^\d+ lines of / })).toBeInTheDocument();
    expect(document.querySelectorAll("[data-overlay]")).toHaveLength(1);
    fireEvent.click(svg);
    expect(document.querySelector("[data-overlay]")).toBeNull();
  });

  it("keeps the arrow keys inside the bubble buttons: the viewport never sees them", async () => {
    await openGraph({ flag: true });
    const buttons = within(bubbleList()!).getAllByRole("button");
    act(() => buttons[0].focus());
    for (const key of ["ArrowRight", "ArrowDown", "Home", "End"]) expect(fireEvent.keyDown(buttons[0], { key })).toBe(false);
    expect(fireEvent.keyDown(buttons[0], { key: "ArrowLeft", ctrlKey: true })).toBe(true);
  });

  it("survives a poll that reorders the edges, and clears when its line leaves the graph", async () => {
    const svg = await openGraph({ flag: true });
    fireEvent.click(ironOreButton());
    expect(itemCard(svg)).not.toBeNull();
    server.use(http.get(endpoints.productionGraph.route, () => HttpResponse.json({ ...productionGraphTwoSites, data: { ...data, edges: [...data.edges].reverse() } })));
    await act(() => client.invalidateQueries());
    expect(itemCard(svg)).toHaveAttribute("data-item-card", "Desc_OreIron_C");
    expect(litLines(svg)).toEqual([expect.stringMatching(/: Iron Ore · /)]);
    expect(screen.getByRole("status")).toHaveTextContent(/Focused Iron Ore/);
    server.use(http.get(endpoints.productionGraph.route, () => HttpResponse.json({ ...productionGraphTwoSites, data: { ...data, edges: data.edges.filter((e) => e.itemClassName !== "Desc_OreIron_C") } })));
    await act(() => client.invalidateQueries());
    expect(svg.querySelector("[data-item-card]")).toBeNull();
    expect(dimmed(svg, "[data-card]")).toBe(0);
    // Focus that a poll ended is said, as one left by Escape is.
    expect(screen.getByRole("status")).toHaveTextContent("Overview");
  });
});

describe("make room (ADR-0060 build PR 4), flag on", () => {
  /** The view's transform, and where a bubble's centre lands on the stage under it. */
  const viewOf = (svg: HTMLElement) => {
    const [, x, y, k] = /translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(svg.querySelector(":scope > g")!.getAttribute("transform")!)!.map(Number);
    return { x, y, k };
  };
  const onStage = (svg: HTMLElement, selector: string) => {
    const circle = svg.querySelector(`${selector} circle`)!;
    const v = viewOf(svg);
    return { x: v.x + Number(circle.getAttribute("cx")) * v.k, y: v.y + Number(circle.getAttribute("cy")) * v.k };
  };
  const cards = (svg: HTMLElement) => Object.fromEntries([...svg.querySelectorAll("[data-node]")].map((g) => [g.getAttribute("data-node"), g.getAttribute("transform")]));
  // On the fallback line, whose drawn bubble marks the box make-room keeps in place (an end-labelled line keeps the same,
  // undrawn, box).
  const iron = '[data-bubble="Desc_OreIron_C"]';

  it("moves the cards aside for the focused line, keeping its bubble where it was on screen and the zoom as it was", async () => {
    const svg = await openGraph({ flag: true, oreBubble: true });
    const before = { cards: cards(svg), at: onStage(svg, iron), k: viewOf(svg).k };
    fireEvent.click(svg.querySelector(iron)!);
    expect(svg.querySelector(`${iron}[data-focused]`)).not.toBeNull();
    expect(cards(svg)).not.toEqual(before.cards);
    expect(viewOf(svg).k).toBe(before.k);
    const at = onStage(svg, iron);
    expect(at.x).toBeCloseTo(before.at.x, 6);
    expect(at.y).toBeCloseTo(before.at.y, 6);
  });

  it("puts every card back where it was on leaving, keeping the bubble in place and the zoom", async () => {
    const svg = await openGraph({ flag: true, oreBubble: true });
    const before = cards(svg);
    const k = viewOf(svg).k;
    fireEvent.click(svg.querySelector(iron)!);
    const focused = onStage(svg, iron);
    fireEvent.keyDown(screen.getByRole("group", { name: /^Graph viewport/ }), { key: "Escape" });
    expect(svg.querySelector("[data-focused]")).toBeNull();
    expect(cards(svg)).toEqual(before);
    expect(viewOf(svg).k).toBe(k);
    const at = onStage(svg, iron);
    expect(at.x).toBeCloseTo(focused.x, 6);
    expect(at.y).toBeCloseTo(focused.y, 6);
  });

  it("only dims when the room-making layout would take over the budget: no card moves", async () => {
    const svg = await openGraph({ flag: true, oreBubble: true });
    const before = cards(svg);
    // Every reading of the clock is 150 ms after the last: the next layout dagre runs takes "150 ms". The memo is module
    // state, so an earlier test's focused layout (and its real time) is forgotten first.
    clearLayoutMemo();
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => (now += 150));
    try {
      fireEvent.click(svg.querySelector(iron)!);
    } finally {
      clock.mockRestore();
    }
    expect(svg.querySelector(`${iron}[data-focused]`)).not.toBeNull();
    expect(dimmed(svg, "[data-card]")).toBeGreaterThan(0);
    expect(cards(svg)).toEqual(before);
  });
});

describe("the detail card (ADR-0060 build PR 5), flag on", () => {
  const cardEl = (svg: HTMLElement) => svg.querySelector("[data-item-card]");
  /** Its line draws end labels: a click on the miner's port label focuses its item (ADR-0063 Decision 2). */
  const focusOre = (svg: HTMLElement) => fireEvent.click(oreLabel(svg)!);

  it("opens on focus: the item's 128 px icon, its name, its rate and ends, at the card's size, over the cards", async () => {
    const svg = await openGraph({ flag: true });
    focusOre(svg);
    const card = cardEl(svg)!;
    expect(card).toHaveAttribute("data-item-card", "Desc_OreIron_C");
    expect(card.querySelector("image")?.getAttribute("href")).toMatch(/\/items\/iron-new-128\.webp$/);
    const box = card.querySelector(":scope > rect")!;
    expect(box).toHaveAttribute("width", String(FOCUS_CARD_W));
    expect(box).toHaveAttribute("height", String(FOCUS_CARD_H));
    expect(card.textContent).toContain("Iron Ore");
    expect(card.textContent).toContain("120 items/min");
    expect(card.textContent).toMatch(/From .+To /);
    // Drawn after every card, so no card covers it.
    const lastCard = [...svg.querySelectorAll("[data-card]")].at(-1)!;
    expect(lastCard.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The keyboard's copy: the card's words and its controls, in the DOM layer.
    const group = screen.getByRole("group", { name: "Iron Ore card" });
    expect(group).toHaveTextContent(/Iron Ore\. 120 items\/min\. From .+\. To .+/);
  });

  it("closes from its drawn close control and from the keyboard's button, back to the bubble's button", async () => {
    const svg = await openGraph({ flag: true });
    focusOre(svg);
    fireEvent.click(cardEl(svg)!.querySelector("[data-card-close]")!);
    expect(litLines(svg)).toHaveLength(svg.querySelectorAll('[data-edge-layer="lines"] [data-edge]').length);
    expect(cardEl(svg)).toBeNull();
    const bubble = ironOreButton();
    act(() => bubble.focus());
    fireEvent.click(bubble);
    fireEvent.click(screen.getByRole("button", { name: "Close Iron Ore card" }));
    expect(cardEl(svg)).toBeNull();
    expect(bubble).toHaveFocus();
  });

  it("keeps focus on a click inside the card; leaves it on the background", async () => {
    const svg = await openGraph({ flag: true });
    focusOre(svg);
    fireEvent.click(cardEl(svg)!.querySelector(":scope > rect")!);
    expect(cardEl(svg)).not.toBeNull();
    fireEvent.click(svg);
    expect(cardEl(svg)).toBeNull();
  });

  it("shows the whole path: the item filter takes over from focus", async () => {
    const svg = await openGraph({ flag: true });
    focusOre(svg);
    fireEvent.click(cardEl(svg)!.querySelector("[data-show-path]")!);
    expect(cardEl(svg)).toBeNull();
    expect(screen.getByRole("button", { name: /^Iron Ore, 120 items\/min, from / })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("combobox", { name: "Item" })).toHaveValue("Desc_OreIron_C");
    expect(screen.getByRole("status")).toHaveTextContent("carry or feed this item");
  });

  it("says 'Item unknown' for an unknown item's line, never a made-up name, and offers no path to show", async () => {
    const unknown = { ...data.edges[0], itemClassName: null, itemName: null, ratePerMinute: null, rate: "unknown" as const };
    server.use(http.get(endpoints.productionGraph.route, () => HttpResponse.json({ ...productionGraphTwoSites, data: { ...data, edges: [...data.edges, unknown] } })));
    const svg = await openGraph({ flag: true });
    // Its own line (one item per line), whose port labels say "Item unknown".
    const label = [...svg.querySelectorAll("[data-end-label]")].find((l) => l.querySelector("text")?.textContent === "Item unknown");
    expect(label).toBeDefined();
    fireEvent.click(label!);
    const card = cardEl(svg)!;
    expect(card).toHaveAttribute("data-item-card", "unknown");
    expect(card.textContent).toContain("Item unknown");
    expect(card.textContent).toContain("Not reported by the game");
    expect(card.querySelector("[data-show-path]")).toBeNull();
    expect(screen.getByRole("group", { name: "Item unknown card" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Show the whole path/ })).toBeNull();
  });
});
