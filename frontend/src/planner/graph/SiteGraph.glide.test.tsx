import { act, fireEvent, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../../servers/ServerContext";
import { renderWithClient } from "../../test/render";
import { PlannerView } from "../PlannerView";
import { ITEM_FOCUS_KEY } from "./plannerPrefs";

// jsdom loads no stylesheet, so the motion token reads as 0 and focus jumps; here the glide lasts 200 ms (ADR-0060 D4).
vi.mock("./useTween", async (importOriginal) => ({ ...(await importOriginal<typeof import("./useTween")>()), tweenMs: () => 200 }));

beforeEach(() => window.localStorage.setItem(ITEM_FOCUS_KEY, "on"));
afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

async function openGraph() {
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

const cards = (svg: HTMLElement) => Object.fromEntries([...svg.querySelectorAll("[data-node]")].map((g) => [g.getAttribute("data-node"), g.getAttribute("transform")]));

describe("the make-room glide", () => {
  it("slides the cards and cross-fades the lines, then lands exactly on the new layout with nothing left over", async () => {
    const svg = await openGraph();
    const before = cards(svg);
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    fireEvent.click(svg.querySelector('[data-bubble="Desc_OreIron_C"]')!);
    // At the start: the old lines over the new, the new faded out, the cards still where they were on screen.
    const ghost = svg.querySelector("[data-ghost]");
    expect(ghost).not.toBeNull();
    expect(ghost).toHaveAttribute("aria-hidden", "true");
    const fresh = svg.querySelector('[data-edge-layer="lines"]')!.parentElement!;
    expect(fresh).toHaveAttribute("opacity", "0");
    const start = cards(svg);
    act(() => vi.advanceTimersByTime(100));
    const halfway = cards(svg);
    expect(halfway).not.toEqual(start);
    expect(Number(fresh.getAttribute("opacity"))).toBeGreaterThan(0);
    expect(Number(fresh.getAttribute("opacity"))).toBeLessThan(1);
    act(() => vi.advanceTimersByTime(200));
    expect(svg.querySelector("[data-ghost]")).toBeNull();
    expect(fresh).not.toHaveAttribute("opacity");
    const end = cards(svg);
    expect(end).not.toEqual(before);
    expect(end).not.toEqual(halfway);
    // Attributes only, never a style attribute (the CSP and the e2e guard).
    expect(svg.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("jumps with Motion set to Off: no ghost, no fade, the cards at once where they end", async () => {
    window.localStorage.setItem("planner.motion", "off");
    const svg = await openGraph();
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    fireEvent.click(svg.querySelector('[data-bubble="Desc_OreIron_C"]')!);
    expect(svg.querySelector("[data-ghost]")).toBeNull();
    expect(svg.querySelector('[data-edge-layer="lines"]')!.parentElement).not.toHaveAttribute("opacity");
    const now = cards(svg);
    act(() => vi.advanceTimersByTime(300));
    expect(cards(svg)).toEqual(now);
  });
});
