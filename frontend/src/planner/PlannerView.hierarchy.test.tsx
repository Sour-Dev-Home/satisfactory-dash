import { act, configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endpoints } from "@satisfactory-dash/shared";
import { serversRoleOwner } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { AUTO_KEY, C1, P, T, designated, treeGraphResponse, treeWorld } from "../test/plannerTree";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { NESTING_KEY } from "./graph/plannerPrefs";
import { PlannerView } from "./PlannerView";

// ADR-0061 build PR 3: the tree's levels in the address (`?open=a&open=b`), Back pops one, the breadcrumb, a bad tail.

// Each level waits on two reads (the graph and the designations); a loaded machine can take past the 1 s default.
configure({ asyncUtilTimeout: 3_000 });

beforeEach(() => window.localStorage.setItem(NESTING_KEY, "on"));

afterEach(() => {
  window.localStorage.removeItem(NESTING_KEY);
  vi.unstubAllGlobals();
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
});

function Browser() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <button type="button" onClick={() => void navigate(-1)}>
        Browser back
      </button>
      <output aria-label="Address">{`${location.pathname}${location.search}`}</output>
    </>
  );
}

const q = (...keys: string[]) => (keys.length === 0 ? "" : `?${keys.map((k) => `open=${encodeURIComponent(k)}`).join("&")}`);

function renderView(entry = "/app/planner") {
  // Narrow: the Tables view, so the cards are plain buttons.
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  const { graph, designations } = treeWorld();
  server.use(
    http.get(endpoints.productionGraph.route, () => HttpResponse.json(treeGraphResponse(graph))),
    http.get(endpoints.plannerDesignations.list.route, () => HttpResponse.json({ designations, matches: [] })),
  );
  return renderWithClient(
    <MemoryRouter initialEntries={["/app", entry]} initialIndex={1}>
      <Browser />
      <ServerContext value={serversRoleOwner.servers[0]}>
        <PlannerView />
      </ServerContext>
    </MemoryRouter>,
  );
}

const GONE = "That factory is no longer here.";
const address = () => screen.getByRole("status", { name: "Address" }).textContent;
const top = designated(T);
const smelters = designated(P);
const crumbs = () => screen.getByRole("navigation", { name: "Factory path" });
const backButton = (name: string) => screen.getAllByRole("button", { name }).find((b) => b.closest("nav") === null)!;

describe("the factory tree in the Planner", () => {
  it("a #776 link with one open still opens that factory", async () => {
    renderView(`/app/planner${q(AUTO_KEY)}`);
    expect(await screen.findByRole("heading", { name: "Screws" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Groups" })).toBeInTheDocument();
    expect(address()).toBe(`/app/planner${q(AUTO_KEY)}`);
  });

  it("the top level shows a parent as one rolled-up card", async () => {
    renderView();
    const list = await screen.findByRole("list", { name: "Factories" });
    const cards = [...list.children] as HTMLElement[];
    expect(cards.map((c) => within(c).getByRole("heading").textContent)).toEqual(["Main base", "Screws"]);
    expect(within(cards[0]!).getByText(/^5 machines/)).toBeInTheDocument();
    expect(within(cards[0]!).getByText(/^Desc_IronIngot_C: at least 20/)).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Factory path" })).not.toBeInTheDocument();
  });

  it("drilling down adds a level to the address and focuses the level's heading; Back pops one", async () => {
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Open factory: Main base" }));
    expect(await screen.findByRole("heading", { name: "Main base" })).toHaveFocus();
    expect(address()).toBe(`/app/planner${q(top)}`);
    expect(within(crumbs()).getByText("Main base")).toHaveAttribute("aria-current", "page");

    fireEvent.click(screen.getByRole("button", { name: "Open factory: Smelters" }));
    expect(await screen.findByRole("heading", { name: "Smelters" })).toHaveFocus();
    expect(address()).toBe(`/app/planner${q(top, smelters)}`);
    const parts = within(screen.getByRole("list", { name: "Factories in Smelters" })).getAllByRole("heading");
    expect(parts.map((h) => h.textContent)).toEqual(["Smelters (own machines)", "Plates", "Rods"]);

    fireEvent.click(screen.getByRole("button", { name: "Back to Main base" }));
    expect(await screen.findByRole("heading", { name: "Main base" })).toHaveFocus();
    expect(address()).toBe(`/app/planner${q(top)}`);
    // Back stepped back through history: the entry the drill made is gone, so the browser's Back leaves the levels.
    // The back arrow (the breadcrumb's first button has the same words and goes to the same place).
    fireEvent.click(backButton("All factories"));
    expect(await screen.findByRole("heading", { name: "Production planner" })).toHaveFocus();
    expect(address()).toBe("/app/planner");
    fireEvent.click(screen.getByRole("button", { name: "Browser back" }));
    expect(address()).toBe("/app");
  });

  it("the own-machines card opens the parent's groups, named as such", async () => {
    renderView(`/app/planner${q(top, smelters)}`);
    fireEvent.click(await screen.findByRole("button", { name: "Open factory: Smelters (own machines)" }));
    expect(await screen.findByRole("heading", { name: "Smelters (own machines)" })).toHaveFocus();
    expect(screen.getByRole("heading", { name: "Groups" })).toBeInTheDocument();
    expect(within(crumbs()).getByText("Smelters (own machines)")).toHaveAttribute("aria-current", "page");
  });

  it("a breadcrumb jumps to its level, and Back from a link (no entry made here) replaces the address", async () => {
    renderView(`/app/planner${q(top, smelters, designated(C1))}`);
    expect(await screen.findByRole("heading", { name: "Plates" })).toBeInTheDocument();
    const nav = crumbs();
    expect(within(nav).getAllByRole("listitem").map((li) => li.textContent?.replace("/", "").trim())).toEqual([
      "All factories",
      "Main base",
      "Smelters",
      "Plates",
    ]);
    fireEvent.click(within(nav).getByRole("button", { name: "Main base" }));
    expect(await screen.findByRole("heading", { name: "Main base" })).toHaveFocus();
    expect(address()).toBe(`/app/planner${q(top)}`);
    fireEvent.click(within(crumbs()).getByRole("button", { name: "All factories" }));
    expect(await screen.findByRole("list", { name: "Factories" })).toBeInTheDocument();
    expect(address()).toBe("/app/planner");
  });

  it("Back from a deep link replaces the address with one level up", async () => {
    renderView(`/app/planner${q(top, smelters, designated(C1))}`);
    fireEvent.click(await screen.findByRole("button", { name: "Back to Smelters" }));
    expect(await screen.findByRole("heading", { name: "Smelters" })).toHaveFocus();
    expect(address()).toBe(`/app/planner${q(top, smelters)}`);
    fireEvent.click(screen.getByRole("button", { name: "Browser back" }));
    expect(address()).toBe("/app");
  });

  it("a bad tail is trimmed off the address, with a note", async () => {
    renderView(`/app/planner${q(top, "gone", smelters)}`);
    expect(await screen.findByText(GONE, undefined, { timeout: 3_000 })).toHaveAttribute("role", "status");
    expect(screen.getByRole("heading", { name: "Main base" })).toBeInTheDocument();
    await waitFor(() => expect(address()).toBe(`/app/planner${q(top)}`));
    // Still said once the address is trimmed (that entry is marked).
    expect(screen.getByText(GONE)).toBeInTheDocument();
    // The note goes once the viewer goes somewhere.
    fireEvent.click(screen.getByRole("button", { name: "Open factory: Smelters" }));
    expect(await screen.findByRole("heading", { name: "Smelters" })).toBeInTheDocument();
    expect(screen.queryByText(GONE)).not.toBeInTheDocument();
  });

  it("with the flag off, the factories stay flat and a nested path is trimmed", async () => {
    window.localStorage.removeItem(NESTING_KEY);
    renderView(`/app/planner${q(top)}`);
    expect(await screen.findByText(GONE, undefined, { timeout: 3_000 })).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Factories" });
    expect(within(list).getAllByRole("heading").map((h) => h.textContent)).toEqual(["Smelters", "Plates", "Screws", "Rods"]);
    await waitFor(() => expect(address()).toBe("/app/planner"));
  });
});
