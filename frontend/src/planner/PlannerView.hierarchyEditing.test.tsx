import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { endpoints, ProductionGraphResponseSchema, type PlannerDesignationMember, type ReplacePlannerDesignationsRequest } from "@satisfactory-dash/shared";
import { plannerDesignationStaleError, productionGraphFactories, serversRoleOwner } from "@satisfactory-dash/shared/fixtures";
import { applyReplace, type StoredDesignation } from "../demo/designationStore";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { UNDO_DONE } from "./designationChanges";
import { CYCLE_TEXT, DEPTH_TEXT, SHAPE_TEXT, STALE_TEXT } from "./designationText";
import { NESTING_KEY } from "./graph/plannerPrefs";
import { PlannerView } from "./PlannerView";

// ADR-0061 build PR 5 (Decision 6): Group (automatic factories designated on the way), Ungroup and Move through the
// replace write, their undo, each 409's words, and nothing of it with the nesting flag off. The replace is answered by the
// demo's in-memory store, which follows the backend's replace rules.

const ROD = "factory|Desc_IronRod_C|1250|100";
const ROD_ID = "6f1c2a9e-3b7d-4e58-9a41-0c5d8e2f7b10";
const BASE_ID = "6f1c2a9e-3b7d-4e58-9a41-0c5d8e2f7b11";
const ANNEX_ID = "6f1c2a9e-3b7d-4e58-9a41-0c5d8e2f7b12";
const CREATED = "2026-10-24T10:00:00.000Z";
const BASE = ProductionGraphResponseSchema.parse(productionGraphFactories);

/** One id per machine, and a building at a whole-metre place for each (the Factory read). */
const nodes = BASE.data.nodes.map((n) => ({ ...n, machineIds: Array.from({ length: n.count }, (_, i) => `${n.className}|${n.key}|${i}`) }));
const buildings = nodes.flatMap((n) =>
  n.machineIds.map((id, i) => ({
    id,
    name: n.name,
    className: n.className,
    recipe: n.recipe,
    isProducing: true,
    isPaused: false,
    isBackedUp: false,
    production: [],
    location: { xM: n.at.x + i * 4, yM: n.at.y, zM: 0, rotationDeg: 0 },
  })),
);
const memberOf = (id: string): PlannerDesignationMember => {
  const b = buildings.find((x) => x.id === id)!;
  return { id, c: b.className, x: b.location.xM, y: b.location.yM };
};
const rodKeys = BASE.data.factories!.find((f) => f.key === ROD)!.nodeKeys;
const rodWorks = rodKeys.flatMap((k) => nodes.find((n) => n.key === k)!.machineIds).map(memberOf);
const plateKeys = BASE.data.factories!.find((f) => f.key !== ROD)!.nodeKeys;
const plateMembers = plateKeys.flatMap((k) => nodes.find((n) => n.key === k)!.machineIds).map(memberOf);

const stored = (id: string, name: string, members: PlannerDesignationMember[], parentId: string | null, revision = 2): StoredDesignation => ({
  id,
  name,
  mode: "core",
  members,
  createdAt: CREATED,
  updatedAt: CREATED,
  revision,
  parentId,
});
const rod = (parentId: string | null = null) => stored(ROD_ID, "Rod works", rodWorks, parentId);

let list: StoredDesignation[];
let sent: ReplacePlannerDesignationsRequest[];

/** Serves the graph (Rod works designated, Iron Plate factory automatic), the Factory read and a live designation list. */
function serve(start: StoredDesignation[], replace?: (n: number) => Response | undefined) {
  list = start;
  const factories = BASE.data.factories!.map((f) => (f.key === ROD ? { ...f, name: "Rod works", designationId: ROD_ID, sideProducts: [] } : f));
  let ids = 0;
  server.use(
    http.get(endpoints.productionGraph.route, () => HttpResponse.json({ ...BASE, data: { ...BASE.data, nodes, factories } })),
    http.get(endpoints.factory.route, () => HttpResponse.json({ serverId: "default", observedAt: BASE.observedAt, stale: false, data: { buildings, backedUpCount: 0 } })),
    http.get(endpoints.plannerDesignations.list.route, () =>
      HttpResponse.json({
        designations: list,
        matches: list.map((d) => ({ designationId: d.id, matched: d.members.length, missing: 0, memberBuildingIds: d.members.map((m) => m.id) })),
      }),
    ),
    http.post(endpoints.plannerDesignations.replace.route, async ({ request }) => {
      const body = (await request.json()) as ReplacePlannerDesignationsRequest;
      sent.push(body);
      const custom = replace?.(sent.length);
      if (custom !== undefined) return custom;
      const done = applyReplace(list, body, Date.parse("2026-10-28T12:00:00.000Z"), () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`);
      if (!done.ok) return HttpResponse.json({ error: { code: done.code, message: done.message, requestId: "r" } }, { status: done.status });
      list = done.next;
      return HttpResponse.json(done.response);
    }),
  );
}

const conflict = (code: string) => () => HttpResponse.json({ error: { code, message: "refused", requestId: "r" } }, { status: 409 });

let view: ReturnType<typeof renderWithClient>;
function renderView() {
  return (view = renderWithClient(
    <MemoryRouter>
      <ServerContext value={serversRoleOwner.servers[0]}>
        <PlannerView />
      </ServerContext>
    </MemoryRouter>,
  ));
}
const settled = async (heading: string) => {
  await screen.findByRole("heading", { name: heading });
  await waitFor(() => expect(view.client.isFetching()).toBe(0));
};
const bar = () => screen.getByRole("group", { name: "Selected factories" });
const tick = (name: string) => fireEvent.click(screen.getByRole("checkbox", { name }));

/** Picks both top-level factories and opens the Group form, named. */
async function groupBoth(name = "Iron area") {
  await settled("Rod works");
  tick("Select Rod works");
  tick("Select Iron Plate factory");
  fireEvent.click(within(bar()).getByRole("button", { name: "Group into a new factory" }));
  const field = screen.getByRole("textbox", { name: "Name" });
  expect(field).toHaveFocus();
  fireEvent.change(field, { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: "Group" }));
}

beforeEach(() => {
  sent = [];
  window.localStorage.setItem(NESTING_KEY, "on");
});
afterEach(() => {
  window.localStorage.removeItem(NESTING_KEY);
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
});

describe("Group", () => {
  it("groups a designated and an automatic factory in one replace, then Undo puts them back", async () => {
    serve([rod()]);
    renderView();
    await groupBoth();
    await waitFor(() => expect(sent).toHaveLength(1));
    const body = sent[0]!;
    expect(body.intent).toBe("group");
    expect(body.expect).toEqual([{ id: ROD_ID, revision: 2 }]);
    const parent = body.put[0]!;
    expect(parent).toMatchObject({ name: "Iron area", members: [] });
    expect(parent.parentId).toBeUndefined();
    expect(body.put).toContainEqual({ id: ROD_ID, name: "Rod works", members: rodWorks, parentId: parent.id });
    // The automatic factory is designated on the way, inside the new parent.
    expect(body.put).toContainEqual({ name: "Iron Plate factory", members: plateMembers, parentId: parent.id });

    const undo = await screen.findByRole("button", { name: "Undo" });
    await waitFor(() => expect(undo).toHaveFocus());
    expect(screen.getByText("Grouped 2 factories into Iron area.", { selector: "#planner-undo-message" })).toBeInTheDocument();
    // The new parent is on the top level now, as a card of its own.
    expect(await screen.findByRole("heading", { name: "Iron area" })).toBeInTheDocument();

    fireEvent.click(undo);
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]!.intent).toBe("undo");
    expect(sent[1]!.expect.map((e) => e.id)).toEqual(expect.arrayContaining([parent.id, ROD_ID]));
    expect(sent[1]!.expect).toHaveLength(3);
    expect(sent[1]!.put).toEqual([expect.objectContaining({ id: ROD_ID, parentId: null, createdAt: CREATED })]);
    expect(await screen.findByText(UNDO_DONE, { selector: "#planner-undo-message" })).toBeInTheDocument();
    expect(list).toEqual([expect.objectContaining({ id: ROD_ID, parentId: null })]);
  });

  it.each([
    ["designation_depth", DEPTH_TEXT],
    ["designation_cycle", CYCLE_TEXT],
    ["designation_shape", SHAPE_TEXT],
  ])("says %s in the planner's words, in the form where it was asked", async (code, words) => {
    serve([rod()], conflict(code));
    renderView();
    await groupBoth();
    const form = screen.getByRole("form", { name: "Name the new factory" });
    expect(await within(form).findByRole("alert")).toHaveTextContent(words);
  });

  it("names the factory that already holds the machines on an overlap", async () => {
    serve([rod()], () => HttpResponse.json({ error: { code: "designation_overlap", message: "x", requestId: "r", other: { id: ANNEX_ID, name: "Annex" } } }, { status: 409 }));
    renderView();
    await groupBoth();
    const form = screen.getByRole("form", { name: "Name the new factory" });
    expect(await within(form).findByRole("alert")).toHaveTextContent("Some of these machines already belong to Annex");
  });

  it("on a stale answer re-reads, drops the selection and says so", async () => {
    serve([rod()], () => HttpResponse.json(plannerDesignationStaleError, { status: 409 }));
    renderView();
    await groupBoth();
    expect(await screen.findByText(STALE_TEXT)).toBeInTheDocument();
    await waitFor(() => expect(within(bar()).getByRole("status")).toHaveTextContent("No factories selected"));
  });

  it("an undo that finds the factories changed meanwhile says so and never overwrites", async () => {
    serve([rod()], (n) => (n === 2 ? HttpResponse.json(plannerDesignationStaleError, { status: 409 }) : undefined));
    renderView();
    await groupBoth();
    const undo = await screen.findByRole("button", { name: "Undo" });
    fireEvent.click(undo);
    expect(await screen.findByText(STALE_TEXT, { selector: "#planner-undo-message" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });
});

describe("Ungroup", () => {
  it("moves a parent's factories up and removes the parent; Undo restores it with its parent said", async () => {
    serve([stored(BASE_ID, "Main base", [], null, 1), rod(BASE_ID)]);
    renderView();
    await settled("Main base");
    fireEvent.click(screen.getByRole("button", { name: "Ungroup Main base" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({
      expect: expect.arrayContaining([
        { id: ROD_ID, revision: 2 },
        { id: BASE_ID, revision: 1 },
      ]),
      put: [{ id: ROD_ID, name: "Rod works", members: rodWorks, parentId: null }],
      intent: "ungroup",
    });
    const undo = await screen.findByRole("button", { name: "Undo" });
    expect(screen.getByText("Ungrouped Main base: its factories are now at the top level.", { selector: "#planner-undo-message" })).toBeInTheDocument();
    fireEvent.click(undo);
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]!.put).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: BASE_ID, members: [], parentId: null }),
        expect.objectContaining({ id: ROD_ID, parentId: BASE_ID }),
      ]),
    );
    await screen.findByText(UNDO_DONE, { selector: "#planner-undo-message" });
    expect(list.find((d) => d.id === ROD_ID)?.parentId).toBe(BASE_ID);
  });
});

describe("Move", () => {
  it("moves a picked factory into another, by a choice in place, with an undo", async () => {
    serve([rod(), stored(ANNEX_ID, "Annex", [{ id: "far-1", c: "Build_SmelterMk1_C", x: 9000, y: 9000 }], null, 1)]);
    renderView();
    await settled("Rod works");
    tick("Select Rod works");
    fireEvent.click(within(bar()).getByRole("button", { name: "Move to…" }));
    const choice = screen.getByRole("combobox", { name: "Move to" });
    expect(choice).toHaveFocus();
    // Rod works is at the top level already, and cannot go inside itself: Annex is the one place.
    expect(within(choice).getAllByRole("option").map((o) => o.textContent)).toEqual(["Annex"]);
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({
      expect: [{ id: ROD_ID, revision: 2 }],
      put: [{ id: ROD_ID, name: "Rod works", members: rodWorks, parentId: ANNEX_ID }],
      intent: "move",
    });
    expect(await screen.findByText("Moved 1 factory to Annex.", { selector: "#planner-undo-message" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]!.put).toEqual([expect.objectContaining({ id: ROD_ID, parentId: null })]);
  });

  it("Escape closes the choice and hands the focus back to Move to", async () => {
    serve([rod(), stored(ANNEX_ID, "Annex", [{ id: "far-1", c: "Build_SmelterMk1_C", x: 9000, y: 9000 }], null, 1)]);
    renderView();
    await settled("Rod works");
    tick("Select Rod works");
    fireEvent.click(within(bar()).getByRole("button", { name: "Move to…" }));
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Move to" }), { key: "Escape" });
    await waitFor(() => expect(within(bar()).getByRole("button", { name: "Move to…" })).toHaveFocus());
    expect(sent).toHaveLength(0);
  });

  it("stays disabled with its reason when there is nowhere to go", async () => {
    serve([rod()]);
    renderView();
    await settled("Rod works");
    tick("Select Rod works");
    const move = within(bar()).getByRole("button", { name: "Move to…" });
    expect(move).toHaveAttribute("aria-disabled", "true");
    expect(move).toHaveAccessibleDescription("Move: There is nowhere else these factories can go.");
    fireEvent.click(move);
    expect(screen.queryByRole("combobox", { name: "Move to" })).not.toBeInTheDocument();
  });
});

describe("with the nesting flag off", () => {
  it("offers no Group, Move or Ungroup, and the bar reads as before", async () => {
    window.localStorage.removeItem(NESTING_KEY);
    serve([stored(BASE_ID, "Main base", [], null, 1), rod(BASE_ID)]);
    renderView();
    await settled("Rod works");
    expect(screen.queryByRole("heading", { name: "Main base" })).not.toBeInTheDocument();
    expect(within(bar()).queryByRole("button", { name: "Group into a new factory" })).not.toBeInTheDocument();
    expect(within(bar()).queryByRole("button", { name: "Move to…" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Ungroup/ })).not.toBeInTheDocument();
    expect(within(bar()).getByRole("button", { name: "Merge into one" })).toHaveAccessibleDescription("Select at least two factories to merge.");
  });
});
