import { act, fireEvent, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { endpoints, ProductionGraphResponseSchema, type PlannerNode } from "@satisfactory-dash/shared";
import { productionGraphTwoSites, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../../servers/ServerContext";
import { renderWithClient } from "../../test/render";
import { server } from "../../test/server";
import { PlannerView } from "../PlannerView";
import { LINE_W_BASE, LINE_W_FAST, LINE_W_MID, LINE_W_SLOW, MIXED_INNER_W_SLOW } from "./lineWidth";

// ADR-0062 amendment build PR 2: width means rate, and a mixed belt's inner stroke instead of extra width.
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
});

const DATA = ProductionGraphResponseSchema.parse(productionGraphTwoSites).data;

async function openGraph(data = DATA) {
  server.use(http.get(endpoints.productionGraph.route, () => HttpResponse.json({ ...productionGraphTwoSites, data })));
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

/** Each line's own path (the one with the marker), keyed by the start of its tooltip. */
const lines = (svg: Element) =>
  [...svg.querySelectorAll('[data-edge-layer="lines"] [data-edge]')].map((g) => ({
    title: g.querySelector(":scope > title")!.textContent ?? "",
    path: g.querySelector(":scope > path[marker-end]")!,
    inner: g.querySelector(":scope > path[data-mixed-inner]"),
    stalled: g.getAttribute("data-stalled"),
  }));
const lineFor = (svg: Element, words: RegExp) => {
  const found = lines(svg).filter((l) => words.test(l.title));
  expect(found, String(words)).toHaveLength(1);
  return found[0];
};
const widthOf = (path: Element) => Number(path.getAttribute("stroke-width"));

describe("line widths on the canvas", () => {
  it("draws each line at its rate's step: 120 items/min mid, 102.2 slow, an unknown rate the base width", async () => {
    const svg = await openGraph();
    expect(widthOf(lineFor(svg, /: Iron Ore · 120 items\/min/).path)).toBe(LINE_W_MID);
    expect(widthOf(lineFor(svg, /: Iron Ingot · about 102\.2 items\/min/).path)).toBe(LINE_W_SLOW);
    for (const l of lines(svg)) expect([LINE_W_SLOW, LINE_W_MID, LINE_W_FAST], l.title).toContain(widthOf(l.path));
  });

  it("draws the mixed belt at its rate's width with a thin inner stroke in the canvas colour, not wider", async () => {
    const svg = await openGraph();
    const mixed = lines(svg).filter((l) => l.path.classList.contains("stroke-warn"));
    expect(mixed).toHaveLength(1);
    const [m] = mixed;
    // The fixture's mixed belt has no rate: the base width, and its inner stroke on top.
    expect(widthOf(m.path)).toBe(LINE_W_BASE);
    expect(m.inner).not.toBeNull();
    expect(Number(m.inner!.getAttribute("stroke-width"))).toBe(MIXED_INNER_W_SLOW);
    expect(m.inner).toHaveClass("stroke-surface");
    expect(m.inner!.getAttribute("marker-end")).toBeNull();
    expect(m.inner!.getAttribute("stroke-dasharray")).toBe(m.path.getAttribute("stroke-dasharray"));
    expect(m.path.compareDocumentPosition(m.inner!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // No other line has one.
    expect(svg.querySelectorAll("[data-mixed-inner]")).toHaveLength(1);
  });

  it("widens a bundle by its summed rate: 120 + 400 items/min is fast though each link alone is not", async () => {
    const lime = { ...DATA.edges[0], itemClassName: "Desc_Stone_C", itemName: "Limestone", ratePerMinute: 400, rate: "measured" as const };
    const svg = await openGraph({ ...DATA, edges: [...DATA.edges, lime] });
    const bundle = lineFor(svg, /, 2 links: /);
    expect(bundle.title).toMatch(/120 items\/min.*400 items\/min/);
    const label = svg.querySelector(`[data-edge-label="${bundle.path.parentElement!.getAttribute("data-edge")}"]`)!;
    expect(label.querySelector(":scope > text")?.textContent).toBe("520 items/min");
    expect(widthOf(bundle.path)).toBe(LINE_W_FAST);
  });

  it("keeps every line's arrowhead (or stop bar), sized in canvas units so a 4-wide line does not swallow it", async () => {
    const lime = { ...DATA.edges[0], itemClassName: "Desc_Stone_C", itemName: "Limestone", ratePerMinute: 400, rate: "measured" as const };
    const svg = await openGraph({ ...DATA, edges: [...DATA.edges, lime] });
    for (const l of lines(svg)) {
      const id = l.path.getAttribute("marker-end")!.slice(5, -1);
      const marker = svg.querySelector(`marker[id="${id}"]`)!;
      expect(marker, l.title).not.toBeNull();
      expect(marker).toHaveAttribute("markerUnits", "userSpaceOnUse");
      // The head is as wide at its base as twice the widest line.
      expect(Number(marker.getAttribute("markerHeight"))).toBeGreaterThanOrEqual(2 * LINE_W_FAST);
    }
  });
});

describe("a stalled line (marks mode)", () => {
  const SMELTER = "Build_SmelterMk1_C|Iron Ingot|1200|-400";
  const backedUp = {
    ...DATA,
    nodes: DATA.nodes.map((n): PlannerNode => (n.key === SMELTER ? { ...n, stateCounts: { backedUp: 4 }, products: [{ ...n.products[0], currentPerMinute: 0 }] } : n)),
  };

  it("keeps its stop bar and its width follows the rate", async () => {
    const svg = await openGraph(backedUp);
    const stalled = lines(svg).filter((l) => l.stalled !== null);
    expect(stalled).toHaveLength(1);
    const [s] = stalled;
    expect(s.path.getAttribute("marker-end")).toMatch(/-backedUp\)$/);
    // The ingot line is estimated at 102.2 items/min in the fixture: slow, so 2.
    expect(widthOf(s.path)).toBe(LINE_W_SLOW);
  });
});
