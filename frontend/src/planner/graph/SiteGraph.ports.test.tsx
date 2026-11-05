import { act, fireEvent, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../../servers/ServerContext";
import { renderWithClient } from "../../test/render";
import { PlannerView } from "../PlannerView";
import { clearLayoutMemo } from "./layoutSite";
import { PORT_ARROWS_KEY, PORTS_KEY } from "./plannerPrefs";

// ADR-0063 build PR 2: item ports on the card edges, behind the `planner.ports` flag (off by default).

beforeEach(() => {
  window.localStorage.clear();
  clearLayoutMemo();
});
afterEach(() => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0))));

async function openGraph(prefs: Record<string, string> = {}) {
  for (const [k, v] of Object.entries(prefs)) window.localStorage.setItem(k, v);
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

const lines = (svg: HTMLElement) => [...svg.querySelectorAll<SVGPathElement>('[data-edge-layer="lines"] [data-edge] > path:first-of-type')];

describe("ports, flag off (the default)", () => {
  it("draws no port and keeps every arrowhead", async () => {
    const svg = await openGraph();
    expect(svg.querySelector("[data-port]")).toBeNull();
    expect(lines(svg).length).toBeGreaterThan(0);
    for (const l of lines(svg)) expect(l).toHaveAttribute("marker-end");
  });
});

describe("ports, flag on", () => {
  it("draws a disc per port inside its card, an input on the left and an output on the right, each with its words", async () => {
    const svg = await openGraph({ [PORTS_KEY]: "on" });
    const ports = [...svg.querySelectorAll("[data-port]")];
    expect(ports.length).toBeGreaterThan(0);
    for (const p of ports) {
      // Part of the card: inside its group, so a click on it is the card's.
      expect(p.closest("[data-card]")).not.toBeNull();
      // A return flow's ports are the other way round (out on the left, in on the right).
      const inSide = p.hasAttribute("data-port-returning") ? "r" : "l";
      expect(p.getAttribute("data-port-side")).toBe(p.getAttribute("data-port-dir") === "in" ? inSide : inSide === "l" ? "r" : "l");
      expect(p.querySelector("title")?.textContent).toMatch(/ (in|out), /);
      // Never blank: an icon, or its initials.
      expect(p.querySelector("image, text")).not.toBeNull();
    }
    // Nothing new to tab to.
    for (const p of ports) expect(p.querySelector("[tabindex]")).toBeNull();
  });

  it("drops the arrowhead on a line into an input port (open question 5's recommended form), and keeps it on a return line", async () => {
    const svg = await openGraph({ [PORTS_KEY]: "on" });
    const pathOf = (g: Element) => g.querySelector("path")!;
    const forward = [...svg.querySelectorAll('[data-edge-layer="lines"] [data-edge]:not([data-stalled]):not([data-returning])')].map(pathOf);
    expect(forward.length).toBeGreaterThan(0);
    for (const l of forward) expect(l).not.toHaveAttribute("marker-end");
    for (const l of [...svg.querySelectorAll('[data-edge-layer="lines"] [data-edge][data-returning]')].map(pathOf)) expect(l).toHaveAttribute("marker-end");
  });

  it("keeps the arrowhead when the owner's answer is 'keep'", async () => {
    const svg = await openGraph({ [PORTS_KEY]: "on", [PORT_ARROWS_KEY]: "keep" });
    for (const l of lines(svg)) expect(l).toHaveAttribute("marker-end");
  });
});
