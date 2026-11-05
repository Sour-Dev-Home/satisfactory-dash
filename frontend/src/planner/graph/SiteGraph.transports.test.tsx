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
import { GLYPH_MOVE_MAX, MARCH_SETTLE_MS } from "./marching";
import { ITEM_FOCUS_KEY, MOTION_KEY, STATE_STYLE_KEY } from "./plannerPrefs";

// ADR-0062 amendment build PR 4: a transport draws a double line and does not march; its glyph moves along the line in the
// march layer, never in the canvas, and leaps its own label box.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

/**
 * A stage wide enough for the whole factory at its fitted zoom. With ports the picture is wider (the end-label bands), and
 * on the 1000-wide fallback stage the drone runs past the right edge, where no glyph moves (`movingGlyphs`).
 */
function wideStage() {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(2400);
  vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(900);
}

/** Glyphs move in the settled view, which follows the measured stage after `MARCH_SETTLE_MS`. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, MARCH_SETTLE_MS + 50)));

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

  // ADR-0063 Decision 2: an end-labelled line draws no middle pill (its box stays reserved and the glyph still leaps it,
  // glyphMotion.hunt.test.ts), and its words stand beside the ports over the line's first legs, so the glyph leaps those too.
  it("leaps its labels: no stretch of its path runs through a label pill or an end label's words", async () => {
    wideScreen(false);
    wideStage();
    // With item focus on, each end label draws its hit box, which spans the label's width beside its disc.
    window.localStorage.setItem(ITEM_FOCUS_KEY, "on");
    const svg = await openGraph();
    await settle();
    const glyphs = movingGlyphs(svg);
    expect(glyphs.length).toBeGreaterThan(1);
    type Box = { x: number; y: number; w: number; h: number };
    const num = (el: Element, k: string) => Number(el.getAttribute(k));
    const boxes: Box[] = [...svg.querySelectorAll("[data-edge-label] [data-label-pill]")].map((p) => ({ x: num(p, "x"), y: num(p, "y"), w: num(p, "width"), h: num(p, "height") }));
    const ends = [...svg.querySelectorAll("[data-end-label]")];
    expect(ends.length).toBeGreaterThan(0);
    for (const l of ends) {
      const hit = l.querySelector("rect")!;
      const [nameY, rateY] = [...l.querySelectorAll("text")].map((t) => num(t, "y"));
      boxes.push({ x: num(hit, "x"), y: nameY, w: num(hit, "width"), h: (rateY ?? nameY) - nameY });
    }
    for (const g of glyphs) {
      // Each subpath's points (a moveto starts one; an arc's end point is its last two numbers), then every stretch between
      // two of them sampled: none lies inside a box.
      const tokens = (g.querySelector("animateMotion")!.getAttribute("path") ?? "").match(/[MLA]|-?\d+(?:\.\d+)?/g)!;
      const subpaths: { x: number; y: number }[][] = [];
      for (let i = 0; i < tokens.length; ) {
        const cmd = tokens[i++];
        if (cmd === "A") i += 5;
        const p = { x: Number(tokens[i]), y: Number(tokens[i + 1]) };
        i += 2;
        if (cmd === "M") subpaths.push([p]);
        else subpaths.at(-1)!.push(p);
      }
      expect(subpaths.length).toBeGreaterThan(0);
      for (const sub of subpaths) {
        for (let s = 1; s < sub.length; s++) {
          for (let t = 0; t <= 20; t++) {
            const px = sub[s - 1].x + ((sub[s].x - sub[s - 1].x) * t) / 20;
            const py = sub[s - 1].y + ((sub[s].y - sub[s - 1].y) * t) / 20;
            for (const b of boxes) {
              const inside = px > b.x && px < b.x + b.w && py > b.y && py < b.y + b.h;
              expect(inside, `${px},${py} in ${b.x},${b.y} ${b.w}x${b.h}`).toBe(false);
            }
          }
        }
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

  // ADR-0063 build PR 4: a dimmed transport line's glyph is drawn at rest in the canvas (never neither), a lit one moves.
  it("leaves a dimmed transport's glyph at rest in the canvas while the focused line's glyph moves", async () => {
    wideScreen(false);
    wideStage();
    window.localStorage.setItem(ITEM_FOCUS_KEY, "on");
    const svg = await openGraph();
    await settle();
    const drone = lineFor(svg, /^Drone/);
    const truck = lineFor(svg, /^Truck/);
    const index = (g: Element) => g.getAttribute("data-edge");
    expect(movingGlyphs(svg).map((g) => g.getAttribute("data-glyph-edge"))).toEqual(expect.arrayContaining([index(drone), index(truck)]));
    // The drone's line draws end labels, not a bubble: focus it from its line's button (the drone's ingot, 30 a minute).
    fireEvent.click(screen.getByRole("button", { name: /^Iron Ingot, (about )?30 items\/min, from / }));
    expect(truck.hasAttribute("data-dim")).toBe(true);
    expect(drone.hasAttribute("data-dim")).toBe(false);
    const moved = movingGlyphs(svg).map((g) => g.getAttribute("data-glyph-edge"));
    expect(moved).not.toContain(index(truck));
    expect(moved).toContain(index(drone));
    // The truck's glyph shows once, at rest in the canvas; the drone's has left the canvas for the layer.
    expect(svg.querySelectorAll('[data-glyph="truck"]')).toHaveLength(1);
    expect(svg.querySelectorAll('[data-glyph="drone"]')).toHaveLength(0);
  });

  it("keeps a stalled transport's glyph still in marks mode and moves it in words mode", async () => {
    wideScreen(false);
    wideStage();
    const svg = await openGraph(withTransports(true));
    await settle();
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
