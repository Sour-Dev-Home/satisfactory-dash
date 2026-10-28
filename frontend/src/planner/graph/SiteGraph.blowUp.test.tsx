import { act, configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { endpoints, type PlannerDesignation, type ProductionGraph } from "@satisfactory-dash/shared";
import { serversRoleOwner } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../../servers/ServerContext";
import { AUTO_KEY, P, T, designated, treeGraphResponse, treeId, treeWorld, wideTreeWorld } from "../../test/plannerTree";
import { renderWithClient } from "../../test/render";
import { server } from "../../test/server";
import { PlannerView } from "../PlannerView";
import { TOO_LARGE_TO_EXPAND } from "./canvasScene";
import { clearFoldMemory } from "./foldMemory";
import { NESTING_KEY } from "./plannerPrefs";

// ADR-0061 build PR 4, blow up: on the overview's canvas a card expands in place into a frame of its parts, by mouse
// (its Expand pill, the frame's Collapse pill), by keyboard (the hidden buttons, Escape) and from the toolbar; behind the
// `planner.nesting` flag.

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
  // Wide: the overview opens on the canvas.
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

describe("blowing up a card on the overview canvas", () => {
  it("blows up from the keyboard: focus moves into the frame, and Escape collapses it back to the card", async () => {
    renderView();
    const svg = await canvas();
    const expand = await blowUpButton("Main base");
    expect(expand).toHaveAccessibleName("Expand Main base in place into its 1 factory");
    expect(expand).toHaveAttribute("aria-expanded", "false");
    expand.focus();
    fireEvent.click(expand);
    // The part's own button takes the keyboard; its words say where it is.
    const part = await screen.findByRole("button", { name: /^Open factory: Smelters\..*In Main base/ });
    await waitFor(() => expect(part).toHaveFocus());
    expect(frames(svg)).toEqual([MAIN]);
    expect(svg).toHaveAccessibleName(/Blown up in place: Main base\./);
    expect(svg.querySelector("[data-blow-up-frame] title")?.textContent).toBe("Main base, blown up into 1 factory");
    expect(screen.getByRole("button", { name: "Collapse Main base, blown up into 1 factory" })).toHaveAttribute("aria-expanded", "true");
    // A blow-up inside it, then Escape twice: the inner frame, then the outer, each back to its card.
    fireEvent.click(await blowUpButton("Smelters"));
    const own = await screen.findByRole("button", { name: /^Open factory: Smelters \(own machines\)/ });
    await waitFor(() => expect(own).toHaveFocus());
    expect(frames(svg)).toEqual([MAIN, SMELTERS]);
    fireEvent.keyDown(own, { key: "Escape" });
    await waitFor(() => expect(frames(svg)).toEqual([MAIN]));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Open factory: Smelters\./ })).toHaveFocus());
    fireEvent.keyDown(screen.getByRole("button", { name: /^Open factory: Smelters\./ }), { key: "Escape" });
    await waitFor(() => expect(frames(svg)).toEqual([]));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Open factory: Main base/ })).toHaveFocus());
    expect(svg).toHaveAccessibleName(/The Tables view lists the same\.$/);
  });

  it("blows up by mouse (the card's Expand pill) into its groups, and the frame's Collapse pill folds it", async () => {
    renderView();
    const svg = await canvas();
    const screws = await waitFor(() => {
      const el = svg.querySelector(`[data-node="${AUTO_KEY}"] [data-blow-up]`);
      expect(el).not.toBeNull();
      return el!;
    });
    expect(screws.querySelector("title")?.textContent).toBe("Expand Screws in place into its 1 group");
    fireEvent.click(screws);
    await waitFor(() => expect(frames(svg)).toEqual([AUTO_KEY]));
    // The group is a group card inside the frame, and the line from Main base now ends on it.
    expect(svg.querySelector('[data-node="n4"]')?.getAttribute("data-card")).toBe("group");
    expect(svg).toHaveAccessibleName(/^Graph of Factories: 2 cards, 1 connection\./);
    // The click did not open the factory.
    expect(screen.getByRole("status", { name: "Address" }).textContent).toBe("/app/planner");
    fireEvent.click(svg.querySelector(`[data-frame="${AUTO_KEY}"] [data-frame-collapse]`)!);
    await waitFor(() => expect(frames(svg)).toEqual([]));
    expect(svg.querySelector(`[data-node="${AUTO_KEY}"]`)).not.toBeNull();
  });

  it("Expand all and Collapse all in the toolbar", async () => {
    renderView();
    const svg = await canvas();
    const detail = await screen.findByRole("group", { name: "Detail" });
    fireEvent.click(within(detail).getByRole("button", { name: "Expand all" }));
    // Two rounds: the level's cards, then their parts (Smelters inside Main base); Plates and Rods are two frames deep.
    await waitFor(() => expect(frames(svg)).toEqual([MAIN, SMELTERS, AUTO_KEY]));
    fireEvent.click(within(detail).getByRole("button", { name: "Collapse all" }));
    await waitFor(() => expect(frames(svg)).toEqual([]));
  });

  it("opens a factory drawn inside a blow-up at its place in the tree (the path grows by the chain)", async () => {
    renderView();
    fireEvent.click(await blowUpButton("Main base"));
    fireEvent.click(await screen.findByRole("button", { name: /^Open factory: Smelters\./ }));
    await waitFor(() => expect(screen.getByRole("status", { name: "Address" }).textContent).toBe(`/app/planner?open=${encodeURIComponent(MAIN)}&open=${encodeURIComponent(SMELTERS)}`));
  });

  it("remembers a level's blow-ups for the session", async () => {
    const first = renderView();
    fireEvent.click(await blowUpButton("Main base"));
    await waitFor(async () => expect(frames(await canvas())).toEqual([MAIN]));
    first.unmount();
    renderView();
    await waitFor(async () => expect(frames(await canvas())).toEqual([MAIN]));
  });

  // One area of two factories of 35 groups: with one blown up (36 cards), the other (70) would pass the cap of 60.
  const AREA = designated(treeId(100));
  const LINE_1 = designated(treeId(102));
  const pastTheCap = async () => {
    renderView(wideTreeWorld(1, 2, 35));
    fireEvent.click(await blowUpButton("Area 0"));
    fireEvent.click(await blowUpButton("Area 0 line 0"));
    return screen.findByRole("button", { name: new RegExp(`^Expand Area 0 line 1 in place: ${TOO_LARGE_TO_EXPAND}`) });
  };
  const openedLine1 = `/app/planner?open=${encodeURIComponent(AREA)}&open=${encodeURIComponent(LINE_1)}`;

  it("past the cap, the hidden button says to open the factory instead, and opening it does that", async () => {
    const other = await pastTheCap();
    // It opens rather than expands, so it is neither disabled nor collapsed.
    expect(other).not.toHaveAttribute("aria-disabled");
    expect(other).not.toHaveAttribute("aria-expanded");
    const svg = await canvas();
    expect(svg.querySelector('[data-blow-up="disabled"] title')?.textContent).toMatch(TOO_LARGE_TO_EXPAND);
    fireEvent.click(other);
    await waitFor(() => expect(screen.getByRole("status", { name: "Address" }).textContent).toBe(openedLine1));
  });

  it("past the cap, the disabled pill opens the factory (its tooltip's words), at its place in the tree", async () => {
    await pastTheCap();
    const svg = await canvas();
    const pill = await waitFor(() => {
      const el = svg.querySelector(`[data-node="${LINE_1}"] [data-blow-up="disabled"]`);
      expect(el).not.toBeNull();
      return el!;
    });
    const before = frames(svg);
    fireEvent.click(pill);
    await waitFor(() => expect(screen.getByRole("status", { name: "Address" }).textContent).toBe(openedLine1));
    expect(before).not.toContain(LINE_1);
  });

  it("toolbar Expand all is disabled with its reason when nothing here fits under the cap", async () => {
    // An area holding one factory of 70 groups. At the top the area fits (one part), so Expand all needs no reason.
    renderView(wideTreeWorld(1, 1, 70));
    await canvas();
    const top = await within(await screen.findByRole("group", { name: "Detail" })).findByRole("button", { name: "Expand all" });
    expect(top).toBeEnabled();
    expect(top).not.toHaveAttribute("title");
    expect(top).not.toHaveAccessibleDescription();
    // Inside the area the only card is the factory of 70, past the cap: disabled, and it says why.
    fireEvent.click(await screen.findByRole("button", { name: /^Open factory: Area 0\b/ }));
    await waitFor(() => expect(screen.getByRole("status", { name: "Address" }).textContent).toContain("open="));
    const inside = await waitFor(() => {
      const b = within(screen.getByRole("group", { name: "Detail" })).getByRole("button", { name: "Expand all" });
      expect(b).toBeDisabled();
      return b;
    });
    expect(inside).toHaveAccessibleDescription(/^Nothing here fits under the cap/);
    expect(inside.getAttribute("title")).toMatch(/^Nothing here fits under the cap/);
    // Never beside the bubbles' own Expand all / Collapse all in the same group.
    expect(within(screen.getByRole("group", { name: "Detail" })).getAllByRole("button", { name: /^(Expand|Collapse) all$/ })).toHaveLength(1);
  });

  it("blowing up by mouse keeps the keyboard: focus on the card's hidden button moves into the frame", async () => {
    renderView();
    const svg = await canvas();
    const own = await screen.findByRole("button", { name: /^Open factory: Main base/ });
    own.focus();
    const pill = await waitFor(() => {
      const el = svg.querySelector(`[data-node="${MAIN}"] [data-blow-up]`);
      expect(el).not.toBeNull();
      return el!;
    });
    fireEvent.click(pill);
    await waitFor(() => expect(frames(svg)).toEqual([MAIN]));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Open factory: Smelters\..*In Main base/ })).toHaveFocus());
  });

  it("blowing up by mouse with the keyboard elsewhere leaves focus alone", async () => {
    renderView();
    const svg = await canvas();
    const item = screen.getByRole("combobox", { name: "Item" });
    item.focus();
    fireEvent.click(await waitFor(() => svg.querySelector(`[data-node="${MAIN}"] [data-blow-up]`)!));
    await waitFor(() => expect(frames(svg)).toEqual([MAIN]));
    expect(item).toHaveFocus();
  });

  it("with the flag off, nothing blows up", async () => {
    renderView(treeWorld(), false);
    const svg = await canvas();
    expect(svg.querySelector("[data-blow-up]")).toBeNull();
    expect(screen.queryByRole("button", { name: /in place/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Expand all" })).not.toBeInTheDocument();
  });
});
