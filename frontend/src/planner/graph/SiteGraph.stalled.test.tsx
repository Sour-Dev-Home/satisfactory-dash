import { act, fireEvent, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { endpoints, ProductionGraphResponseSchema, type PlannerNode } from "@satisfactory-dash/shared";
import { productionGraphTwoSites, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../../servers/ServerContext";
import { renderWithClient } from "../../test/render";
import { server } from "../../test/server";
import { PlannerView } from "../PlannerView";
import { STATE_STYLE_KEY } from "./plannerPrefs";

// ADR-0062 build PR 2: stalled marks on the canvas, and the marks/words toggle. The words never leave the text path.
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
});

const DATA = ProductionGraphResponseSchema.parse(productionGraphTwoSites).data;
const SMELTER = "Build_SmelterMk1_C|Iron Ingot|1200|-400";
/** The iron site with its smelters all backed up, their ingot reading 0. */
const backedUp = {
  ...productionGraphTwoSites,
  data: {
    ...DATA,
    nodes: DATA.nodes.map((n): PlannerNode => (n.key === SMELTER ? { ...n, stateCounts: { backedUp: 4 }, products: [{ ...n.products[0], currentPerMinute: 0 }] } : n)),
  },
};

/**
 * The same, with the smelters' line's rate too wide for an end label's rate row: its labels do not fit, so it draws its
 * middle bubble (ADR-0063 Decision 2's fallback), which wears the stalled ring. An end-labelled line has no bubble to ring.
 */
const backedUpBubble = {
  ...backedUp,
  data: { ...backedUp.data, edges: DATA.edges.map((e) => (e.from === SMELTER ? { ...e, ratePerMinute: 123456789012.5 } : e)) },
};

async function openGraph(body: object = backedUp) {
  server.use(http.get(endpoints.productionGraph.route, () => HttpResponse.json(body)));
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

const smelterCard = (svg: Element) => [...svg.querySelectorAll("[data-node]")].find((g) => g.getAttribute("data-node") === SMELTER)!;
/** The words a card prints (its `<text>` nodes), not its tooltip. */
const printed = (card: Element) => [...card.querySelectorAll("text")].map((t) => t.textContent);
const stalledLine = (svg: Element) => svg.querySelector('[data-edge][data-stalled="backedUp"]');
const lineTitles = (svg: Element) => [...svg.querySelectorAll("[data-edge] > title")].map((t) => t.textContent ?? "");

/** What must hold in either style: the words in the card's tooltip and keyboard name, the line's tooltip, the canvas label. */
function expectWordsKept(svg: Element) {
  expect(smelterCard(svg).querySelector(":scope > title")!.textContent).toContain("· backed up");
  expect(screen.getByRole("button", { name: /^4× Smelter.*backed up/ })).toBeInTheDocument();
  expect(lineTitles(svg).some((t) => t.includes("The source is backed up"))).toBe(true);
  expect(svg.getAttribute("aria-label")).toMatch(/^Graph of Iron Plate site: /);
}

describe("stalled marks (the default)", () => {
  it("ends the stalled line in a stop bar and draws the glyph for the card's word", async () => {
    const svg = await openGraph();
    const line = stalledLine(svg)!;
    expect(line).not.toBeNull();
    const end = line.querySelector("path")!.getAttribute("marker-end")!;
    expect(end).toMatch(/-backedUp\)$/);
    expect(svg.querySelector(`marker[id="${end.slice(5, -1)}"] [data-stop-bar="backedUp"]`)).not.toBeNull();
    // Only that line: the rest keep the arrowhead.
    expect(svg.querySelectorAll("[data-edge][data-stalled]")).toHaveLength(1);
    // It draws end labels, so no middle bubble and no ring (the fallback's, below).
    expect(svg.querySelector(`[data-edge-label="${line.getAttribute("data-edge")}"]`)).toBeNull();
    expect(svg.querySelector("[data-stalled-ring], [data-bubble-mark]")).toBeNull();
    const card = smelterCard(svg);
    expect(card.querySelector('[data-card-mark="backedUp"] [data-state-mark="backedUp"]')).not.toBeNull();
    expect(printed(card)).not.toContain("Backed up");
    expectWordsKept(svg);
  });

  it("rings a fallback line's bubble with a corner mark, its line still ending in the stop bar", async () => {
    const svg = await openGraph(backedUpBubble);
    const line = stalledLine(svg)!;
    expect(line.querySelector("path")!.getAttribute("marker-end")).toMatch(/-backedUp\)$/);
    const label = svg.querySelector(`[data-edge-label="${line.getAttribute("data-edge")}"]`)!;
    expect(label.querySelector('[data-stalled-ring="backedUp"]')).not.toBeNull();
    expect(label.querySelector('[data-bubble-mark="backedUp"] [data-state-mark="backedUp"]')).not.toBeNull();
    expectWordsKept(svg);
  });

  it("is a pressed toolbar button with a name, and pressing it goes to words, remembered", async () => {
    const svg = await openGraph();
    const toggle = screen.getByRole("button", { name: "State marks" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(window.localStorage.getItem(STATE_STYLE_KEY)).toBe("words");
    expect(svg.querySelector("[data-stalled], [data-stalled-ring], [data-bubble-mark], [data-card-mark], [data-stop-bar]")).toBeNull();
    expect(printed(smelterCard(svg))).toContain("Backed up");
    expectWordsKept(svg);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(stalledLine(svg)).not.toBeNull();
  });
});

describe("the legend's stop bar and the stalled line's words (amendment build PR 5)", () => {
  const legendItems = () => within(screen.getByRole("list", { name: "Line styles" })).getAllByRole("listitem").map((li) => li.textContent);

  it("shows the stop bar's row while a stalled line is drawn in marks mode, and not in words mode", async () => {
    await openGraph();
    expect(legendItems()).toContain("stalled");
    const row = within(screen.getByRole("list", { name: "Line styles" })).getByText("stalled").closest("li")!;
    expect(row.querySelector('svg[aria-hidden="true"] [data-stop-bar="backedUp"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "State marks" }));
    expect(legendItems()).not.toContain("stalled");
  });

  it("gives a stalled line no step word, only its stalled words, while a moving line names its step", async () => {
    const svg = await openGraph();
    const stalled = stalledLine(svg)!.querySelector(":scope > title")!.textContent!;
    expect(stalled).toContain("The source is backed up");
    expect(stalled).not.toMatch(/, (slow|medium|fast)\b/);
    expect(lineTitles(svg).filter((t) => !t.includes("backed up")).some((t) => /\), (slow|medium|fast)/.test(t))).toBe(true);
  });
});

describe("words mode", () => {
  it("draws today's canvas: the arrowhead, plain bubbles, the word on the card, and no marks", async () => {
    window.localStorage.setItem(STATE_STYLE_KEY, "words");
    const svg = await openGraph();
    expect(screen.getByRole("button", { name: "State marks" })).toHaveAttribute("aria-pressed", "false");
    expect(svg.querySelector("[data-state-mark], [data-stop-bar], [data-stalled], [data-stalled-ring]")).toBeNull();
    const ends = new Set([...svg.querySelectorAll("[data-edge] path[marker-end]")].map((p) => p.getAttribute("marker-end")));
    expect(ends.size).toBe(1);
    expect(printed(smelterCard(svg))).toContain("Backed up");
    expectWordsKept(svg);
  });
});
