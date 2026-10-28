import { act, configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { endpoints, type PlannerDesignation, type ProductionGraph } from "@satisfactory-dash/shared";
import { serversRoleOwner } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../../servers/ServerContext";
import { AUTO_KEY, P, T, designated, treeGraphResponse, treeWorld } from "../../test/plannerTree";
import { renderWithClient } from "../../test/render";
import { server } from "../../test/server";
import { PlannerView } from "../PlannerView";
import { clearFoldMemory, FOLDS_KEY, overviewFoldsKey } from "./foldMemory";
import { NESTING_KEY } from "./plannerPrefs";

// Hunt: the keyboard chain, the group panel, machines, picks and the flag-off path around blow-up (ADR-0061 build PR 4).

configure({ asyncUtilTimeout: 3_000 });

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  clearFoldMemory();
  vi.unstubAllGlobals();
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
});

function Address() {
  const location = useLocation();
  return <output aria-label="Address">{`${location.pathname}${location.search}`}</output>;
}

function renderView(world: { graph: ProductionGraph; designations: PlannerDesignation[] } = treeWorld(), nesting = true) {
  if (nesting) window.localStorage.setItem(NESTING_KEY, "on");
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("min-width"), addEventListener: () => {}, removeEventListener: () => {} }));
  server.use(
    http.get(endpoints.productionGraph.route, () => HttpResponse.json(treeGraphResponse(world.graph))),
    http.get(endpoints.plannerDesignations.list.route, () => HttpResponse.json({ designations: world.designations, matches: [] })),
  );
  return renderWithClient(
    <MemoryRouter initialEntries={["/app/planner"]}>
      <Address />
      <ServerContext value={serversRoleOwner.servers[0]}>
        <PlannerView />
      </ServerContext>
    </MemoryRouter>,
  );
}

const canvas = () => screen.findByRole("img", { name: /^Graph of Factories/ });
const blowUpButton = (name: string) => screen.findByRole("button", { name: new RegExp(`^Expand ${name} in place`) });
const frames = (svg: HTMLElement) => [...svg.querySelectorAll("[data-blow-up-frame]")].map((f) => f.getAttribute("data-frame"));
const MAIN = designated(T);
const SMELTERS = designated(P);
const address = () => screen.getByRole("status", { name: "Address" }).textContent;
/** The hidden button of the one group card inside Screws' frame. */
const groupButton = () => waitFor(() => {
  const el = document.querySelector<HTMLButtonElement>("button[data-blown-from]");
  expect(el).not.toBeNull();
  return el!;
});

/** The tree world with ids on Screws' three machines, so its group card can open into them. */
function machineWorld() {
  const w = treeWorld();
  return { ...w, graph: { ...w.graph, nodes: w.graph.nodes.map((n) => (n.key === "n4" ? { ...n, machineIds: ["m1", "m2", "m3"] } : n)) } };
}

async function blowScrews() {
  const svg = await canvas();
  fireEvent.click(await blowUpButton("Screws"));
  await waitFor(() => expect(frames(svg)).toEqual([AUTO_KEY]));
  return svg;
}

describe("blow-up and the group panel", () => {
  it("Escape closes the panel of a group drawn inside a frame first, then the frame", async () => {
    renderView();
    const svg = await blowScrews();
    const group = await groupButton();
    fireEvent.click(group);
    await waitFor(() => expect(group).toHaveAttribute("aria-expanded", "true"));
    expect(frames(svg)).toEqual([AUTO_KEY]);
    fireEvent.keyDown(group, { key: "Escape" });
    await waitFor(() => expect(group).toHaveAttribute("aria-expanded", "false"));
    expect(frames(svg)).toEqual([AUTO_KEY]);
    fireEvent.keyDown(group, { key: "Escape" });
    await waitFor(() => expect(frames(svg)).toEqual([]));
  });

  it("collapsing the frame while its group's panel is open leaves no panel behind", async () => {
    renderView();
    const svg = await blowScrews();
    const group = await groupButton();
    fireEvent.click(group);
    await waitFor(() => expect(group).toHaveAttribute("aria-expanded", "true"));
    fireEvent.click(svg.querySelector(`[data-frame="${AUTO_KEY}"] [data-frame-collapse]`)!);
    await waitFor(() => expect(frames(svg)).toEqual([]));
    expect(document.querySelector("aside[aria-labelledby]")).toBeNull();
    expect(document.querySelector("button[aria-expanded='true'][aria-controls]")).toBeNull();
    // Blown up again, the group's panel stays shut: collapsing closed it rather than hiding it.
    fireEvent.click(svg.querySelector(`[data-node="${AUTO_KEY}"] [data-blow-up]`)!);
    await waitFor(() => expect(frames(svg)).toEqual([AUTO_KEY]));
    expect(document.querySelector("aside[aria-labelledby]")).toBeNull();
    expect(await groupButton()).toHaveAttribute("aria-expanded", "false");
  });

  it("Collapse all closes an open group's panel inside a frame, so Expand all does not bring it back", async () => {
    renderView();
    const svg = await blowScrews();
    const group = await groupButton();
    fireEvent.click(group);
    await waitFor(() => expect(group).toHaveAttribute("aria-expanded", "true"));
    const detail = screen.getByRole("group", { name: "Detail" });
    fireEvent.click(within(detail).getByRole("button", { name: "Collapse all" }));
    await waitFor(() => expect(frames(svg)).toEqual([]));
    fireEvent.click(within(detail).getByRole("button", { name: "Expand all" }));
    await waitFor(() => expect(frames(svg)).toContain(AUTO_KEY));
    expect(document.querySelector("aside[aria-labelledby]")).toBeNull();
    // Expand all blows up more than Screws: its own group's button, by the frame it sits in.
    expect(document.querySelector(`button[data-blown-from="${AUTO_KEY}"]`)).toHaveAttribute("aria-expanded", "false");
  });

  it("Escape on a group inside a frame collapses it back to its card with the keyboard, even when the group has machine ids", async () => {
    renderView(machineWorld());
    const svg = await blowScrews();
    // A group card drawn inside a blow-up is the plain group card: it does not open into machines there.
    expect(screen.queryByRole("button", { name: /into its 3 machines/ })).not.toBeInTheDocument();
    fireEvent.keyDown(await groupButton(), { key: "Escape" });
    await waitFor(() => expect(frames(svg)).toEqual([]));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Open factory: Screws/ })).toHaveFocus());
  });

});

describe("blow-up and the keyboard chain", () => {
  it("Collapse all with the keyboard inside a frame empties the frames and does not throw", async () => {
    renderView();
    const svg = await canvas();
    fireEvent.click(await blowUpButton("Main base"));
    const part = await screen.findByRole("button", { name: /^Open factory: Smelters\./ });
    await waitFor(() => expect(part).toHaveFocus());
    fireEvent.click(within(screen.getByRole("group", { name: "Detail" })).getByRole("button", { name: "Collapse all" }));
    await waitFor(() => expect(frames(svg)).toEqual([]));
    expect(screen.getByRole("button", { name: /^Open factory: Main base/ })).toBeInTheDocument();
    // The toolbar offers Expand all again.
    expect(within(screen.getByRole("group", { name: "Detail" })).getByRole("button", { name: "Expand all" })).toBeEnabled();
  });

  it("Escape on a card that is not a part of a frame does not collapse anything", async () => {
    renderView();
    const svg = await canvas();
    fireEvent.click(await blowUpButton("Main base"));
    await waitFor(() => expect(frames(svg)).toEqual([MAIN]));
    fireEvent.keyDown(await screen.findByRole("button", { name: /^Open factory: Screws/ }), { key: "Escape" });
    expect(frames(svg)).toEqual([MAIN]);
  });

  it("collapsing the outer frame from its hidden button drops the inner frame's parts too, and the remembered inner blow-up returns with it", async () => {
    renderView();
    const svg = await canvas();
    fireEvent.click(await blowUpButton("Main base"));
    fireEvent.click(await blowUpButton("Smelters"));
    await waitFor(() => expect(frames(svg)).toEqual([MAIN, SMELTERS]));
    fireEvent.click(screen.getByRole("button", { name: /^Collapse Main base, blown up/ }));
    await waitFor(() => expect(frames(svg)).toEqual([]));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Open factory: Main base/ })).toHaveFocus());
    fireEvent.click(await blowUpButton("Main base"));
    await waitFor(() => expect(frames(svg)).toEqual([MAIN, SMELTERS]));
  });
});

describe("blow-up and factory picks", () => {
  const shift = (el: HTMLElement) => fireEvent.click(el, { shiftKey: true });

  it("a pick of a card that is then blown up leaves the merge bar's count alone, and a pick inside a frame is not counted", async () => {
    renderView();
    const svg = await canvas();
    const bar = () => screen.queryByText(/factor(y|ies) selected/);
    shift(await screen.findByRole("button", { name: /^Open factory: Screws/ }));
    await waitFor(() => expect(bar()?.textContent).toBe("1 factory selected"));
    fireEvent.click(await blowUpButton("Screws"));
    await waitFor(() => expect(frames(svg)).toEqual([AUTO_KEY]));
    // The picked card is gone from the picture; the bar must still say what a merge would take.
    expect(bar()?.textContent).toBe("1 factory selected");
    fireEvent.click(svg.querySelector(`[data-frame="${AUTO_KEY}"] [data-frame-collapse]`)!);
    await waitFor(() => expect(frames(svg)).toEqual([]));
    expect(bar()?.textContent).toBe("1 factory selected");
    expect(await screen.findByRole("button", { name: /^Open factory: Screws.*selected/ })).toBeInTheDocument();
  });

  it("Shift-click on a part drawn inside a frame (not a top-level leaf) never selects it", async () => {
    renderView();
    const svg = await canvas();
    fireEvent.click(await blowUpButton("Main base"));
    await waitFor(() => expect(frames(svg)).toEqual([MAIN]));
    shift(await screen.findByRole("button", { name: /^Open factory: Smelters\./ }));
    expect(address()).toBe("/app/planner");
    expect(screen.queryByText(/factor(y|ies) selected/)?.textContent ?? "No").toMatch(/^No factories selected/);
  });
});

describe("with the planner.nesting flag off", () => {
  it("ignores a remembered blow-up: names unchanged, no frames, no blow-up buttons", async () => {
    window.sessionStorage.setItem(FOLDS_KEY, JSON.stringify([[overviewFoldsKey([]), { flipped: [], unfolded: [], machines: [], expanded: [MAIN] }]]));
    renderView(treeWorld(), false);
    const svg = await canvas();
    expect(frames(svg)).toEqual([]);
    expect(svg.querySelector("[data-blow-up], [data-blow-up-frame]")).toBeNull();
    expect(document.querySelector("[data-blown-from]")).toBeNull();
    expect(screen.queryByRole("button", { name: /in place|^Collapse Main base/ })).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Factories in the graph" })).toBeInTheDocument();
    expect(svg).not.toHaveAccessibleName(/Blown up/);
    // Flat: every factory is top level, so the parts of Main base are the cards.
    expect(screen.getByRole("button", { name: /^Open factory: Smelters/ })).toBeInTheDocument();
  });

  it("Escape on a card does nothing to the address or the picture", async () => {
    renderView(treeWorld(), false);
    const svg = await canvas();
    fireEvent.keyDown(await screen.findByRole("button", { name: /^Open factory: Screws/ }), { key: "Escape" });
    expect(svg.querySelector("[data-frame]")).toBeNull();
    expect(address()).toBe("/app/planner");
  });
});

