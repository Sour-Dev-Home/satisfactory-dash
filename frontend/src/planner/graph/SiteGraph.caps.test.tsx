import { act, fireEvent, screen, within } from "@testing-library/react";
import { http, HttpResponse, type JsonBodyType } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endpoints, ProductionGraphResponseSchema } from "@satisfactory-dash/shared";
import { productionGraphFactories, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../../servers/ServerContext";
import { renderWithClient } from "../../test/render";
import { server } from "../../test/server";
import { PlannerView } from "../PlannerView";
import { plannerCapsLarge } from "../../test/scenarios";
import { CAP_MARCH_MAX, PULSE_DASH } from "./marching";
import { STATE_STYLE_KEY, STORAGE_DETAIL_KEY } from "./plannerPrefs";

// ADR-0062 Decision 1, the destination caps on the canvas: one cap per kind in a card's footer row, a count badge, "+k" past
// four kinds; the stub's dashes travel at `rateStep`'s step, measured by pulses and estimated by its own dashes, unknown and
// stalled still; the moving part only ever in the march layer, never the canvas; Motion Off and reduced motion still; the
// words in each cap's <title> and in a roving-tabindex button that shows the card's detail.

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
});

const DATA = ProductionGraphResponseSchema.parse(productionGraphFactories).data;
type Edge = (typeof DATA.edges)[number];
const answer = (body: JsonBodyType) => server.use(http.get(endpoints.productionGraph.route, () => HttpResponse.json(body)));
const withData = (data: object) => ({ ...productionGraphFactories, data: { ...DATA, ...data } });
const PLATE = DATA.factories![0].key;
const ROD = DATA.factories![1].key;
const STORAGE_EDGE = DATA.edges.find((e) => e.destination === "storage")!;
const toStore = (destination: string, extra: Partial<Edge> = {}): Edge => ({ ...STORAGE_EDGE, destination, ...extra });

function wideScreen(reducedMotion = false) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width") || (reducedMotion && query.includes("prefers-reduced-motion")),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

async function overview(body: JsonBodyType = productionGraphFactories) {
  answer(body);
  renderWithClient(
    <MemoryRouter>
      <ServerContext value={serversSingle.servers[0]}>
        <PlannerView />
      </ServerContext>
    </MemoryRouter>,
  );
  return screen.findByRole("img", { name: /^Graph of Factories/ }, { timeout: 3_000 });
}

const cardOf = (svg: Element, key: string) => svg.querySelector(`[data-node="${CSS.escape(key)}"]`)!;
const capsOf = (svg: Element, key: string) => [...cardOf(svg, key).querySelectorAll<SVGGElement>("[data-cap], [data-cap-more]")];
const capOf = (svg: Element, key: string, destination: string) => cardOf(svg, key).querySelector<SVGGElement>(`[data-cap="${destination}"]`);
const layerOf = (svg: Element) => svg.parentElement!.querySelector<SVGSVGElement>(":scope > [data-march-layer]");
const marchOf = (svg: Element, id: string) => layerOf(svg)?.querySelector(`[data-march-cap="${CSS.escape(id)}"]`) ?? null;
const animated = (el: Element | null | undefined) => [...(el?.querySelector("path")?.classList ?? [])].filter((c) => c.startsWith("animate-flow"));
const capButtons = () => within(screen.getByRole("list", { name: "Where the cards' flows end" })).getAllByRole("button");

describe("destination caps on the factory overview", () => {
  beforeEach(() => wideScreen());

  it("draws one cap per kind on each factory card, its words in the <title>, and nothing in the canvas animates", async () => {
    const svg = await overview();
    expect(capsOf(svg, PLATE).map((c) => c.getAttribute("data-cap"))).toEqual(["storage"]);
    expect(capsOf(svg, ROD).map((c) => c.getAttribute("data-cap"))).toEqual(["sink"]);
    const storage = capOf(svg, PLATE, "storage")!;
    expect(storage.querySelector(":scope > title")!.textContent).toBe("48 items/min to storage");
    expect(capOf(svg, ROD, "sink")!.querySelector(":scope > title")!.textContent).toBe("about 6 items/min to the Sink");
    // Art from the building icons where it has one; a single flow has no badge.
    expect(storage.querySelector("[data-cap-art]")!.getAttribute("data-cap-art")).toBe("image");
    expect(storage.querySelector("[data-cap-badge]")).toBeNull();
    // The card's own words keep the chip's text (the text path).
    expect(cardOf(svg, PLATE).querySelector(":scope > title")!.textContent).toContain("1 flow to storage");
    expect(svg.querySelector('[class*="animate-flow"], [data-march]')).toBeNull();
    expect(svg.querySelector("[style]")).toBeNull();
  });

  it("moves a measured cap by pulses over its solid stub and an estimated one by its own dashes, both at their step, in the layer", async () => {
    const svg = await overview();
    // Measured 48 items/min: slow. The canvas keeps the solid stub; the layer's pulses ride over it, toward the disc.
    const storage = capOf(svg, PLATE, "storage")!;
    expect(storage.getAttribute("data-cap-step")).toBe("slow");
    const stub = storage.querySelector("[data-cap-stub]")!;
    expect(stub.getAttribute("stroke-dasharray")).toBeNull();
    const pulse = marchOf(svg, `0|${PLATE}`)!;
    expect(animated(pulse)).toEqual(["animate-flow-pulse-slow"]);
    expect(pulse.querySelector("path")!.getAttribute("stroke-dasharray")).toBe(PULSE_DASH);
    expect(pulse.querySelector("path")).toHaveClass("opacity-0");
    // Estimated 6 items/min: slow, dashed. While it moves the canvas leaves its stub to the layer, which draws it dashed.
    const sink = capOf(svg, ROD, "sink")!;
    expect(sink.getAttribute("data-cap-quality")).toBe("estimated");
    expect(sink.querySelector("[data-cap-stub]")).toBeNull();
    const dashes = marchOf(svg, `0|${ROD}`)!.querySelector("path")!;
    expect(animated(marchOf(svg, `0|${ROD}`))).toEqual(["animate-flow-slow"]);
    expect(dashes.getAttribute("stroke-dasharray")).toBe("8 5");
    expect(dashes.getAttribute("data-march")).toBe("slow");
    // The stub runs left to right, into the disc: dashes travel toward the destination.
    expect(dashes.getAttribute("d")).toMatch(/^M[\d.]+ [\d.]+H[\d.]+$/);
  });

  it("steps by the summed rate: a cap and a line of the same rate move alike", async () => {
    const edges = [...DATA.edges, toStore("storage", { ratePerMinute: 500, rate: "measured" }), toStore("depot", { ratePerMinute: 200, rate: "estimated" })];
    const svg = await overview(withData({ edges }));
    // 48 + 500 measured: fast; 200 estimated: mid.
    expect(capOf(svg, PLATE, "storage")!.getAttribute("data-cap-step")).toBe("fast");
    expect(animated(marchOf(svg, `0|${PLATE}`))).toEqual(["animate-flow-pulse-fast"]);
    expect(capOf(svg, PLATE, "depot")!.getAttribute("data-cap-step")).toBe("mid");
    expect(animated(marchOf(svg, `1|${PLATE}`))).toEqual(["animate-flow-mid"]);
  });

  it("badges a count past one flow and collapses more than four kinds into a '+k' cap", async () => {
    const edges = [
      ...DATA.edges,
      toStore("storage", { ratePerMinute: 12 }),
      toStore("depot", { ratePerMinute: 300, rate: "estimated" }),
      toStore("power", { ratePerMinute: null, rate: "unknown" }),
      toStore("export", { ratePerMinute: 500 }),
      toStore("unknown", { ratePerMinute: 10 }),
    ];
    const svg = await overview(withData({ edges }));
    const caps = capsOf(svg, PLATE);
    expect(caps.map((c) => c.getAttribute("data-cap") ?? `+${c.getAttribute("data-cap-more")}`)).toEqual(["storage", "depot", "power", "+2"]);
    expect(caps[0].querySelector("[data-cap-badge]")!.textContent).toBe("2");
    expect(caps[0].querySelector(":scope > title")!.textContent).toBe("60 items/min to storage, 2 flows");
    expect(caps[3].querySelector("text")!.textContent).toBe("+2");
    expect(caps[3].querySelector(":scope > title")!.textContent).toBe("2 more destinations (1 flow leaving by station, 1 flow to unknown ends), 2 flows");
    // A glyph where no building's icon stands for the kind.
    expect(caps[2].querySelector("[data-cap-art]")!.getAttribute("data-cap-art")).toBe("glyph");
  });

  it("keeps an unknown cap still and dotted, out of the layer", async () => {
    const edges = DATA.edges.map((e) => (e.destination === "storage" ? { ...e, ratePerMinute: null, rate: "unknown" as const } : e));
    const svg = await overview(withData({ edges }));
    const storage = capOf(svg, PLATE, "storage")!;
    expect(storage.getAttribute("data-cap-quality")).toBe("unknown");
    expect(storage.getAttribute("data-cap-step")).toBe("still");
    expect(storage.querySelector("[data-cap-stub]")!.getAttribute("stroke-dasharray")).toBe("2 5");
    expect(storage.querySelector(":scope > title")!.textContent).toBe("1 flow to storage, rate unknown");
    expect(marchOf(svg, `0|${PLATE}`)).toBeNull();
  });

  it("keeps a stalled cap still, its disc ringed in the state's tone in marks mode, and says so in words mode too", async () => {
    const plate = DATA.factories![0];
    const nodes = DATA.nodes.map((n) => (plate.nodeKeys.includes(n.key) ? { ...n, stateCounts: { backedUp: 1 } } : n));
    const factories = DATA.factories!.map((f) => (f.key === PLATE ? { ...f, products: f.products.map((p) => ({ ...p, currentPerMinute: 0 })) } : f));
    // The storage flow is estimated, so nothing says it moves: the cap takes the card's stalled state.
    const edges = DATA.edges.map((e) => (e.destination === "storage" ? { ...e, rate: "estimated" as const } : e));
    const svg = await overview(withData({ nodes, factories, edges }));
    const storage = capOf(svg, PLATE, "storage")!;
    expect(storage.getAttribute("data-cap-stalled")).toBe("backedUp");
    expect(storage.getAttribute("data-cap-step")).toBe("still");
    expect(storage.querySelector("[data-cap-ring]")!.getAttribute("data-cap-ring")).toBe("backedUp");
    expect(storage.querySelector(":scope > title")!.textContent).toMatch(/, not moving: backed up$/);
    expect(marchOf(svg, `0|${PLATE}`)).toBeNull();
    // The other card's cap still moves: still by its state, not a motion setting.
    expect(marchOf(svg, `0|${ROD}`)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "State marks" }));
    expect(window.localStorage.getItem(STATE_STYLE_KEY)).toBe("words");
    // Words mode: no ring of the state's tone, still not moving, the words unchanged.
    const words = capOf(svg, PLATE, "storage")!;
    expect(words.querySelector("[data-cap-ring]")).toBeNull();
    expect(words.querySelector("circle")).toHaveClass("stroke-line");
    expect(words.querySelector(":scope > title")!.textContent).toMatch(/, not moving: backed up$/);
    expect(marchOf(svg, `0|${PLATE}`)).toBeNull();
  });

  it("stops every cap with Motion Off and draws the estimated stub back in the canvas", async () => {
    const svg = await overview();
    expect(layerOf(svg)).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Motion"), { target: { value: "off" } });
    expect(layerOf(svg)).toBeNull();
    expect(document.querySelector("[data-march], [class*='animate-flow']")).toBeNull();
    expect(capOf(svg, ROD, "sink")!.querySelector("[data-cap-stub]")!.getAttribute("stroke-dasharray")).toBe("8 5");
    fireEvent.change(screen.getByLabelText("Motion"), { target: { value: "on" } });
    expect(marchOf(svg, `0|${ROD}`)).not.toBeNull();
  });

  it("offers the Motion control when only caps can move", async () => {
    // One factory's flows to the other gone: no line, no transport, only the caps move.
    const edges = DATA.edges.filter((e) => e.destination === "storage" || e.destination === "sink");
    const svg = await overview(withData({ edges, transports: [] }));
    expect(svg.querySelectorAll('[data-edge-layer="lines"] [data-edge]')).toHaveLength(0);
    expect(screen.getByLabelText("Motion")).toBeInTheDocument();
    expect(marchOf(svg, `0|${PLATE}`)).not.toBeNull();
  });
});

describe("the caps' own budget (the e2e frame-time scenario)", () => {
  it("moves at most CAP_MARCH_MAX caps in view, fastest first, beside the lines, on 48 cards of caps", async () => {
    wideScreen();
    const svg = await overview(plannerCapsLarge);
    expect(svg.querySelectorAll("[data-cap], [data-cap-more]").length).toBeGreaterThan(100);
    expect(svg.querySelectorAll("[data-cap-more]").length).toBeGreaterThan(0);
    expect(svg.querySelectorAll("[data-cap-badge]").length).toBeGreaterThan(0);
    expect(svg.querySelectorAll('[data-cap-quality="unknown"]').length).toBeGreaterThan(0);
    const moving = [...(layerOf(svg)?.querySelectorAll("[data-march-cap]") ?? [])];
    expect(moving.length).toBeGreaterThan(0);
    expect(moving.length).toBeLessThanOrEqual(CAP_MARCH_MAX);
    // Fastest first: no slower step moves while a faster one in view is left still.
    const rank = new Map([["fast", 0], ["mid", 1], ["slow", 2]]);
    const steps = moving.map((m) => rank.get(m.getAttribute("data-march-step")!)!);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    // The lines move too, under their own budget, in the same layer.
    expect(layerOf(svg)!.querySelectorAll("[data-march-edge]").length).toBeGreaterThan(0);
    expect(svg.querySelector('[class*="animate-flow"], [data-march]')).toBeNull();
  });
});

describe("destination caps under reduced motion", () => {
  it("draws no layer under System and with Motion On, and every stub in the canvas", async () => {
    wideScreen(true);
    const svg = await overview();
    expect(layerOf(svg)).toBeNull();
    expect(capOf(svg, ROD, "sink")!.querySelector("[data-cap-stub]")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Motion"), { target: { value: "on" } });
    expect(layerOf(svg)).toBeNull();
    expect(document.querySelector("[data-march]")).toBeNull();
  });
});

describe("the caps' buttons (the keyboard and screen readers)", () => {
  beforeEach(() => wideScreen());

  it("is one tab stop for every cap, arrows move between them, and the focused one is ringed in the picture", async () => {
    const svg = await overview();
    const buttons = capButtons();
    expect(buttons.map((b) => b.textContent)).toEqual(["Iron Plate factory sends 48 items/min to storage", "Iron Rod factory sends about 6 items/min to the Sink"]);
    expect(buttons.map((b) => b.tabIndex)).toEqual([0, -1]);
    act(() => buttons[0].focus());
    expect(capOf(svg, PLATE, "storage")!.querySelector("circle")).toHaveClass("stroke-accent");
    fireEvent.keyDown(buttons[0], { key: "ArrowRight" });
    expect(document.activeElement).toBe(buttons[1]);
    expect(capOf(svg, ROD, "sink")!.querySelector("circle")).toHaveClass("stroke-accent");
    expect(capOf(svg, PLATE, "storage")!.querySelector("circle")).not.toHaveClass("stroke-accent");
    // The last one focused keeps the tab stop.
    expect(capButtons().map((b) => b.tabIndex)).toEqual([-1, 0]);
    fireEvent.keyDown(buttons[1], { key: "Home" });
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("opens the factory, whose facts list every destination in words", async () => {
    await overview();
    fireEvent.click(capButtons()[0]);
    expect(await screen.findByRole("img", { name: /^Graph of Iron Plate factory/ }, { timeout: 3_000 })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Where Iron Plate factory sends its output" })).toHaveTextContent("1 flow to storage");
  });

  it("a drawn cap's click opens the factory too", async () => {
    const svg = await overview();
    fireEvent.click(capOf(svg, ROD, "sink")!);
    expect(await screen.findByRole("img", { name: /^Graph of Iron Rod factory/ }, { timeout: 3_000 })).toBeInTheDocument();
  });
});

describe("a group's folded storage as a cap (Storage detail off)", () => {
  beforeEach(() => wideScreen());

  it("draws the storage cap on the group that fills it, and its button opens the group's panel", async () => {
    window.localStorage.setItem(STORAGE_DETAIL_KEY, "off");
    await overview();
    fireEvent.click(await screen.findByRole("button", { name: /^Open factory: Iron Plate factory./ }));
    const svg = await screen.findByRole("img", { name: /^Graph of Iron Plate factory/ }, { timeout: 3_000 });
    const group = DATA.edges.find((e) => e.destination === "storage")!.from;
    expect(capsOf(svg, group).map((c) => c.getAttribute("data-cap"))).toEqual(["storage"]);
    expect(capOf(svg, group, "storage")!.getAttribute("data-cap-step")).toBe("slow");
    const [button] = capButtons();
    expect(button.textContent).toMatch(/ sends 48 items\/min to storage$/);
    fireEvent.click(button);
    const panel = await screen.findByRole("region", { name: /Constructor/ });
    expect(panel).toHaveTextContent("1 flow to storage");
  });
});
