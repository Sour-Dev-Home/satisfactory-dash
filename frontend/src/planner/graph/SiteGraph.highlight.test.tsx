import { act, fireEvent, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { endpoints, ProductionGraphResponseSchema } from "@satisfactory-dash/shared";
import { productionGraphTwoSites, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../../servers/ServerContext";
import { renderWithClient } from "../../test/render";
import { server } from "../../test/server";
import { PlannerView } from "../PlannerView";

// ADR-0063 amendment (2026-11-03): pointing at a line or a card highlights it (its rate rises in, the rest is covered), with
// the mouse only, all in the highlight layer over the canvas: the canvas itself is never touched.
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
});

const DATA = ProductionGraphResponseSchema.parse(productionGraphTwoSites).data;

async function openGraph() {
  server.use(http.get(endpoints.productionGraph.route, () => HttpResponse.json({ ...productionGraphTwoSites, data: DATA })));
  renderWithClient(
    <MemoryRouter>
      <ServerContext value={serversSingle.servers[0]}>
        <PlannerView />
      </ServerContext>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Open site: Iron Plate site" }));
  fireEvent.click(await screen.findByRole("button", { name: "Graph" }));
  return screen.findByRole("img", { name: /^Graph of Iron Plate site/ }, { timeout: 3_000 });
}

const layerOf = (svg: Element) => svg.parentElement!.querySelector("[data-highlight-layer]")!;
const lineOf = (svg: Element, words: RegExp) => [...svg.querySelectorAll('[data-edge-layer="lines"] [data-edge]')].find((g) => words.test(g.querySelector(":scope > title")?.textContent ?? ""))!;
const rates = (svg: Element) => [...layerOf(svg).querySelectorAll("[data-highlight-rate]")].map((t) => [t.getAttribute("data-highlight-rate"), t.textContent]);
const over = (el: Element, pointerType = "mouse") => act(() => void fireEvent.pointerOver(el, { pointerType, pointerId: 1 }));
const IRON_ORE = /: Iron Ore · 120 items\/min/;

/** The Iron Ore line's two end labels (ADR-0063 Decision 2: every line here draws them, and no middle bubble). */
const oreLabels = (svg: Element) => [...svg.querySelectorAll('[data-end-label="c:Desc_OreIron_C"]')];
const at = (t: Element) => [t.getAttribute("x"), t.getAttribute("y")];

describe("the canvas highlight", () => {
  it("draws every line's short rate in its end labels' rate rows, and a wider pointer target that draws nothing", async () => {
    const svg = await openGraph();
    expect(svg.querySelector("[data-edge-label] > text[data-rate]")).toBeNull();
    const texts = [...svg.querySelectorAll("[data-end-label] > text[data-rate]")].map((t) => t.textContent);
    expect(texts).toContain("120/min");
    expect(texts).toContain("~102.2/min");
    // No "about", no "items", no "per" on the canvas.
    for (const t of texts) expect(t).not.toMatch(/about|items|per/);
    const hit = lineOf(svg, IRON_ORE).querySelector(":scope > [data-line-hit]")!;
    expect(hit).toHaveClass("stroke-transparent");
    expect(Number(hit.getAttribute("stroke-width"))).toBeGreaterThan(6);
  });

  it("pointing at a line draws its rate and dims nothing; the canvas is untouched", async () => {
    const svg = await openGraph();
    const layer = layerOf(svg);
    expect(layer).toHaveAttribute("aria-hidden", "true");
    expect(layer).toHaveClass("pointer-events-none", "opacity-0");
    expect(layer.hasAttribute("data-highlight")).toBe(false);
    const canvas = svg.innerHTML;
    const line = lineOf(svg, IRON_ORE);
    const index = line.getAttribute("data-edge")!;
    over(line.querySelector("[data-line-hit]")!);
    expect(layer).toHaveAttribute("data-highlight");
    expect(layer).toHaveClass("opacity-100");
    // Once in each of its two end labels.
    expect(rates(svg)).toEqual([
      [index, "120/min"],
      [index, "120/min"],
    ]);
    // No dimming (the owner dropped it, 2026-11-03): the layer draws only the words, no cover, mask or shape.
    expect(layer.querySelectorAll("mask, rect, path")).toHaveLength(0);
    // Its rates sit exactly where the canvas keeps the labels' own (hidden) ones.
    const own = oreLabels(svg).map((l) => at(l.querySelector(":scope > text[data-rate]")!));
    expect(own).toHaveLength(2);
    expect([...layer.querySelectorAll("[data-highlight-rate]")].map(at)).toEqual(expect.arrayContaining(own));
    // Pointing at either of its labels is the same target: nothing changes.
    for (const l of oreLabels(svg)) {
      expect(l).toHaveAttribute("data-hl-edge", index);
      over(l.querySelector("text")!);
      expect(rates(svg)).toEqual([
        [index, "120/min"],
        [index, "120/min"],
      ]);
    }
    // The canvas did not render again or get a single attribute.
    expect(svg.innerHTML).toBe(canvas);
    act(() => void fireEvent.pointerLeave(svg, { pointerType: "mouse" }));
    expect(layer.hasAttribute("data-highlight")).toBe(false);
    expect(layer).toHaveClass("opacity-0");
    expect(svg.innerHTML).toBe(canvas);
  });

  it("pointing at a card draws the rate of every line it has, once in each of the line's end labels", async () => {
    const svg = await openGraph();
    const card = [...svg.querySelectorAll("g[data-card]")].find((g) => g.querySelector(":scope > title")?.textContent?.startsWith("8× Constructor"))!;
    over(card.querySelector("rect")!);
    const shown = rates(svg);
    const lines = new Set(shown.map(([i]) => i));
    expect(lines.size).toBeGreaterThan(1);
    for (const i of lines) expect(shown.filter(([j]) => j === i), `line ${i}`).toHaveLength(2);
    // Each is a line from or to the card: its tooltip names the card at one end.
    for (const i of lines) expect(svg.querySelector(`[data-edge="${i}"] > title`)?.textContent).toMatch(/Constructor/);
    // The background clears it.
    over(svg);
    expect(layerOf(svg).hasAttribute("data-highlight")).toBe(false);
  });

  it("ignores touch and pen pointers: a touch screen shows every rate at rest, and a tap is a click", async () => {
    const svg = await openGraph();
    over(lineOf(svg, IRON_ORE).querySelector("[data-line-hit]")!, "touch");
    over(lineOf(svg, IRON_ORE).querySelector("[data-line-hit]")!, "pen");
    expect(layerOf(svg).hasAttribute("data-highlight")).toBe(false);
    // A touch after the mouse ends the mouse's highlight rather than leave it behind.
    over(lineOf(svg, IRON_ORE).querySelector("[data-line-hit]")!);
    expect(layerOf(svg)).toHaveAttribute("data-highlight");
    over(svg.querySelector("g[data-card] rect")!, "touch");
    expect(layerOf(svg).hasAttribute("data-highlight")).toBe(false);
  });

  it("a hybrid device (a mouse its primary pointer, so rates hide at rest) lets a finger highlight too, until the next touch", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(hover: hover) and (pointer: fine)", media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
    const svg = await openGraph();
    over(lineOf(svg, IRON_ORE).querySelector("[data-line-hit]")!, "touch");
    expect(layerOf(svg)).toHaveAttribute("data-highlight");
    // The finger lifting leaves the canvas: the highlight stays.
    act(() => void fireEvent.pointerLeave(svg, { pointerType: "touch" }));
    expect(layerOf(svg)).toHaveAttribute("data-highlight");
    over(svg, "touch");
    expect(layerOf(svg).hasAttribute("data-highlight")).toBe(false);
  });

  it("a pan ends the highlight: the picture moves under it", async () => {
    const svg = await openGraph();
    over(lineOf(svg, IRON_ORE).querySelector("[data-line-hit]")!);
    expect(layerOf(svg)).toHaveAttribute("data-highlight");
    act(() => void fireEvent.pointerDown(svg, { button: 0, pointerId: 1, pointerType: "mouse", clientX: 100, clientY: 100 }));
    act(() => void window.dispatchEvent(new MouseEvent("pointermove", { clientX: 160, clientY: 140 })));
    act(() => {
      const move = new MouseEvent("pointermove", { clientX: 200, clientY: 180 });
      Object.defineProperty(move, "pointerId", { value: 1 });
      window.dispatchEvent(move);
    });
    act(() => {
      const up = new MouseEvent("pointerup", { clientX: 200, clientY: 180 });
      Object.defineProperty(up, "pointerId", { value: 1 });
      window.dispatchEvent(up);
    });
    expect(layerOf(svg).hasAttribute("data-highlight")).toBe(false);
  });

  it("the keyboard on a card's button highlights it as the pointer does", async () => {
    const svg = await openGraph();
    const button = screen.getByRole("button", { name: /^8× Constructor, Iron Plate/ });
    act(() => button.focus());
    expect(layerOf(svg)).toHaveAttribute("data-highlight");
    expect(rates(svg).length).toBeGreaterThan(1);
    act(() => button.blur());
    expect(layerOf(svg).hasAttribute("data-highlight")).toBe(false);
  });

  it("under the item filter draws the rates the same way: the filter keeps its own dimming", async () => {
    const svg = await openGraph();
    fireEvent.change(screen.getByRole("combobox", { name: "Item" }), { target: { value: "Desc_OreIron_C" } });
    over(lineOf(svg, IRON_ORE).querySelector("[data-line-hit]")!);
    expect(layerOf(svg)).toHaveAttribute("data-highlight");
    // The one line, in its two end labels.
    expect(new Set(rates(svg).map(([i]) => i)).size).toBe(1);
    expect(rates(svg)).toHaveLength(2);
  });

  // A port of several lines names none of them: pointing at its label is no line's highlight.
  it("pointing at the end label of a port of several lines highlights none of them", async () => {
    const svg = await openGraph();
    const several = svg.querySelector('[data-end-label]:not([data-lines="1"])')!;
    expect(several).not.toHaveAttribute("data-hl-edge");
    over(several.querySelector("text")!);
    expect(layerOf(svg).hasAttribute("data-highlight")).toBe(false);
  });
});
