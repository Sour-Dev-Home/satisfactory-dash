import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { endpoints, ProductionGraphResponseSchema } from "@satisfactory-dash/shared";
import { productionGraphStalled, productionGraphTwoSites, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../../servers/ServerContext";
import { renderWithClient } from "../../test/render";
import { plannerLarge } from "../../test/scenarios";
import { server } from "../../test/server";
import { PlannerView } from "../PlannerView";
import { MARCH_MAX, MARCH_SETTLE_MS, PULSE_DASH, PULSE_MIN_W } from "./marching";

// ADR-0062 amendment build PR 3: marching dashes by class, at each line's step; unknown and stalled lines still; Motion Off
// and reduced motion still; only lines in the settled view, at most MARCH_MAX. The marching strokes are drawn in their own
// layer over the canvas (`[data-march-layer]`), so their repaint is not the whole canvas's; the canvas draws every line still.
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
});

type Response = { data: unknown };
const DATA = ProductionGraphResponseSchema.parse(productionGraphTwoSites).data;

async function openGraph(response: Response = { ...productionGraphTwoSites, data: DATA }, site = "Iron Plate site") {
  server.use(http.get(endpoints.productionGraph.route, () => HttpResponse.json(response)));
  renderWithClient(
    <MemoryRouter>
      <ServerContext value={serversSingle.servers[0]}>
        <PlannerView />
      </ServerContext>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: `Open site: ${site}` }));
  fireEvent.click(await screen.findByRole("button", { name: "Graph" }));
  return screen.findByRole("img", { name: new RegExp(`^Graph of ${site}`) }, { timeout: 15_000 });
}

/** The march layer beside the canvas, or null when nothing marches. */
const layerOf = (svg: Element) => svg.parentElement!.querySelector<SVGSVGElement>(":scope > [data-march-layer]");
const lines = (svg: Element) => {
  const marched = new Map([...(layerOf(svg)?.querySelectorAll("[data-march-edge]") ?? [])].map((m) => [m.getAttribute("data-march-edge"), m]));
  return [...svg.querySelectorAll('[data-edge-layer="lines"] [data-edge]')].map((g) => {
    const march = marched.get(g.getAttribute("data-edge")) ?? null;
    return {
      g,
      title: g.querySelector(":scope > title")!.textContent ?? "",
      path: g.querySelector(":scope > path[marker-end]")!,
      inner: g.querySelector(":scope > path[data-mixed-inner]"),
      // The line's strokes in the march layer, if it marches.
      march,
      dashes: march?.querySelector("path[data-march]:not([data-mixed-inner]):not([data-march-pulse])") ?? null,
      marchInner: march?.querySelector("path[data-mixed-inner]") ?? null,
      cover: march?.querySelector("path[data-march-cover]") ?? null,
      pulse: march?.querySelector("path[data-march-pulse]") ?? null,
    };
  });
};
/** The marching lines' edge indexes, cheaply (the large site has 210 lines, and titles repeat there). */
const marchingEdges = (svg: Element) => [...(layerOf(svg)?.querySelectorAll("[data-march-edge]") ?? [])].map((m) => m.getAttribute("data-march-edge"));
const lineFor = (svg: Element, words: RegExp) => {
  const found = lines(svg).filter((l) => words.test(l.title));
  expect(found, String(words)).toHaveLength(1);
  return found[0];
};
const animated = (el: Element | null) => [...(el?.classList ?? [])].filter((c) => c.startsWith("animate-flow"));
const marchingCount = (svg: Element) => layerOf(svg)?.querySelectorAll("[data-march-edge]").length ?? 0;
/** What the canvas draws for its lines: every path's attributes, which marching must never change. */
const canvasLines = (svg: Element) =>
  [...svg.querySelectorAll('[data-edge-layer="lines"] path')].map((p) => [...p.attributes].map((a) => `${a.name}=${a.value}`).join(" "));
const transformOf = (g: Element | null | undefined) => g?.getAttribute("transform") ?? null;

describe("marching dashes in the march layer", () => {
  it("marches a measured line by pulses over its solid stroke, at its step, hidden unless they run", async () => {
    const svg = await openGraph();
    const ore = lineFor(svg, /: Iron Ore · 120 items\/min/);
    // The canvas's line stays solid and still: measured never looks dashed, and nothing in the canvas animates.
    expect(ore.path.getAttribute("stroke-dasharray")).toBeNull();
    expect(svg.querySelector('[class*="animate-flow"], [data-march]')).toBeNull();
    expect(ore.pulse).not.toBeNull();
    expect(animated(ore.pulse)).toEqual(["animate-flow-pulse-mid"]);
    expect(ore.pulse).toHaveClass("opacity-0", "stroke-fg-strong");
    expect(ore.pulse!.getAttribute("data-march")).toBe("mid");
    expect(ore.pulse!.getAttribute("stroke-dasharray")).toBe(PULSE_DASH);
    // Thinner than the line, so it reads as light on the line, not as the line's own dashes.
    expect(Number(ore.pulse!.getAttribute("stroke-width"))).toBeLessThan(Number(ore.path.getAttribute("stroke-width")));
    expect(ore.pulse!.getAttribute("marker-end")).toBeNull();
    // A solid line needs no cover and draws no dashes of its own.
    expect(ore.cover).toBeNull();
    expect(ore.dashes).toBeNull();
    // A slow measured line pulses at the slow step.
    expect(animated(lineFor(svg, /: Iron Plate · 4 items\/min/).pulse)).toEqual(["animate-flow-pulse-slow"]);
  });

  it("marches an estimated line's own dashes at its step over a cover for its still ones, with no pulses", async () => {
    const svg = await openGraph();
    const ingot = lineFor(svg, /: Iron Ingot · about 102\.2 items\/min/);
    // The canvas keeps the still dashed line and its arrowhead.
    expect(ingot.path.getAttribute("stroke-dasharray")).toBe("8 5");
    expect(animated(ingot.path)).toEqual([]);
    expect(ingot.path.getAttribute("marker-end")).not.toBeNull();
    // The layer's dashes: the same pattern, width and colour, moving.
    expect(ingot.dashes!.getAttribute("stroke-dasharray")).toBe("8 5");
    expect(ingot.dashes!.getAttribute("stroke-width")).toBe(ingot.path.getAttribute("stroke-width"));
    expect(ingot.dashes!.getAttribute("class")).toContain(ingot.path.getAttribute("class")!);
    expect(animated(ingot.dashes)).toEqual(["animate-flow-slow"]);
    expect(ingot.dashes!.getAttribute("data-march")).toBe("slow");
    expect(ingot.dashes!.getAttribute("marker-end")).toBeNull();
    // Under them, a canvas-coloured cover a little wider than the line hides the still dashes.
    expect(ingot.cover).toHaveClass("stroke-surface");
    expect(Number(ingot.cover!.getAttribute("stroke-width"))).toBeGreaterThan(Number(ingot.path.getAttribute("stroke-width")));
    expect(animated(ingot.cover)).toEqual([]);
    expect(ingot.pulse).toBeNull();
  });

  it("keeps an unknown line still and dotted, and out of the layer", async () => {
    const svg = await openGraph();
    const unknown = lines(svg).filter((l) => l.path.getAttribute("stroke-dasharray") === "2 5");
    expect(unknown).toHaveLength(1);
    expect(unknown[0].march).toBeNull();
    expect(marchingCount(svg)).toBeGreaterThan(0);
  });

  it("marches a mixed estimated belt's inner dashes in step with its outer ones", async () => {
    const edges = DATA.edges.map((e) => (e.mixed ? { ...e, ratePerMinute: 150, rate: "estimated" as const } : e));
    const svg = await openGraph({ ...productionGraphTwoSites, data: { ...DATA, edges } });
    const [mixed] = lines(svg).filter((l) => l.inner !== null);
    expect(animated(mixed.dashes)).toEqual(["animate-flow-mid"]);
    expect(animated(mixed.marchInner)).toEqual(["animate-flow-inner-mid"]);
    // The still frame is the canvas's: the inner dashes start half a unit in, centred in the outer ones.
    expect(mixed.marchInner!.getAttribute("stroke-dashoffset")).toBe("-0.5");
    expect(mixed.marchInner!.getAttribute("stroke-dasharray")).toBe(mixed.inner!.getAttribute("stroke-dasharray"));
    expect(mixed.marchInner!.getAttribute("d")).toBe(mixed.inner!.getAttribute("d"));
    expect(mixed.pulse).toBeNull();
  });

  it("pulses a mixed measured belt in its core, at the inner stroke's width or the floor", async () => {
    const edges = DATA.edges.map((e) => (e.mixed ? { ...e, ratePerMinute: 150, rate: "measured" as const } : e));
    const svg = await openGraph({ ...productionGraphTwoSites, data: { ...DATA, edges } });
    const [mixed] = lines(svg).filter((l) => l.inner !== null);
    expect(mixed.dashes).toBeNull();
    expect(mixed.marchInner).toBeNull();
    expect(animated(mixed.pulse)).toEqual(["animate-flow-pulse-mid"]);
    // Mid: the inner stroke is 1, under the floor, so the pulse is the floor's width.
    expect(Number(mixed.pulse!.getAttribute("stroke-width"))).toBe(Math.max(PULSE_MIN_W, Number(mixed.inner!.getAttribute("stroke-width"))));
    expect(Number(mixed.pulse!.getAttribute("stroke-width"))).toBe(PULSE_MIN_W);
  });

  it("keeps a stalled line still, in marks and in words", async () => {
    const svg = await openGraph(productionGraphStalled);
    const stalled = lines(svg).filter((l) => l.g.hasAttribute("data-stalled"));
    expect(stalled.length).toBeGreaterThan(0);
    for (const l of stalled) expect(l.march, l.title).toBeNull();
    // Something else on the site still marches, so the stalled lines are still by their state, not by a motion setting.
    expect(marchingCount(svg)).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "State marks" }));
    const titles = stalled.map((l) => l.title);
    for (const l of lines(svg).filter((x) => titles.includes(x.title))) expect(l.march, l.title).toBeNull();
  });

  it("draws no layer with Motion Off, and again once it is back on; the canvas's lines never change", async () => {
    const svg = await openGraph();
    expect(marchingCount(svg)).toBeGreaterThan(0);
    const still = canvasLines(svg);
    fireEvent.change(screen.getByLabelText("Motion"), { target: { value: "off" } });
    expect(layerOf(svg)).toBeNull();
    expect(document.querySelector('[data-march], [data-march-pulse], [class*="animate-flow"]')).toBeNull();
    expect(canvasLines(svg)).toEqual(still);
    fireEvent.change(screen.getByLabelText("Motion"), { target: { value: "on" } });
    expect(marchingCount(svg)).toBeGreaterThan(0);
    expect(canvasLines(svg)).toEqual(still);
  });

  it("has no Motion control where nothing can move (every rate unknown, no transport)", async () => {
    const edges = DATA.edges.map((e) => ({ ...e, ratePerMinute: null, rate: "unknown" as const }));
    const svg = await openGraph({ ...productionGraphTwoSites, data: { ...DATA, edges } });
    expect(layerOf(svg)).toBeNull();
    expect(screen.queryByLabelText("Motion")).not.toBeInTheDocument();
  });

  it("draws no layer under reduced motion, under System and with Motion On alike", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), addEventListener: () => {}, removeEventListener: () => {} }));
    const svg = await openGraph();
    expect(layerOf(svg)).toBeNull();
    fireEvent.change(screen.getByLabelText("Motion"), { target: { value: "on" } });
    expect(layerOf(svg)).toBeNull();
    expect(document.querySelector("[data-march]")).toBeNull();
  });

  it("lies exactly over the canvas: the same viewBox, fit and pan and zoom, decorative and pointer-transparent", async () => {
    const svg = await openGraph();
    const layer = layerOf(svg)!;
    expect(layer.getAttribute("viewBox")).toBe(svg.getAttribute("viewBox"));
    expect(layer.getAttribute("preserveAspectRatio")).toBe(svg.getAttribute("preserveAspectRatio"));
    expect(layer).toHaveAttribute("aria-hidden", "true");
    expect(layer).toHaveClass("pointer-events-none", "absolute", "top-0", "left-0", "w-full", "border", "border-transparent", "will-change-transform");
    // The canvas's own height, not the box's: the box is taller by the inline svg's baseline gap (CI caught 6px).
    expect(layer.getAttribute("height")).toBe(svg.getAttribute("height"));
    expect(layer.hasAttribute("style")).toBe(false);
    expect(layer.querySelector("[style]")).toBeNull();
    // After the canvas, so it is drawn over it, and inside the same positioned box.
    expect(layer.previousElementSibling).toBe(svg);
    const drawing = () => svg.querySelector(":scope > g");
    const layerDrawing = () => layerOf(svg)!.querySelector(":scope > g");
    expect(transformOf(layerDrawing())).toBe(transformOf(drawing()));
    // A pan or a zoom moves both together, on the same render.
    const viewport = screen.getByRole("group", { name: /^Graph viewport/ });
    const before = transformOf(drawing());
    fireEvent.keyDown(viewport, { key: "+" });
    fireEvent.keyDown(viewport, { key: "ArrowLeft" });
    expect(transformOf(drawing())).not.toBe(before);
    expect(transformOf(layerOf(svg)?.querySelector(":scope > g"))).toBe(transformOf(drawing()));
  });

  it("masks out every label pill and card, so a marching stroke never shows over them", async () => {
    const svg = await openGraph();
    const layer = layerOf(svg)!;
    const mask = layer.querySelector("defs > mask")!;
    expect(mask.getAttribute("maskUnits")).toBe("userSpaceOnUse");
    const strokes = layer.querySelector(":scope > g > g[mask]")!;
    expect(strokes.getAttribute("mask")).toBe(`url(#${mask.id})`);
    expect(strokes.querySelectorAll("[data-march-edge]").length).toBe(marchingCount(svg));
    const holes = mask.querySelectorAll("rect.fill-black");
    const pills = svg.querySelectorAll("[data-label-pill]");
    const cards = svg.querySelectorAll("[data-node]");
    expect(holes.length).toBeGreaterThanOrEqual(pills.length + cards.length);
    // Each pill's hole is the pill.
    const holeBoxes = new Set([...holes].map((h) => ["x", "y", "width", "height"].map((a) => Number(h.getAttribute(a)).toFixed(2)).join(",")));
    for (const p of pills) expect(holeBoxes.has(["x", "y", "width", "height"].map((a) => Number(p.getAttribute(a)).toFixed(2)).join(","))).toBe(true);
    expect(mask.querySelectorAll("rect.fill-white")).toHaveLength(1);
  });

  it("caps a 210-line site at MARCH_MAX, and a zoom or a pan changes the set once the view settles", async () => {
    const svg = await openGraph(plannerLarge, "Large site");
    expect(lines(svg).length).toBeGreaterThan(200);
    const before = marchingCount(svg);
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThanOrEqual(MARCH_MAX);
    // Every marching line is one that may march (no unknown, dotted line); the cap's order is marching.test.ts's.
    for (const l of lines(svg).filter((x) => x.march !== null)) expect(l.path.getAttribute("stroke-dasharray")).not.toBe("2 5");
    // The canvas still draws every line, marching or not.
    expect(svg.querySelectorAll('[data-edge-layer="lines"] [data-edge] > path[marker-end]')).toHaveLength(lines(svg).length);
    const was = marchingEdges(svg);
    // Zoom far in: most lines leave the view. The set waits for the view to settle, then follows it.
    const viewport = screen.getByRole("group", { name: /^Graph viewport/ });
    for (let i = 0; i < 6; i++) fireEvent.keyDown(viewport, { key: "+" });
    expect(marchingEdges(svg)).toEqual(was);
    await waitFor(() => expect(marchingEdges(svg)).not.toEqual(was), { timeout: MARCH_SETTLE_MS * 40 });
    expect(marchingCount(svg)).toBeLessThanOrEqual(MARCH_MAX);
    // A pan alone (no zoom) brings other lines in and takes these out, again once the view settles.
    const zoomedEdges = marchingEdges(svg);
    for (let i = 0; i < 16; i++) fireEvent.keyDown(viewport, { key: "ArrowRight" });
    expect(marchingEdges(svg)).toEqual(zoomedEdges);
    await waitFor(() => expect(marchingEdges(svg)).not.toEqual(zoomedEdges), { timeout: MARCH_SETTLE_MS * 40 });
    expect(marchingCount(svg)).toBeLessThanOrEqual(MARCH_MAX);
  }, 60_000);
});
