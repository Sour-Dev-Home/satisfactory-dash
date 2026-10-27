import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { productionGraphTwoSites, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../../servers/ServerContext";
import { renderWithClient } from "../../test/render";
import { server } from "../../test/server";
import { PlannerView } from "../PlannerView";
import { BUBBLE_D } from "./bubbleRow";
import { CARD_RX } from "./itemCardText";
import { FOCUS_CARD_H, FOCUS_CARD_W } from "./layoutSite";
import { ITEM_FOCUS_KEY } from "./plannerPrefs";

// jsdom loads no stylesheet, so the motion token reads as 0 and focus jumps; here the glide lasts 200 ms (ADR-0060 D4).
vi.mock("./useTween", async (importOriginal) => ({ ...(await importOriginal<typeof import("./useTween")>()), tweenMs: () => 200 }));

beforeEach(() => window.localStorage.setItem(ITEM_FOCUS_KEY, "on"));
afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

let client: ReturnType<typeof renderWithClient>["client"];

async function openGraph() {
  ({ client } = renderWithClient(
    <MemoryRouter>
      <ServerContext value={serversSingle.servers[0]}>
        <PlannerView />
      </ServerContext>
    </MemoryRouter>,
  ));
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

  it("lands where an uninterrupted glide would when a second focus change cuts the first short, with nothing left over", async () => {
    const plate = '[data-edge-layer="labels"] [data-bubble="Desc_IronPlate_C"]';
    const ore = '[data-bubble="Desc_OreIron_C"]';
    // Reference: let the first glide finish, then focus the second line.
    let svg = await openGraph();
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    fireEvent.click(svg.querySelector(ore)!);
    act(() => vi.advanceTimersByTime(300));
    fireEvent.click(svg.querySelector(plate)!);
    act(() => vi.advanceTimersByTime(300));
    const expected = cards(svg);
    cleanup();
    vi.useRealTimers();
    // Interrupted: the second click arrives halfway through the first glide.
    svg = await openGraph();
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    fireEvent.click(svg.querySelector(ore)!);
    act(() => vi.advanceTimersByTime(100));
    fireEvent.click(svg.querySelector(plate)!);
    act(() => vi.advanceTimersByTime(300));
    expect(cards(svg)).toEqual(expected);
    expect(svg.querySelector("[data-ghost]")).toBeNull();
    expect(svg.querySelector('[data-edge-layer="lines"]')!.parentElement).not.toHaveAttribute("opacity");
  });

  it("ends where the picture now is when a poll changes the cards mid-glide, not where the glide was heading", async () => {
    const ore = '[data-edge-layer="labels"] [data-bubble="Desc_OreIron_C"]';
    // The poll turns the plate line round: the same cards and the same number of lines (so nothing remounts), but a new
    // topology, so dagre places the cards again and React rewrites their transforms while the glide still runs.
    const polled = {
      ...productionGraphTwoSites,
      data: { ...productionGraphTwoSites.data, edges: productionGraphTwoSites.data.edges.map((e) => (e.itemClassName === "Desc_IronPlate_C" ? { ...e, from: e.to, to: e.from } : e)) },
    };
    // Reference: the polled data from the start, focused with no glide.
    window.localStorage.setItem("planner.motion", "off");
    server.use(http.get(endpoints.productionGraph.route, () => HttpResponse.json(polled)));
    let svg = await openGraph();
    fireEvent.click(svg.querySelector(ore)!);
    const expected = cards(svg);
    cleanup();
    server.resetHandlers();
    window.localStorage.setItem("planner.motion", "on");
    // The poll lands 100 ms into a 200 ms glide.
    svg = await openGraph();
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    fireEvent.click(svg.querySelector(ore)!);
    act(() => vi.advanceTimersByTime(100));
    server.use(http.get(endpoints.productionGraph.route, () => HttpResponse.json(polled)));
    // Only animation frames and the clock are fake, so the refetch runs on real timers while the glide waits.
    await act(() => client.invalidateQueries());
    // React Query tells its subscribers on a later tick.
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    act(() => vi.advanceTimersByTime(300));
    expect(svg.querySelector("[data-focused]")).not.toBeNull();
    expect(cards(svg)).toEqual(expected);
    expect(svg.querySelector("[data-ghost]")).toBeNull();
  });

  it("morphs the bubble into the card: one rect from a circle to the card, the words fading in at the end; closing runs it back", async () => {
    const svg = await openGraph();
    const ore = '[data-edge-layer="labels"] [data-bubble="Desc_OreIron_C"]';
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    fireEvent.click(svg.querySelector(ore)!);
    const card = svg.querySelector("[data-item-card]")!;
    const box = card.querySelector(":scope > rect")!;
    const words = box.nextElementSibling!.nextElementSibling!;
    // t = 0: the bubble.
    expect(box).toHaveAttribute("width", String(BUBBLE_D));
    expect(box).toHaveAttribute("height", String(BUBBLE_D));
    expect(box).toHaveAttribute("rx", String(BUBBLE_D / 2));
    expect(words).toHaveAttribute("opacity", "0");
    act(() => vi.advanceTimersByTime(100));
    const w = Number(box.getAttribute("width"));
    expect(w).toBeGreaterThan(BUBBLE_D);
    expect(w).toBeLessThan(FOCUS_CARD_W);
    act(() => vi.advanceTimersByTime(200));
    // t = 1: the card, its words shown.
    expect(box).toHaveAttribute("width", String(FOCUS_CARD_W));
    expect(box).toHaveAttribute("height", String(FOCUS_CARD_H));
    expect(box).toHaveAttribute("rx", String(CARD_RX));
    expect(words).not.toHaveAttribute("opacity");
    // Closing: the card shrinks back to its bubble, then goes.
    fireEvent.keyDown(screen.getByRole("group", { name: /^Graph viewport/ }), { key: "Escape" });
    const closing = svg.querySelector("[data-item-card][data-closing]")!;
    expect(closing).not.toBeNull();
    act(() => vi.advanceTimersByTime(100));
    expect(Number(closing.querySelector(":scope > rect")!.getAttribute("width"))).toBeLessThan(FOCUS_CARD_W);
    act(() => vi.advanceTimersByTime(200));
    expect(svg.querySelector("[data-item-card]")).toBeNull();
    expect(svg.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("drops a closing card whose line a poll took away, so it does not reappear when the line comes back", async () => {
    const svg = await openGraph();
    const ore = '[data-edge-layer="labels"] [data-bubble="Desc_OreIron_C"]';
    const data = productionGraphTwoSites.data;
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    fireEvent.click(svg.querySelector(ore)!);
    act(() => vi.advanceTimersByTime(300));
    fireEvent.keyDown(screen.getByRole("group", { name: /^Graph viewport/ }), { key: "Escape" });
    expect(svg.querySelector("[data-item-card][data-closing]")).not.toBeNull();
    server.use(http.get(endpoints.productionGraph.route, () => HttpResponse.json({ ...productionGraphTwoSites, data: { ...data, edges: data.edges.filter((e) => e.itemClassName !== "Desc_OreIron_C") } })));
    // React Query notifies on a later tick; the timers faked here are only the frame ones, so a real wait is fine.
    const poll = () => act(async () => { await client.invalidateQueries(); await new Promise((r) => setTimeout(r, 50)); });
    await poll();
    expect(svg.querySelector("[data-item-card]")).toBeNull();
    server.use(http.get(endpoints.productionGraph.route, () => HttpResponse.json(productionGraphTwoSites)));
    await poll();
    expect(svg.querySelector("[data-item-card]")).toBeNull();
  });

  it("re-focusing the item while its card closes leaves one open card, and no closing one", async () => {
    const svg = await openGraph();
    const ore = '[data-edge-layer="labels"] [data-bubble="Desc_OreIron_C"]';
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    fireEvent.click(svg.querySelector(ore)!);
    act(() => vi.advanceTimersByTime(300));
    fireEvent.keyDown(screen.getByRole("group", { name: /^Graph viewport/ }), { key: "Escape" });
    act(() => vi.advanceTimersByTime(50));
    fireEvent.click(svg.querySelector(ore)!);
    expect(svg.querySelectorAll("[data-item-card]")).toHaveLength(1);
    expect(svg.querySelector("[data-item-card][data-closing]")).toBeNull();
    act(() => vi.advanceTimersByTime(300));
    expect(svg.querySelectorAll("[data-item-card]")).toHaveLength(1);
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
