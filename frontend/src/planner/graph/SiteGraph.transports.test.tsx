import { act, fireEvent, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { endpoints, ProductionGraphResponseSchema, type PlannerNode, type PlannerTransport } from "@satisfactory-dash/shared";
import { productionGraphFactories, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../../servers/ServerContext";
import { renderWithClient } from "../../test/render";
import { server } from "../../test/server";
import { plannerTransportsLarge } from "../../test/scenarios";
import { PlannerView } from "../PlannerView";
import { LINE_W_FAST, TRANSPORT_GAP, TRANSPORT_W } from "./lineWidth";
import { GLYPH_MOVE_MAX } from "./marching";
import { MOTION_KEY, STATE_STYLE_KEY } from "./plannerPrefs";

// ADR-0062 amendment build PR 4: a transport draws a double line and does not march; its glyph moves along the line in the
// march layer, never in the canvas, and leaps its own label box.
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
});

const DATA = ProductionGraphResponseSchema.parse(productionGraphFactories).data;
const keyOf = (className: string) => DATA.nodes.find((n) => n.className === className)!.key;
const SMELTER = keyOf("Build_SmelterMk1_C");
const PLATE_CON = DATA.nodes.find((n) => n.recipe === "Iron Plate")!.key;
const DEPOT = keyOf("Build_TrainStation_C");
const transport = (mode: string, from: string, to: string, more: Partial<PlannerTransport>): PlannerTransport => ({
  from,
  to,
  mode,
  itemClassName: "Desc_IronIngot_C",
  itemName: "Iron Ingot",
  ratePerMinute: 60,
  rate: "measured",
  carriers: 1,
  routeName: `${mode} run`,
  ...more,
});
/**
 * The Iron Plate factory with its estimated train (the fixture's), a measured truck from the Depot and an estimated (dashed)
 * drone from the smelters; `stall` backs the smelters up, their ingot reading 0 and the drone's rate unknown.
 */
function withTransports(stall = false) {
  return {
    ...productionGraphFactories,
    data: {
      ...DATA,
      nodes: stall ? DATA.nodes.map((n): PlannerNode => (n.key === SMELTER ? { ...n, stateCounts: { backedUp: 4 }, products: [{ ...n.products[0]!, currentPerMinute: 0 }] } : n)) : DATA.nodes,
      transports: [
        ...DATA.transports!,
        transport("truck", DEPOT, PLATE_CON, { itemClassName: "Desc_OreIron_C", itemName: "Iron Ore" }),
        transport("drone", SMELTER, PLATE_CON, { rate: stall ? "unknown" : "estimated", ratePerMinute: stall ? null : 30 }),
      ],
    },
  };
}

/** A wide screen (the graph is the default view), with the operator's reduced-motion setting on or off. */
function wideScreen(reducedMotion = false) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width") || (reducedMotion && query.includes("prefers-reduced-motion")),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

async function openGraph(body: object = withTransports()) {
  server.use(http.get(endpoints.productionGraph.route, () => HttpResponse.json(body)));
  renderWithClient(
    <MemoryRouter>
      <ServerContext value={serversSingle.servers[0]}>
        <PlannerView />
      </ServerContext>
    </MemoryRouter>,
  );
  await screen.findByRole("img", { name: /^Graph of Factories/ }, { timeout: 3_000 });
  fireEvent.click(await screen.findByRole("button", { name: /^Open factory: Iron Plate factory./ }));
  return screen.findByRole("img", { name: /^Graph of Iron Plate factory/ }, { timeout: 3_000 });
}

const lineGroups = (svg: Element) => [...svg.querySelectorAll('[data-edge-layer="lines"] [data-edge]')];
const titleOf = (g: Element) => g.querySelector(":scope > title")!.textContent ?? "";
const lineFor = (svg: Element, words: RegExp) => {
  const found = lineGroups(svg).filter((g) => words.test(titleOf(g)));
  expect(found, `${String(words)} in ${lineGroups(svg).map(titleOf).join(" | ")}`).toHaveLength(1);
  return found[0];
};
const outer = (g: Element) => g.querySelector(":scope > path[marker-end]")!;
const gap = (g: Element) => g.querySelector(":scope > path[data-double-gap]");
const layerOf = (svg: Element) => svg.parentElement!.querySelector("[data-march-layer]");
const movingGlyphs = (svg: Element) => [...svg.parentElement!.querySelectorAll("[data-march-layer] [data-march-glyphs] g[data-moving]")];

describe("a transport's double line", () => {
  it("draws two rails (a wide stroke with a canvas-coloured gap), not a belt's width step or a mixed belt's core", async () => {
    wideScreen(true);
    const svg = await openGraph();
    for (const words of [/^Truck/, /^Drone/]) {
      const g = lineFor(svg, words);
      expect(g.hasAttribute("data-double"), String(words)).toBe(true);
      expect(Number(outer(g).getAttribute("stroke-width"))).toBe(TRANSPORT_W);
      expect(Number(gap(g)!.getAttribute("stroke-width"))).toBe(TRANSPORT_GAP);
      expect(gap(g)!.getAttribute("class")).toBe("stroke-surface");
      expect(g.querySelector("[data-mixed-inner]")).toBeNull();
      expect(TRANSPORT_W).toBeGreaterThan(LINE_W_FAST);
    }
    // The belts are unchanged: no double line, no gap.
    const belts = lineGroups(svg).filter((g) => !g.hasAttribute("data-double"));
    expect(belts.length).toBeGreaterThan(0);
    for (const g of belts) {
      expect(gap(g), titleOf(g)).toBeNull();
      expect(Number(outer(g).getAttribute("stroke-width")), titleOf(g)).toBeLessThanOrEqual(LINE_W_FAST);
    }
    expect(svg.querySelector("[style]")).toBeNull();
  });

  it("ends in its own arrowhead, wide enough at the line's end to cover both rails (a belt's head is 4 wide there)", async () => {
    wideScreen(true);
    const svg = await openGraph();
    const truck = outer(lineFor(svg, /^Truck/));
    const id = /^url\(#(.+)\)$/.exec(truck.getAttribute("marker-end")!)![1];
    expect(id).toMatch(/-double$/);
    const widthAtEnd = (markerId: string) => {
      // The head is 8 long and 8 wide (viewBox 10, markerWidth 8) and rides the line's end at refX: its width there is its
      // distance from the tip.
      const m = svg.querySelector(`marker[id="${CSS.escape(markerId)}"]`)!;
      expect(m.getAttribute("markerWidth")).toBe("8");
      return (10 - Number(m.getAttribute("refX"))) * 0.8;
    };
    expect(widthAtEnd(id)).toBeGreaterThanOrEqual(TRANSPORT_W);
    expect(widthAtEnd(id.replace(/-double$/, ""))).toBeCloseTo(LINE_W_FAST);
  });

  it("keeps the line's colour and dashes: a measured transport solid and muted, an estimated one dashed on both rails alike", async () => {
    wideScreen(true);
    const svg = await openGraph();
    const truck = lineFor(svg, /^Truck/);
    expect(outer(truck).getAttribute("class")).toBe("stroke-muted");
    expect(outer(truck).hasAttribute("stroke-dasharray")).toBe(false);
    expect(gap(truck)!.hasAttribute("stroke-dasharray")).toBe(false);
    const drone = lineFor(svg, /^Drone/);
    expect(outer(drone).getAttribute("stroke-dasharray")).toBe("8 5");
    // The gap's dashes are the line's own, at the same offset, so each dash is two short rails (a mixed belt's are shorter).
    expect(gap(drone)!.getAttribute("stroke-dasharray")).toBe("8 5");
    expect(gap(drone)!.hasAttribute("stroke-dashoffset")).toBe(false);
  });
});

describe("a transport's moving glyph", () => {
  it("moves in the march layer, never marching the line, and the canvas animates nothing", async () => {
    wideScreen(false);
    const svg = await openGraph();
    const glyphs = movingGlyphs(svg);
    expect(glyphs.length).toBeGreaterThan(0);
    for (const g of glyphs) {
      expect(g.querySelector("animateMotion")!.getAttribute("repeatCount")).toBe("indefinite");
      expect(g.querySelector("[data-glyph]")).not.toBeNull();
    }
    expect(svg.querySelector("animateMotion")).toBeNull();
    // No transport's line marches: the layer's marching edges are belts only.
    const transportEdges = new Set(lineGroups(svg).filter((g) => g.hasAttribute("data-double")).map((g) => g.getAttribute("data-edge")));
    for (const m of layerOf(svg)!.querySelectorAll("[data-march-edge]")) expect(transportEdges.has(m.getAttribute("data-march-edge"))).toBe(false);
    // A moving glyph's resting copy is left out of the canvas; each glyph shows once.
    for (const mode of ["truck", "drone"]) expect(svg.parentElement!.querySelectorAll(`[data-glyph="${mode}"]`), mode).toHaveLength(1);
    expect(layerOf(svg)!.querySelector("[style]")).toBeNull();
  });

  it("leaps its own label box: no point of its path lies inside the label pill", async () => {
    wideScreen(false);
    const svg = await openGraph();
    const glyphs = movingGlyphs(svg);
    expect(glyphs.length).toBeGreaterThan(0);
    for (const g of glyphs) {
      const index = g.getAttribute("data-glyph-edge")!;
      const pill = svg.querySelector(`[data-edge-label="${index}"] [data-label-pill]`)!;
      const [x, y, w, h] = ["x", "y", "width", "height"].map((k) => Number(pill.getAttribute(k)));
      const numbers = (g.querySelector("animateMotion")!.getAttribute("path") ?? "").match(/-?\d+(\.\d+)?/g)!.map(Number);
      for (let i = 0; i + 1 < numbers.length; i += 2) {
        const [px, py] = [numbers[i], numbers[i + 1]];
        const inside = px > x && px < x + w && py > y && py < y + h;
        expect(inside, `${px},${py} in ${x},${y} ${w}x${h}`).toBe(false);
      }
    }
  });

  it("stays at rest with Motion Off, and under System with reduced motion: no layer, the glyph in its pill", async () => {
    wideScreen(true);
    const svg = await openGraph();
    expect(layerOf(svg)).toBeNull();
    for (const mode of ["train", "truck", "drone"]) expect(svg.querySelector(`[data-glyph="${mode}"]`), mode).not.toBeNull();
    expect(svg.querySelectorAll('g[data-moving="false"]')).toHaveLength(3);
    act(() => {
      fireEvent.change(screen.getByLabelText("Motion"), { target: { value: "off" } });
    });
    expect(window.localStorage.getItem(MOTION_KEY)).toBe("off");
    expect(layerOf(svg)).toBeNull();
    expect(svg.parentElement!.querySelector("animateMotion")).toBeNull();
  });

  it("moves at most GLYPH_MOVE_MAX glyphs on the 48-factory overview of 48 transports (the e2e frame-time scenario)", async () => {
    wideScreen(false);
    server.use(http.get(endpoints.productionGraph.route, () => HttpResponse.json(plannerTransportsLarge)));
    renderWithClient(
      <MemoryRouter>
        <ServerContext value={serversSingle.servers[0]}>
          <PlannerView />
        </ServerContext>
      </MemoryRouter>,
    );
    const svg = await screen.findByRole("img", { name: /^Graph of Factories: 48 factories/ }, { timeout: 5_000 });
    expect(svg.querySelectorAll('[data-edge-layer="lines"] [data-edge][data-double]')).toHaveLength(48);
    const glyphs = movingGlyphs(svg);
    expect(glyphs.length).toBeGreaterThan(0);
    expect(glyphs.length).toBeLessThanOrEqual(GLYPH_MOVE_MAX);
    // Every glyph shows once: moving in the layer, or at rest in the canvas.
    expect(svg.querySelectorAll("[data-glyph]").length + glyphs.length).toBe(48);
    expect(svg.querySelector("animateMotion, [data-march], [class*='animate-flow']")).toBeNull();
  });

  it("keeps a stalled transport's glyph still in marks mode and moves it in words mode", async () => {
    wideScreen(false);
    const svg = await openGraph(withTransports(true));
    const drone = lineFor(svg, /^Drone/);
    expect(drone.getAttribute("data-stalled")).toBe("backedUp");
    const droneIndex = drone.getAttribute("data-edge");
    expect(movingGlyphs(svg).map((g) => g.getAttribute("data-glyph-edge"))).not.toContain(droneIndex);
    expect(svg.querySelector('[data-glyph="drone"]')).not.toBeNull();
    // The stalled double line ends in the stop bar, its rails and gap unchanged.
    expect(outer(drone).getAttribute("marker-end")).toMatch(/-backedUp\)$/);
    expect(Number(outer(drone).getAttribute("stroke-width"))).toBe(TRANSPORT_W);
    // The truck from the miner is not stalled, so it still moves.
    expect(movingGlyphs(svg).map((g) => g.getAttribute("data-glyph-edge"))).toContain(lineFor(svg, /^Truck/).getAttribute("data-edge"));
    fireEvent.click(screen.getByRole("button", { name: "State marks" }));
    expect(window.localStorage.getItem(STATE_STYLE_KEY)).toBe("words");
    expect(movingGlyphs(svg).map((g) => g.getAttribute("data-glyph-edge"))).toContain(droneIndex);
  });
});
