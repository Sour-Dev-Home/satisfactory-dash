import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endpoints, ProductionGraphResponseSchema, type PlannerDesignationMember } from "@satisfactory-dash/shared";
import { plannerDesignationStaleError, productionGraphFactories, serversRoleOwner, serversRoleViewer } from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { SPLIT_BACK_DONE, UNDO_DONE } from "./designationChanges";
import { NEEDS_NEWER_BACKEND } from "./designationOps";
import { NOT_CONNECTED_TEXT, STALE_TEXT } from "./designationText";
import { PlannerView } from "./PlannerView";

// ADR-0055 Decisions 11 and 12 (#727): merge, split, pop-out, dissolve and their undo, through the replace write.

afterEach(() => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0))));

const ROD = "factory|Desc_IronRod_C|1250|100";
const DESIGNATION = "6f1c2a9e-3b7d-4e58-9a41-0c5d8e2f7b10";
const CREATED = "2026-10-24T10:00:00.000Z";
const BASE = ProductionGraphResponseSchema.parse(productionGraphFactories);

/** One id per machine, and a building at a whole-metre place for each. */
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
const machinesOf = (key: string) => nodes.find((n) => n.key === key)!.machineIds;
const rodIds = machinesOf("Build_ConstructorMk1_C|Iron Rod|1250|100");
const sinkIds = machinesOf("Build_ResourceSink_C||1300|100");
const rodWorks = [...rodIds, ...sinkIds].map(memberOf);
const plateKeys = BASE.data.factories!.find((f) => f.key !== ROD)!.nodeKeys;
const plateMembers = plateKeys.flatMap((k) => machinesOf(k)).map(memberOf);

interface Sent {
  body: { expect: { id: string; revision: number }[]; put: { id?: string; name: string; members: PlannerDesignationMember[]; createdAt?: string }[]; intent?: string };
}
let sent: Sent[];
let listReads: number;

function serve(opts: { revision?: boolean; connected?: boolean; replace?: (n: number) => Response | undefined } = {}) {
  const revised = opts.revision ?? true;
  const factories = BASE.data.factories!.map((f) => (f.key === ROD ? { ...f, name: "Rod works", designationId: DESIGNATION, sideProducts: [] } : f));
  const apart = opts.connected === false;
  const data = {
    ...BASE.data,
    nodes: apart ? nodes.map((n) => ({ ...n, shares: undefined })) : nodes,
    edges: apart ? [] : BASE.data.edges,
    transports: apart ? [] : BASE.data.transports,
    factories,
  };
  const designation = { id: DESIGNATION, name: "Rod works", mode: "core", members: rodWorks, createdAt: CREATED, updatedAt: CREATED, ...(revised ? { revision: 2 } : {}) };
  const list = {
    designations: [designation],
    matches: [
      { designationId: DESIGNATION, matched: rodWorks.length, missing: 0, ...(revised ? { memberBuildingIds: rodWorks.map((m) => m.id) } : {}) },
    ],
  };
  server.use(
    http.get(endpoints.productionGraph.route, () => HttpResponse.json({ ...BASE, data })),
    http.get(endpoints.factory.route, () => HttpResponse.json({ serverId: "default", observedAt: BASE.observedAt, stale: false, data: { buildings, backedUpCount: 0 } })),
    http.get(endpoints.plannerDesignations.list.route, () => {
      listReads += 1;
      return HttpResponse.json(list);
    }),
    http.post(endpoints.plannerDesignations.replace.route, async ({ request }) => {
      const body = (await request.json()) as Sent["body"];
      sent.push({ body });
      const custom = opts.replace?.(sent.length);
      if (custom !== undefined) return custom;
      const removed = body.expect.map((e) => e.id).filter((id) => !body.put.some((p) => p.id === id));
      return HttpResponse.json({
        designations: body.put.map((p, i) => ({
          id: p.id ?? `00000000-0000-4000-8000-00000000000${i}`,
          name: p.name,
          mode: "core",
          members: p.members,
          createdAt: p.createdAt ?? CREATED,
          updatedAt: "2026-10-27T12:00:00.000Z",
          revision: 3 + sent.length,
        })),
        removedIds: removed,
      });
    }),
  );
}

let view: ReturnType<typeof renderWithClient>;
function renderView(servers = serversRoleOwner) {
  return (view = renderWithClient(
    <MemoryRouter>
      <ServerContext value={servers.servers[0]}>
        <PlannerView />
      </ServerContext>
    </MemoryRouter>,
  ));
}
const settled = async () => {
  await screen.findByRole("heading", { name: "Rod works" });
  await waitFor(() => expect(view.client.isFetching()).toBe(0));
};
const tick = (name: string) => fireEvent.click(screen.getByRole("checkbox", { name }));
const openRodWorks = async () => {
  await settled();
  fireEvent.click(within(screen.getByRole("heading", { name: "Rod works" }).closest("li")!).getByRole("button", { name: /^Open factory/ }));
  return screen.findByRole("heading", { name: "Groups" });
};

beforeEach(() => {
  sent = [];
  listReads = 0;
});

describe("merging factories", () => {
  it("merges a designated and a suggested factory, keeping the designation's id, then Split back restores it", async () => {
    serve();
    renderView();
    await settled();
    tick("Select Rod works");
    tick("Select Iron Plate factory");
    const bar = screen.getByRole("group", { name: "Selected factories" });
    expect(within(bar).getByRole("status")).toHaveTextContent("2 factories selected");
    fireEvent.click(within(bar).getByRole("button", { name: "Merge into one" }));
    // The name form proposes the largest factory's name and takes the focus.
    const field = screen.getByRole("textbox", { name: "Name" });
    expect(field).toHaveValue("Iron Plate factory");
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: "Iron works" } });
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.body).toEqual({
      expect: [{ id: DESIGNATION, revision: 2 }],
      put: [{ id: DESIGNATION, name: "Iron works", members: [...rodWorks, ...plateMembers] }],
      intent: "merge",
    });
    // The undo offer takes the focus, and the selection is gone.
    const splitBack = await screen.findByRole("button", { name: "Split back" });
    await waitFor(() => expect(splitBack).toHaveFocus());
    expect(screen.getByText("Merged 2 factories into Iron works.", { selector: "#planner-undo-message" })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Selected factories" })).getByRole("status")).toHaveTextContent("No factories selected");

    fireEvent.click(splitBack);
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]!.body).toEqual({
      expect: [{ id: DESIGNATION, revision: 4 }],
      put: [{ id: DESIGNATION, name: "Rod works", members: rodWorks, createdAt: CREATED }],
      intent: "undo",
    });
    expect(await screen.findByText(SPLIT_BACK_DONE, { selector: "#planner-undo-message" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Split back" })).not.toBeInTheDocument();
  });

  it("keeps Merge disabled, with the reason, for factories nothing connects, and for one factory", async () => {
    serve({ connected: false });
    renderView();
    await settled();
    tick("Select Rod works");
    const merge = screen.getByRole("button", { name: "Merge into one" });
    expect(merge).toHaveAttribute("aria-disabled", "true");
    expect(merge).toHaveAccessibleDescription("Select at least two factories to merge.");
    tick("Select Iron Plate factory");
    expect(merge).toHaveAccessibleDescription(NOT_CONNECTED_TEXT);
    fireEvent.click(merge);
    expect(screen.queryByRole("textbox", { name: "Name" })).not.toBeInTheDocument();
    expect(sent).toHaveLength(0);
  });

  it("says when the backend is too old to merge", async () => {
    serve({ revision: false });
    renderView();
    await settled();
    tick("Select Rod works");
    tick("Select Iron Plate factory");
    expect(screen.getByRole("button", { name: "Merge into one" })).toHaveAccessibleDescription(NEEDS_NEWER_BACKEND);
  });

  it("on designation_stale re-reads, drops the selection and says to select again", async () => {
    serve({ replace: () => HttpResponse.json(plannerDesignationStaleError, { status: 409 }) });
    renderView();
    await settled();
    const before = listReads;
    tick("Select Rod works");
    tick("Select Iron Plate factory");
    fireEvent.click(screen.getByRole("button", { name: "Merge into one" }));
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    expect(await screen.findByText(STALE_TEXT)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select Rod works" })).not.toBeChecked();
    expect(within(screen.getByRole("group", { name: "Selected factories" })).getByRole("status")).toHaveTextContent("No factories selected");
    await waitFor(() => expect(listReads).toBeGreaterThan(before));
  });

  it("Clear selection empties it; a viewer gets no ticks at all", async () => {
    serve();
    renderView();
    await settled();
    tick("Select Rod works");
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByRole("checkbox", { name: "Select Rod works" })).not.toBeChecked();
    view.unmount();
    renderView(serversRoleViewer);
    await settled();
    expect(screen.queryByRole("checkbox", { name: /^Select / })).not.toBeInTheDocument();
  });
});

describe("splitting a designated factory", () => {
  it("splits the ticked groups' members into a new factory and keeps the rest under the designation's id", async () => {
    serve();
    renderView();
    await openRodWorks();
    expect(screen.queryByRole("button", { name: "Designate selected" })).not.toBeInTheDocument();
    tick("Select Constructor");
    fireEvent.click(screen.getByRole("button", { name: "Split into a new factory" }));
    // One group: the dialog proposes its name (a pop-out).
    const field = screen.getByRole("textbox", { name: "Name" });
    expect(field).toHaveValue("Iron Rod, Constructor");
    fireEvent.change(field, { target: { value: "Rod line" } });
    fireEvent.click(screen.getByRole("button", { name: "Split" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.body).toEqual({
      expect: [{ id: DESIGNATION, revision: 2 }],
      put: [
        { id: DESIGNATION, name: "Rod works", members: sinkIds.map(memberOf) },
        { name: "Rod line", members: rodIds.map(memberOf) },
      ],
      intent: "pop_out",
    });
    const undo = await screen.findByRole("button", { name: "Undo" });
    await waitFor(() => expect(undo).toHaveFocus());
    fireEvent.click(undo);
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]!.body.intent).toBe("undo");
    expect(sent[1]!.body.expect.map((e) => e.id)).toEqual([DESIGNATION, "00000000-0000-4000-8000-000000000001"]);
    expect(sent[1]!.body.put).toEqual([{ id: DESIGNATION, name: "Rod works", members: rodWorks, createdAt: CREATED }]);
    expect(await screen.findByText(UNDO_DONE, { selector: "#planner-undo-message" })).toBeInTheDocument();
  });

  it("refuses to split the whole factory, saying to rename it", async () => {
    serve();
    renderView();
    await openRodWorks();
    tick("Select Constructor");
    tick("Select AWESOME Sink");
    fireEvent.click(screen.getByRole("button", { name: "Split into a new factory" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "All" } });
    fireEvent.click(screen.getByRole("button", { name: "Split" }));
    expect(await screen.findByText("That is the whole factory; rename it instead.")).toBeInTheDocument();
    expect(sent).toHaveLength(0);
  });

  it("pops a row's group out at once, named after it", async () => {
    serve();
    renderView();
    await openRodWorks();
    fireEvent.click(screen.getByRole("button", { name: "Pop out 2× Constructor, Iron Rod" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.body.intent).toBe("pop_out");
    expect(sent[0]!.body.put[1]).toEqual({ name: "Iron Rod, Constructor", members: rodIds.map(memberOf) });
  });

  it("dissolves after a confirm, offering Undo", async () => {
    serve();
    renderView();
    await openRodWorks();
    fireEvent.click(screen.getByRole("button", { name: "Dissolve Rod works" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Confirm dissolve Rod works" })).getByRole("button", { name: "Dissolve" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.body).toEqual({ expect: [{ id: DESIGNATION, revision: 2 }], put: [], intent: "dissolve" });
    expect(await screen.findByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(screen.getByText("Dissolved Rod works. Its machines are grouped automatically again.", { selector: "#planner-undo-message" })).toBeInTheDocument();
  });

  it("keeps Remove and Designate selected on an older backend without revisions", async () => {
    serve({ revision: false });
    renderView();
    await openRodWorks();
    expect(screen.getByRole("button", { name: "Remove Rod works" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Designate selected" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Pop out/ })).not.toBeInTheDocument();
  });
});

describe("the selection bars and the pop-out's errors (#753 review)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const wideScreen = () =>
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("min-width"), addEventListener: () => {}, removeEventListener: () => {} }));
  const failing = () => HttpResponse.json({ error: { code: "internal_error", message: "The write failed." } }, { status: 500 });

  it("reserves the merge bar before anything is picked, so a pick does not move the canvas", async () => {
    wideScreen();
    serve();
    renderView();
    const svg = await screen.findByRole("img", { name: /^Graph of Factories/ }, { timeout: 3_000 });
    // Owned and writable: the bar is there before the first pick, idle.
    const bar = screen.getByRole("group", { name: "Selected factories" });
    expect(within(bar).getByRole("status")).toHaveTextContent("No factories selected");
    expect(within(bar).getByRole("button", { name: "Merge into one" })).toHaveAttribute("aria-disabled", "true");
    expect(within(bar).getByRole("button", { name: "Clear selection" })).toBeDisabled();
    // What stands above the canvas is the same elements before and after a pick: nothing is inserted to push it down.
    const page = bar.parentElement!;
    let canvas: Element = svg;
    while (canvas.parentElement !== page) canvas = canvas.parentElement!;
    const above = () => [...page.children].slice(0, [...page.children].indexOf(canvas));
    const before = above();
    fireEvent.click(svg.querySelector<SVGGElement>('[data-card="factory"]')!, { shiftKey: true });
    expect(within(bar).getByRole("status")).toHaveTextContent("1 factory selected");
    const after = above();
    expect(after).toHaveLength(before.length);
    after.forEach((el, i) => expect(el).toBe(before[i]));
  });

  it("keeps one polite live region for the count while the name form opens and closes", async () => {
    serve();
    renderView();
    await settled();
    tick("Select Rod works");
    tick("Select Iron Plate factory");
    const count = within(screen.getByRole("group", { name: "Selected factories" })).getByRole("status");
    expect(count).toHaveAttribute("aria-live", "polite");
    fireEvent.click(screen.getByRole("button", { name: "Merge into one" }));
    expect(screen.getByRole("textbox", { name: "Name" })).toBeInTheDocument();
    expect(count).toBeInTheDocument();
    expect(count).toHaveTextContent("2 factories selected");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(count).toBeInTheDocument();
    tick("Select Rod works");
    expect(count).toHaveTextContent("1 factory selected");
  });

  it("keeps the split bar's count mounted while its name form is open", async () => {
    serve();
    renderView();
    await openRodWorks();
    tick("Select Constructor");
    const count = within(screen.getByRole("group", { name: "Split" })).getByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "Split into a new factory" }));
    expect(screen.getByRole("textbox", { name: "Name" })).toBeInTheDocument();
    expect(count).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(count).toBeInTheDocument();
  });

  it("shows a failed pop-out from the group panel in the panel, not on the page", async () => {
    wideScreen();
    serve({ replace: failing });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: /^Open factory: Rod works/ }, { timeout: 3_000 }));
    await screen.findByRole("img", { name: /^Graph of Rod works/ }, { timeout: 3_000 });
    const cards = screen.getByRole("list", { name: "Cards in the graph" });
    fireEvent.click(within(cards).getAllByRole("button", { name: /Constructor/ })[0]!);
    const panel = await screen.findByRole("complementary");
    fireEvent.click(within(panel).getByRole("button", { name: /^Pop out/ }));
    await waitFor(() => expect(sent).toHaveLength(1));
    const alert = await within(panel).findByRole("alert");
    expect(alert.textContent).not.toBe("");
    // The page says nothing of it: every alert on the page is the panel's.
    for (const a of screen.getAllByRole("alert")) expect(panel).toContainElement(a);
  });

  it("still shows a failed pop-out from a table row on the page", async () => {
    serve({ replace: failing });
    renderView();
    await openRodWorks();
    fireEvent.click(screen.getByRole("button", { name: "Pop out 2× Constructor, Iron Rod" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(await screen.findByRole("alert")).not.toHaveTextContent(/^$/);
  });
});
