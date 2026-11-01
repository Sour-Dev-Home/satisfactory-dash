import { act, fireEvent, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { factoryMixed, serversSingle } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../../servers/ServerContext";
import { renderWithClient } from "../../test/render";
import { server } from "../../test/server";
import { PlannerView } from "../PlannerView";

// Hunt: the floating card moves the view once, when it opens; crossing the lg breakpoint while it is open must not move it again.

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
});

/** matchMedia where only the lg query (64rem) is flipped by the test; every other min-width query matches. */
function stubBreakpoint(initialLarge: boolean) {
  let large = initialLarge;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return query.includes("64rem") ? large : true;
    },
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }));
  return (next: boolean) => {
    large = next;
    act(() => listeners.forEach((l) => l()));
  };
}

async function openGraph() {
  server.use(http.get(endpoints.factory.route, () => HttpResponse.json(factoryMixed)));
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

const transformOf = (svg: HTMLElement) => svg.querySelector(":scope > g")!.getAttribute("transform")!;
const side = () => document.querySelector("[data-overlay] foreignObject")!.getAttribute("data-side");
const card = (name: RegExp) => screen.findByRole("button", { name });
const viewport = () => screen.getByRole("group", { name: /^Graph viewport/ });
const close = () => fireEvent.keyDown(viewport(), { key: "Escape" });
const fit = () => fireEvent.click(screen.getByRole("button", { name: "Fit to view" }));
// In the fixture's fitted view (1000 x 600 stage), the bottom card (352 wide, centred) lies over the Smelter card and clear of the Miner card.
const COVERED = /^4× Smelter/;
const CLEAR = /^Miner Mk\.2/;

describe("the floating card's one-off view move", () => {
  it("below lg, opening a card the bottom card would cover moves the view; one it would not cover leaves it", async () => {
    stubBreakpoint(false);
    const svg = await openGraph();
    const fitted = transformOf(svg);
    fireEvent.click(await card(CLEAR));
    await screen.findByRole("complementary");
    expect(transformOf(svg)).toBe(fitted);
    close();
    fireEvent.click(await card(COVERED));
    await screen.findByRole("complementary");
    expect(transformOf(svg)).not.toBe(fitted);
  });

  it("a breakpoint flip with the card open does not move the view, but the card re-places", async () => {
    const setLarge = stubBreakpoint(false);
    const svg = await openGraph();
    const fitted = transformOf(svg);
    fireEvent.click(await card(COVERED));
    await screen.findByRole("complementary");
    expect(side()).toBe("bottom");
    const opened = transformOf(svg);
    expect(opened).not.toBe(fitted);
    setLarge(true);
    expect(side()).not.toBe("bottom");
    expect(transformOf(svg)).toBe(opened);
    setLarge(false);
    expect(side()).toBe("bottom");
    expect(transformOf(svg)).toBe(opened);
  });

  it("opened wide, a flip to narrow does not move the view by the narrow rule", async () => {
    const setLarge = stubBreakpoint(true);
    const svg = await openGraph();
    fireEvent.click(await card(COVERED));
    await screen.findByRole("complementary");
    const opened = transformOf(svg);
    setLarge(false);
    expect(side()).toBe("bottom");
    expect(transformOf(svg)).toBe(opened);
  });

  it("a view the user panned after opening is left alone by a flip", async () => {
    const setLarge = stubBreakpoint(false);
    const svg = await openGraph();
    fireEvent.click(await card(COVERED));
    await screen.findByRole("complementary");
    fireEvent.keyDown(viewport(), { key: "ArrowDown" });
    const panned = transformOf(svg);
    setLarge(true);
    setLarge(false);
    expect(transformOf(svg)).toBe(panned);
  });

  it("closing and reopening applies the move for the breakpoint current at that open", async () => {
    const setLarge = stubBreakpoint(false);
    const svg = await openGraph();
    const fitted = transformOf(svg);
    const covered = await card(COVERED);
    fireEvent.click(covered);
    await screen.findByRole("complementary");
    const narrowOpen = transformOf(svg);
    expect(narrowOpen).not.toBe(fitted);
    close();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    // Fitted again and flipped wide while closed: the flip moves nothing, and the wide open does not replay the narrow move.
    fit();
    setLarge(true);
    expect(transformOf(svg)).toBe(fitted);
    fireEvent.click(covered);
    await screen.findByRole("complementary");
    expect(side()).not.toBe("bottom");
    expect(transformOf(svg)).not.toBe(narrowOpen);
    // Reopened narrow, it moves exactly as the first narrow open did.
    close();
    fit();
    setLarge(false);
    expect(transformOf(svg)).toBe(fitted);
    fireEvent.click(covered);
    await screen.findByRole("complementary");
    expect(transformOf(svg)).toBe(narrowOpen);
  });
});
