import { act, fireEvent, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { endpoints, ProductionGraphResponseSchema } from "@satisfactory-dash/shared";
import { productionGraphTwoSites, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../../servers/ServerContext";
import { renderWithClient } from "../../test/render";
import { server } from "../../test/server";
import { PlannerView } from "../PlannerView";
import { FOCUS_CARD_H, FOCUS_CARD_W } from "./layoutSite";
import { ITEM_FOCUS_KEY } from "./plannerPrefs";

// Hunt tests for the march layer: a hidden tab, the open item card's hole in the mask, and dimming with the canvas line.
const DATA = ProductionGraphResponseSchema.parse(productionGraphTwoSites).data;

beforeEach(() => window.localStorage.setItem(ITEM_FOCUS_KEY, "on"));
afterEach(() => {
  Reflect.deleteProperty(document, "visibilityState");
  window.localStorage.clear();
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
});

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
  return screen.findByRole("img", { name: /^Graph of Iron Plate site/ }, { timeout: 15_000 });
}

const layerOf = (svg: Element) => svg.parentElement!.querySelector<SVGSVGElement>(":scope > [data-march-layer]");
const box = (el: Element) => ["x", "y", "width", "height"].map((a) => Number(el.getAttribute(a)).toFixed(2)).join(",");

describe("the march layer, hunted", () => {
  it("draws nothing in a hidden tab, and again when the tab is back", async () => {
    const svg = await openGraph();
    expect(layerOf(svg)).not.toBeNull();
    const show = (state: "hidden" | "visible") => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
    };
    show("hidden");
    expect(layerOf(svg)).toBeNull();
    show("visible");
    expect(layerOf(svg)).not.toBeNull();
  });

  it("cuts the open item card out of the mask at its full size", async () => {
    const svg = await openGraph();
    const holes = () => new Set([...layerOf(svg)!.querySelectorAll("mask rect.fill-black")].map(box));
    const before = holes().size;
    fireEvent.click(svg.querySelector('[data-edge-layer="labels"] [data-bubble="Desc_OreIron_C"]')!);
    const after = holes();
    expect(after.size).toBeGreaterThan(before);
    expect([...after].some((b) => b.split(",").slice(2).join(",") === `${FOCUS_CARD_W.toFixed(2)},${FOCUS_CARD_H.toFixed(2)}`)).toBe(true);
  });

  it("dims a marching line with its canvas line when another line is in focus", async () => {
    const svg = await openGraph();
    fireEvent.click(svg.querySelector('[data-edge-layer="labels"] [data-bubble="Desc_OreIron_C"]')!);
    const canvasDim = new Set([...svg.querySelectorAll('[data-edge-layer="lines"] [data-edge]')].filter((g) => g.classList.contains("opacity-graph-dim")).map((g) => g.getAttribute("data-edge")));
    const marched = [...layerOf(svg)!.querySelectorAll("[data-march-edge]")];
    expect(marched.length).toBeGreaterThan(0);
    for (const m of marched) {
      const dimmed = m.querySelector(":scope > g")!.classList.contains("opacity-graph-dim");
      expect(dimmed).toBe(canvasDim.has(m.getAttribute("data-march-edge")));
    }
    expect(canvasDim.size).toBeGreaterThan(0);
  });
});
