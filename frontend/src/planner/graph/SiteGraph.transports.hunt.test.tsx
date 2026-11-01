import { act, fireEvent, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { endpoints, ProductionGraphResponseSchema } from "@satisfactory-dash/shared";
import { productionGraphFactories, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../../servers/ServerContext";
import { renderWithClient } from "../../test/render";
import { server } from "../../test/server";
import { PlannerView } from "../PlannerView";
import { MOTION_KEY } from "./plannerPrefs";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
});

const DATA = ProductionGraphResponseSchema.parse(productionGraphFactories).data;
const TRAINS = DATA.transports!.length;

function reducedMotionScreen() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width") || query.includes("prefers-reduced-motion"),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

async function openGraph() {
  server.use(http.get(endpoints.productionGraph.route, () => HttpResponse.json(productionGraphFactories)));
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

describe("transport glyphs hunt", () => {
  it("Motion On still moves glyphs under reduced motion, each shown exactly once, and no line marches", async () => {
    reducedMotionScreen();
    window.localStorage.setItem(MOTION_KEY, "on");
    const svg = await openGraph();
    const host = svg.parentElement!;
    const moving = host.querySelectorAll("[data-march-glyphs] animateMotion");
    expect(moving.length).toBe(TRAINS);
    expect(svg.querySelectorAll("[data-glyph]")).toHaveLength(0);
    expect(host.querySelectorAll("[data-glyph]")).toHaveLength(TRAINS);
    expect(host.querySelector("[data-march-edge]")).toBeNull();
  });

  it("a hidden tab puts every glyph back at rest in the canvas, once each", async () => {
    reducedMotionScreen();
    window.localStorage.setItem(MOTION_KEY, "on");
    const svg = await openGraph();
    expect(svg.parentElement!.querySelectorAll("animateMotion").length).toBe(TRAINS);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(svg.parentElement!.querySelector("animateMotion")).toBeNull();
    expect(svg.querySelectorAll("[data-glyph]")).toHaveLength(TRAINS);
  });
});
