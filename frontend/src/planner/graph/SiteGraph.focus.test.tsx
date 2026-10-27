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
import { clearLayoutMemo } from "./layoutSite";
import { ITEM_FOCUS_KEY } from "./plannerPrefs";

// ADR-0060 build PR 3: focusing a link's item bubble, behind the `planner.itemFocus` flag (off by default).

beforeEach(() => window.localStorage.clear());
afterEach(() => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0))));

const data = productionGraphTwoSites.data;
/** The first link carries three more items, so its line shows three bubbles and a "+1" chip. */
const extra = (className: string, itemName: string, ratePerMinute: number) => ({ ...data.edges[0], itemClassName: className, itemName, ratePerMinute, rate: "measured" as const });
const withFourItems = { ...productionGraphTwoSites, data: { ...data, edges: [...data.edges, extra("Desc_Stone_C", "Limestone", 30), extra("Desc_Coal_C", "Coal", 20), extra("Desc_Sulfur_C", "Sulfur", 10)] } };

let client: ReturnType<typeof renderWithClient>["client"];

async function openGraph({ flag, fourItems = false }: { flag: boolean; fourItems?: boolean }) {
  if (flag) window.localStorage.setItem(ITEM_FOCUS_KEY, "on");
  if (fourItems) server.use(http.get(endpoints.productionGraph.route, () => HttpResponse.json(withFourItems)));
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
const dimmed = (svg: HTMLElement, selector: string) => [...svg.querySelectorAll(selector)].filter((g) => g.classList.contains("opacity-graph-dim")).length;
const ironOreButton = () => screen.getByRole("button", { name: /^Iron Ore, 120 items\/min, from / });

describe("item focus, flag off (the default)", () => {
  it("adds no buttons, no click and no status line: the bubbles are only a picture", async () => {
    const svg = await openGraph({ flag: false });
    expect(bubbleList()).toBeNull();
    const bubble = svg.querySelector('[data-bubble="Desc_OreIron_C"]')!;
    expect(bubble).not.toHaveClass("cursor-pointer");
    fireEvent.click(bubble);
    expect(svg.querySelector("[data-focused]")).toBeNull();
    expect(dimmed(svg, "[data-card]")).toBe(0);
    expect(screen.queryByRole("status")).toBeNull();
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
    expect(svg.querySelector('[data-focused] ')?.getAttribute("data-bubble")).toBe("Desc_OreIron_C");
    const label = svg.querySelector('[data-focused]')!.closest("[data-edge-label]")!;
    expect(label).not.toHaveClass("opacity-graph-dim");
    const labels = svg.querySelectorAll("[data-edge-label]");
    expect(dimmed(svg, "[data-edge-label]")).toBe(labels.length - 1);
    const cards = svg.querySelectorAll("[data-card]");
    expect(cards.length - dimmed(svg, "[data-card]")).toBe(2);
    expect(screen.getByRole("status")).toHaveTextContent(/Focused Iron Ore from .+ to .+/);
  });

  it("leaves focus on Escape, back to the bubble's button, and says Overview", async () => {
    const svg = await openGraph({ flag: true });
    const button = ironOreButton();
    act(() => button.focus());
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "Escape" });
    expect(svg.querySelector("[data-focused]")).toBeNull();
    expect(dimmed(svg, "[data-card]")).toBe(0);
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("status")).toHaveTextContent("Overview");
  });

  it("focuses on a click on the drawn bubble, toggles on a second, and leaves on a background click", async () => {
    const svg = await openGraph({ flag: true });
    const bubble = () => svg.querySelector('[data-bubble="Desc_OreIron_C"]')!;
    fireEvent.click(bubble());
    expect(bubble()).toHaveAttribute("data-focused", "true");
    fireEvent.click(bubble());
    expect(svg.querySelector("[data-focused]")).toBeNull();
    fireEvent.click(bubble());
    // A click on a card keeps focus; one on the background leaves it.
    fireEvent.click(svg.querySelector("[data-card]")!);
    expect(svg.querySelector("[data-focused]")).not.toBeNull();
    fireEvent.click(svg);
    expect(svg.querySelector("[data-focused]")).toBeNull();
  });

  it("opens a line's full list from its +k chip; each item focuses, and Escape returns to the chip", async () => {
    const svg = await openGraph({ flag: true, fourItems: true });
    const chip = screen.getByRole("button", { name: /^1 more item from / });
    act(() => chip.focus());
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-expanded", "true");
    const list = screen.getByRole("region", { name: /^4 items from / });
    const rows = within(list).getAllByRole("button", { pressed: false });
    expect(rows.map((r) => r.getAttribute("aria-label")?.split(",")[0])).toEqual(["Iron Ore", "Limestone", "Coal", "Sulfur"]);
    expect(rows[0]).toHaveFocus();
    // The fourth item is only in the list: focusing it lights its line.
    fireEvent.click(rows[3]);
    expect(rows[3]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent(/Focused Sulfur from /);
    expect(dimmed(svg, "[data-card]")).toBeGreaterThan(0);
    fireEvent.keyDown(rows[3], { key: "Escape" });
    expect(screen.queryByRole("region", { name: /^4 items from / })).toBeNull();
    expect(chip).toHaveFocus();
    // Escape again leaves focus, back to the chip, since Sulfur has no bubble of its own.
    fireEvent.keyDown(chip, { key: "Escape" });
    expect(svg.querySelector("[data-focused]")).toBeNull();
    expect(dimmed(svg, "[data-card]")).toBe(0);
    expect(chip).toHaveFocus();
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
    expect(svg.querySelector("[data-focused]")).not.toBeNull();
    server.use(http.get(endpoints.productionGraph.route, () => HttpResponse.json({ ...productionGraphTwoSites, data: { ...data, edges: [...data.edges].reverse() } })));
    await act(() => client.invalidateQueries());
    expect(svg.querySelector('[data-focused][data-bubble="Desc_OreIron_C"]')).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(/Focused Iron Ore/);
    server.use(http.get(endpoints.productionGraph.route, () => HttpResponse.json({ ...productionGraphTwoSites, data: { ...data, edges: data.edges.filter((e) => e.itemClassName !== "Desc_OreIron_C") } })));
    await act(() => client.invalidateQueries());
    expect(svg.querySelector("[data-focused]")).toBeNull();
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
  const iron = '[data-bubble="Desc_OreIron_C"]';

  it("moves the cards aside for the focused line, keeping its bubble where it was on screen and the zoom as it was", async () => {
    const svg = await openGraph({ flag: true });
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
    const svg = await openGraph({ flag: true });
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
    const svg = await openGraph({ flag: true });
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
