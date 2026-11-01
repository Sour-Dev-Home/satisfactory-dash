import { act, configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { endpoints, type PlannerDesignation, type ProductionGraph } from "@satisfactory-dash/shared";
import { serversRoleOwner } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { AUTO_KEY, C1, P, T, designated, treeDesignation, treeGraphResponse, treeId, treeWorld, withoutParents } from "../test/plannerTree";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { buildFactoryTree, designatedKeyOf, levelOf, resolvePath } from "./factoryTree";
import { PlannerView } from "./PlannerView";

// The planner.nesting flag is gone (ADR-0061 Decision 7): worlds without parents, an older backend, a stale stored flag.

configure({ asyncUtilTimeout: 3_000 });

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
});

type World = { graph: ProductionGraph; designations: PlannerDesignation[] };

/** Every factory automatic: no designation ids in the graph, an empty list. */
function automaticOnly(): World {
  const { graph } = treeWorld();
  const factories = graph.factories?.map((f) => ({ ...f, designationId: null, parentDesignationId: null }));
  return { graph: { ...graph, factories }, designations: [] };
}

/** Every factory designated, none with a parent. */
function plainDesignated(): World {
  const { graph, designations } = withoutParents(treeWorld());
  return { graph, designations: designations.filter((d) => d.id !== T) };
}

describe("buildFactoryTree without parents", () => {
  it("an old backend gives a flat tree in the graph's order, with no phantom parent for a zero-machine designation", () => {
    const { graph, designations } = withoutParents(treeWorld());
    const tree = buildFactoryTree(graph, designations);
    expect(tree.rootKeys).toEqual(graph.factories!.map((f) => f.key));
    expect(tree.nested).toBe(false);
    expect(tree.nodes.has(designatedKeyOf(T))).toBe(false);
    for (const key of tree.rootKeys) expect(tree.nodes.get(key)).toMatchObject({ kind: "leaf", depth: 1, parentKey: null, childKeys: [] });
  });

  it("the same with the designations list not answered, or answered empty", () => {
    const { graph } = withoutParents(treeWorld());
    const order = graph.factories!.map((f) => f.key);
    expect(buildFactoryTree(graph, undefined).rootKeys).toEqual(order);
    expect(buildFactoryTree(graph, []).rootKeys).toEqual(order);
  });

  it("a list entry for a designation the graph does not have, with no parent and no machines, is not a card", () => {
    const { graph, designations } = automaticOnly();
    const tree = buildFactoryTree(graph, [...designations, treeDesignation(treeId(99), "Ghost", null, 0)]);
    expect(tree.nodes.has(designatedKeyOf(treeId(99)))).toBe(false);
    expect(tree.rootKeys).toHaveLength(graph.factories!.length);
  });

  it("an older list over a newer graph keeps the list's word (no parent), so the tree is flat", () => {
    const { graph, designations } = treeWorld();
    const tree = buildFactoryTree(graph, withoutParents({ graph, designations }).designations);
    expect(tree.nested).toBe(false);
    expect(tree.rootKeys).toHaveLength(graph.factories!.length);
  });

  it("a graph with no factories array at all has an empty flat tree and resolves any path to nothing", () => {
    const { graph } = treeWorld();
    const tree = buildFactoryTree({ ...graph, factories: [] }, []);
    expect(tree.rootKeys).toEqual([]);
    expect(resolvePath(tree, ["factory|nope"])).toEqual([]);
    expect(levelOf(tree, []).entries).toEqual([]);
  });

  it("a nested path is trimmed to nothing on a flat tree, but a flat key stays", () => {
    const { graph, designations } = withoutParents(treeWorld());
    const tree = buildFactoryTree(graph, designations);
    expect(resolvePath(tree, [designated(T)])).toEqual([]);
    expect(resolvePath(tree, [designated(P), designated(C1)])).toEqual([designated(P)]);
    expect(resolvePath(tree, [AUTO_KEY])).toEqual([AUTO_KEY]);
  });
});

function Where() {
  const location = useLocation();
  return <output aria-label="Address">{location.search}</output>;
}

function renderView(world: World, entry = "/app/planner", designationsStatus = 200) {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  server.use(
    http.get(endpoints.productionGraph.route, () => HttpResponse.json(treeGraphResponse(world.graph))),
    http.get(endpoints.plannerDesignations.list.route, () =>
      designationsStatus === 200
        ? HttpResponse.json({ designations: world.designations, matches: [] })
        : HttpResponse.json({ error: { code: "internal", message: "down", requestId: "r" } }, { status: designationsStatus }),
    ),
  );
  return renderWithClient(
    <MemoryRouter initialEntries={[entry]}>
      <Where />
      <ServerContext value={serversRoleOwner.servers[0]}>
        <PlannerView />
      </ServerContext>
    </MemoryRouter>,
  );
}

const headings = async () => {
  const list = await screen.findByRole("list", { name: "Factories" });
  return within(list).getAllByRole("heading").map((h) => h.textContent);
};
const bar = () => screen.getByRole("group", { name: "Selected factories" });

describe("the Planner in worlds without parents", () => {
  it("an older backend: flat cards in the graph's order, no 'Main base', and ?open= naming a missing key is trimmed", async () => {
    renderView(withoutParents(treeWorld()), `/app/planner?open=${encodeURIComponent(designated(T))}`);
    expect(await screen.findByText("That factory is no longer here.")).toBeInTheDocument();
    expect(await headings()).toEqual(["Smelters", "Plates", "Screws", "Rods"]);
    expect(screen.queryByText("Main base")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("status", { name: "Address" }).textContent).toBe(""));
  });

  it.each(["off", "on", "{garbage", ""])("a stored planner.nesting of %j has no effect: the tree is nested", async (value) => {
    localStorage.setItem("planner.nesting", value);
    renderView(treeWorld());
    expect(await headings()).toContain("Main base");
  });

  it("a stored 'off' does not flatten the tree; a stored 'on' does not nest a flat world", async () => {
    localStorage.setItem("planner.nesting", "on");
    renderView(withoutParents(treeWorld()));
    expect(await headings()).toEqual(["Smelters", "Plates", "Screws", "Rods"]);
  });

  it("a failed designations read still shows the graph's own parents (from parentDesignationId), without the empty parent", async () => {
    renderView(treeWorld(), "/app/planner", 500);
    const list = await headings();
    expect(list).toContain("Screws");
    expect(list).not.toContain("Main base");
  });

  it("automatic factories only: the bar stands idle, picks fill it, Move says there is nowhere to go, nothing crashes", async () => {
    renderView(automaticOnly());
    expect(await headings()).toEqual(["Smelters", "Plates", "Screws", "Rods"]);
    await waitFor(() => expect(screen.getByRole("group", { name: "Selected factories" })).toBeInTheDocument());
    expect(within(bar()).getByText("Pick factories to merge, group or move them.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select Smelters" }));
    fireEvent.click(screen.getByRole("button", { name: "Select Plates" }));
    expect(within(bar()).getByRole("button", { name: "Merge into one" })).toBeInTheDocument();
    expect(within(bar()).getByRole("button", { name: "Move to…" })).toHaveAttribute("aria-disabled", "true");
    expect(within(bar()).getByText(/Move: /)).toBeInTheDocument();
    fireEvent.click(within(bar()).getByRole("button", { name: "Clear selection" }));
    expect(within(bar()).getByText("Pick factories to merge, group or move them.")).toBeInTheDocument();
  });

  it("designated plain factories: a pick of one offers Group, and a plain factory still opens into its groups", async () => {
    renderView(plainDesignated());
    expect(await headings()).toEqual(["Smelters", "Plates", "Screws", "Rods"]);
    fireEvent.click(screen.getByRole("button", { name: "Select Smelters" }));
    expect(within(bar()).getByRole("button", { name: "Group into a new factory" })).toHaveAttribute("aria-disabled", "true");
    expect(within(bar()).getByText(/Group: Select at least two factories to group\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select Plates" }));
    expect(within(bar()).getByRole("button", { name: "Group into a new factory" })).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "Open factory: Smelters" }));
    expect(await screen.findByRole("heading", { name: "Groups" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("status", { name: "Address" }).textContent).toBe(`?open=${encodeURIComponent(designated(P))}`));
  });

  it("a designations list that has not answered yet (pending) does not stop the factories rendering or the bar standing", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
    const world = automaticOnly();
    server.use(
      http.get(endpoints.productionGraph.route, () => HttpResponse.json(treeGraphResponse(world.graph))),
      http.get(endpoints.plannerDesignations.list.route, () => new Promise<Response>(() => {})),
    );
    renderWithClient(
      <MemoryRouter>
        <ServerContext value={serversRoleOwner.servers[0]}>
          <PlannerView />
        </ServerContext>
      </MemoryRouter>,
    );
    expect(await headings()).toEqual(["Smelters", "Plates", "Screws", "Rods"]);
  });
});
