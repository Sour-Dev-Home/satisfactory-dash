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
// and reduced motion still; only lines in the settled view, at most MARCH_MAX.
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

const lines = (svg: Element) =>
  [...svg.querySelectorAll('[data-edge-layer="lines"] [data-edge]')].map((g) => ({
    g,
    title: g.querySelector(":scope > title")!.textContent ?? "",
    path: g.querySelector(":scope > path[marker-end]")!,
    inner: g.querySelector(":scope > path[data-mixed-inner]"),
    pulse: g.querySelector(":scope > path[data-march-pulse]"),
  }));
const lineFor = (svg: Element, words: RegExp) => {
  const found = lines(svg).filter((l) => words.test(l.title));
  expect(found, String(words)).toHaveLength(1);
  return found[0];
};
const animated = (el: Element | null) => [...(el?.classList ?? [])].filter((c) => c.startsWith("animate-flow"));
const marchingCount = (svg: Element) => lines(svg).filter((l) => l.g.querySelector("[data-march]") !== null).length;

describe("marching dashes on the canvas", () => {
  it("marches a measured line by pulses over its solid stroke, at its step, hidden unless they run", async () => {
    const svg = await openGraph();
    const ore = lineFor(svg, /: Iron Ore · 120 items\/min/);
    // The line itself stays solid and still: measured never looks dashed.
    expect(ore.path.getAttribute("stroke-dasharray")).toBeNull();
    expect(animated(ore.path)).toEqual([]);
    expect(ore.pulse).not.toBeNull();
    expect(animated(ore.pulse)).toEqual(["animate-flow-pulse-mid"]);
    expect(ore.pulse).toHaveClass("opacity-0", "stroke-fg-strong");
    expect(ore.pulse!.getAttribute("data-march")).toBe("mid");
    expect(ore.pulse!.getAttribute("stroke-dasharray")).toBe(PULSE_DASH);
    // Thinner than the line, so it reads as light on the line, not as the line's own dashes.
    expect(Number(ore.pulse!.getAttribute("stroke-width"))).toBeLessThan(Number(ore.path.getAttribute("stroke-width")));
    expect(ore.pulse!.getAttribute("marker-end")).toBeNull();
    // A slow measured line pulses at the slow step.
    expect(animated(lineFor(svg, /: Iron Plate · 4 items\/min/).pulse)).toEqual(["animate-flow-pulse-slow"]);
  });

  it("marches an estimated line's own dashes at its step, with no pulses", async () => {
    const svg = await openGraph();
    const ingot = lineFor(svg, /: Iron Ingot · about 102\.2 items\/min/);
    expect(ingot.path.getAttribute("stroke-dasharray")).toBe("8 5");
    expect(animated(ingot.path)).toEqual(["animate-flow-slow"]);
    expect(ingot.path.getAttribute("data-march")).toBe("slow");
    expect(ingot.pulse).toBeNull();
  });

  it("keeps an unknown line still and dotted", async () => {
    const svg = await openGraph();
    const unknown = lines(svg).filter((l) => l.path.getAttribute("stroke-dasharray") === "2 5");
    expect(unknown).toHaveLength(1);
    expect(unknown[0].g.querySelector("[data-march]")).toBeNull();
    expect(animated(unknown[0].path)).toEqual([]);
    expect(animated(unknown[0].inner)).toEqual([]);
  });

  it("marches a mixed estimated belt's inner dashes in step with its outer ones", async () => {
    const edges = DATA.edges.map((e) => (e.mixed ? { ...e, ratePerMinute: 150, rate: "estimated" as const } : e));
    const svg = await openGraph({ ...productionGraphTwoSites, data: { ...DATA, edges } });
    const [mixed] = lines(svg).filter((l) => l.inner !== null);
    expect(animated(mixed.path)).toEqual(["animate-flow-mid"]);
    expect(animated(mixed.inner)).toEqual(["animate-flow-inner-mid"]);
    // The still frame is unchanged: the inner dashes start half a unit in, centred in the outer ones.
    expect(mixed.inner!.getAttribute("stroke-dashoffset")).toBe("-0.5");
    expect(mixed.pulse).toBeNull();
  });

  it("pulses a mixed measured belt in its core, at the inner stroke's width or the floor", async () => {
    const edges = DATA.edges.map((e) => (e.mixed ? { ...e, ratePerMinute: 150, rate: "measured" as const } : e));
    const svg = await openGraph({ ...productionGraphTwoSites, data: { ...DATA, edges } });
    const [mixed] = lines(svg).filter((l) => l.inner !== null);
    expect(animated(mixed.path)).toEqual([]);
    expect(animated(mixed.inner)).toEqual([]);
    expect(animated(mixed.pulse)).toEqual(["animate-flow-pulse-mid"]);
    // Mid: the inner stroke is 1, under the floor, so the pulse is the floor's width.
    expect(Number(mixed.pulse!.getAttribute("stroke-width"))).toBe(Math.max(PULSE_MIN_W, Number(mixed.inner!.getAttribute("stroke-width"))));
    expect(Number(mixed.pulse!.getAttribute("stroke-width"))).toBe(PULSE_MIN_W);
  });

  it("keeps a stalled line still, in marks and in words", async () => {
    const svg = await openGraph(productionGraphStalled);
    const stalled = lines(svg).filter((l) => l.g.hasAttribute("data-stalled"));
    expect(stalled.length).toBeGreaterThan(0);
    for (const l of stalled) expect(l.g.querySelector("[data-march]"), l.title).toBeNull();
    // Something else on the site still marches, so the stalled lines are still by their state, not by a motion setting.
    expect(marchingCount(svg)).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "State marks" }));
    const titles = stalled.map((l) => l.title);
    for (const l of lines(svg).filter((x) => titles.includes(x.title))) expect(l.g.querySelector("[data-march]"), l.title).toBeNull();
  });

  it("marches nothing with Motion Off, and again once it is back on", async () => {
    const svg = await openGraph();
    expect(marchingCount(svg)).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Motion"), { target: { value: "off" } });
    expect(svg.querySelectorAll("[data-march]")).toHaveLength(0);
    expect(svg.querySelectorAll("[data-march-pulse]")).toHaveLength(0);
    expect(svg.querySelector('[class*="animate-flow"]')).toBeNull();
    fireEvent.change(screen.getByLabelText("Motion"), { target: { value: "on" } });
    expect(marchingCount(svg)).toBeGreaterThan(0);
  });

  it("has no Motion control where nothing can move (every rate unknown, no transport)", async () => {
    const edges = DATA.edges.map((e) => ({ ...e, ratePerMinute: null, rate: "unknown" as const }));
    const svg = await openGraph({ ...productionGraphTwoSites, data: { ...DATA, edges } });
    expect(svg.querySelectorAll("[data-march]")).toHaveLength(0);
    expect(screen.queryByLabelText("Motion")).not.toBeInTheDocument();
  });

  it("marches nothing under System when the operator asks for reduced motion", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), addEventListener: () => {}, removeEventListener: () => {} }));
    const svg = await openGraph();
    expect(svg.querySelectorAll("[data-march]")).toHaveLength(0);
  });

  it("caps a 210-line site at MARCH_MAX, and a zoom changes the set once the view settles", async () => {
    const svg = await openGraph(plannerLarge, "Large site");
    expect(lines(svg).length).toBeGreaterThan(200);
    const before = marchingCount(svg);
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThanOrEqual(MARCH_MAX);
    // Every marching line is one that may march (no unknown, dotted line); the cap's order is marching.test.ts's.
    for (const l of lines(svg).filter((x) => x.g.querySelector("[data-march]") !== null)) expect(l.path.getAttribute("stroke-dasharray")).not.toBe("2 5");
    const marchingTitles = () => lines(svg).filter((l) => l.g.querySelector("[data-march]") !== null).map((l) => l.title);
    const was = marchingTitles();
    // Zoom far in: most lines leave the view. The set waits for the view to settle, then follows it.
    const viewport = screen.getByRole("group", { name: /^Graph viewport/ });
    for (let i = 0; i < 6; i++) fireEvent.keyDown(viewport, { key: "+" });
    expect(marchingTitles()).toEqual(was);
    await waitFor(() => expect(marchingTitles()).not.toEqual(was), { timeout: MARCH_SETTLE_MS * 40 });
    expect(marchingCount(svg)).toBeLessThanOrEqual(MARCH_MAX);
  }, 30_000);
});
