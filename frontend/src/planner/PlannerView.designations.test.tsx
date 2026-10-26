import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse, type JsonBodyType } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endpoints, ProductionGraphResponseSchema } from "@satisfactory-dash/shared";
import {
  plannerDesignationOverlapError,
  productionGraphFactories,
  serversRoleAdmin,
  serversRoleOwner,
  serversRoleViewer,
} from "@satisfactory-dash/shared/fixtures";
import { ServerContext } from "../servers/ServerContext";
import { renderWithClient } from "../test/render";
import { server } from "../test/server";
import { PlannerView } from "./PlannerView";

afterEach(() => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0))));

const ROD = "factory|Desc_IronRod_C|1250|100";
const DESIGNATION = "6f1c2a9e-3b7d-4e58-9a41-0c5d8e2f7b10";
const OLDER = "a84d5e17-92c3-4f06-b1d8-3e7a6c90d254";
const BASE = ProductionGraphResponseSchema.parse(productionGraphFactories);

/** The fixture's groups with one id per machine (its own ids are one per group), and a building for each id. */
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
const rodMachines = nodes.find((n) => n.key === "Build_ConstructorMk1_C|Iron Rod|1250|100")!.machineIds;
const rodMembers = rodMachines.map((id, i) => ({ id, c: "Build_ConstructorMk1_C", x: 1250 + i * 4, y: 100 }));
const GHOST = { id: "Build_ConstructorMk1_C_gone", c: "Build_ConstructorMk1_C", x: 9000, y: 9000 };

interface Seen {
  method: string;
  url: string;
  body: unknown;
}
let seen: Seen[];

function serve(opts: { designated?: boolean; members?: object[]; match?: object; write?: (req: Request) => Response | undefined } = {}) {
  const factories = BASE.data.factories!.map((f) => (opts.designated && f.key === ROD ? { ...f, name: "Rod works", designationId: DESIGNATION, sideProducts: [] } : f));
  const graph = { ...BASE, data: { ...BASE.data, nodes, factories } };
  const members = opts.members ?? rodMembers;
  const list = {
    designations: opts.designated
      ? [{ id: DESIGNATION, name: "Rod works", mode: "core", members, createdAt: "2026-10-24T10:00:00.000Z", updatedAt: "2026-10-24T10:00:00.000Z" }]
      : [],
    matches: opts.designated ? [{ designationId: DESIGNATION, matched: members.length, missing: 0, ...opts.match }] : [],
  };
  const record = async (req: Request, answer: JsonBodyType, status = 200) => {
    const text = await req.clone().text();
    seen.push({ method: req.method, url: new URL(req.url).pathname, body: text === "" ? undefined : JSON.parse(text) });
    return opts.write?.(req) ?? HttpResponse.json(answer, { status });
  };
  server.use(
    http.get(endpoints.productionGraph.route, () => HttpResponse.json(graph)),
    http.get(endpoints.factory.route, () => HttpResponse.json({ serverId: "default", observedAt: BASE.observedAt, stale: false, data: { buildings, backedUpCount: 0 } })),
    http.get(endpoints.plannerDesignations.list.route, () => HttpResponse.json(list)),
    http.post(endpoints.plannerDesignations.create.route, (info) => record(info.request, list.designations[0] ?? { ...rodDesignation() }, 201)),
    http.put(endpoints.plannerDesignations.update.route, (info) => record(info.request, rodDesignation())),
    http.delete(endpoints.plannerDesignations.remove.route, (info) => record(info.request, { deleted: true })),
  );
}
const rodDesignation = () => ({ id: DESIGNATION, name: "Rod works", mode: "core", members: rodMembers, createdAt: "2026-10-24T10:00:00.000Z", updatedAt: "2026-10-24T10:00:00.000Z" });

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

/** A card once every read has answered: a save takes the machines' places from the factory read, and on a slow runner
 *  the graph can show before it does ("The positions of these machines aren't known yet."). */
const card = async (name: string) => {
  const heading = await screen.findByRole("heading", { name });
  await waitFor(() => expect(view.client.isFetching()).toBe(0));
  return heading.closest("li") as HTMLElement;
};
const openRod = async (title = "Iron Rod factory (+ Iron Rod)") => {
  fireEvent.click(within(await card(title)).getByRole("button", { name: /^Open factory/ }));
  return screen.findByRole("heading", { name: "Groups" });
};
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  seen = [];
});

describe("PlannerView: designating from the text form (ADR-0055 Decision 5)", () => {
  it("ticks a group, names it and sends the group's machines with their ids, classes and whole-metre places", async () => {
    serve();
    renderView();
    await openRod();
    const designate = screen.getByRole("button", { name: "Designate selected" });
    expect(designate).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Constructor" }));
    expect(screen.getByText("1 group, 2 machines selected")).toBeInTheDocument();
    fireEvent.click(designate);
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
    type("Name", "  Rod works  ");
    fireEvent.click(screen.getByRole("button", { name: "Designate" }));
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toMatchObject({ method: "POST", body: { name: "Rod works", mode: "core", members: rodMembers } });
    // The form closes and the ticks clear once the backend has taken it.
    await waitFor(() => expect(screen.queryByRole("form", { name: "Name the designated factory" })).not.toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: "Select Constructor" })).not.toBeChecked();
  });

  it("works for an admin and refuses a name the backend would, before sending", async () => {
    serve();
    renderView(serversRoleAdmin);
    await openRod();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Constructor" }));
    fireEvent.click(screen.getByRole("button", { name: "Designate selected" }));
    type("Name", "   ");
    fireEvent.click(screen.getByRole("button", { name: "Designate" }));
    expect(await screen.findByText(/Enter a name of 1 to 64 characters/)).toBeInTheDocument();
    expect(seen).toHaveLength(0);
  });

  it("Escape cancels the name dialog and puts focus back on the button that opened it", async () => {
    serve();
    renderView();
    await openRod();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Constructor" }));
    fireEvent.click(screen.getByRole("button", { name: "Designate selected" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Name" }), { key: "Escape" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Designate selected" })).toHaveFocus());
    expect(seen).toHaveLength(0);
  });

  it("says why a designation could not be made: overlap names the other, the cap says how many", async () => {
    serve({ write: () => HttpResponse.json(plannerDesignationOverlapError, { status: 409 }) });
    renderView();
    await openRod();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Constructor" }));
    fireEvent.click(screen.getByRole("button", { name: "Designate selected" }));
    type("Name", "Rod works");
    fireEvent.click(screen.getByRole("button", { name: "Designate" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Some of these machines already belong to Iron line");
    // The form stays open for a retry.
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Rod works");

    server.use(
      http.post(endpoints.plannerDesignations.create.route, () =>
        HttpResponse.json({ error: { code: "designation_cap", message: "Too many", requestId: "r-1" } }, { status: 409 }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Designate" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("You can have up to 50 designated factories"));
  });

  it("keeps a suggestion: Reason factories for me shows automatic factories dashed, and Keep saves one under a name", async () => {
    serve();
    renderView();
    const plate = await card("Iron Plate factory");
    expect(plate).not.toHaveClass("border-dashed");
    expect(within(plate).queryByRole("button", { name: /^Keep/ })).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Reason factories for me" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(plate).toHaveClass("border-dashed");
    expect(plate).toHaveTextContent("Suggestion");
    fireEvent.click(within(plate).getByRole("button", { name: "Keep Iron Plate factory" }));
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Iron Plate factory");
    fireEvent.click(screen.getByRole("button", { name: "Keep factory" }));
    await waitFor(() => expect(seen).toHaveLength(1));
    const body = seen[0].body as { name: string; mode: string; members: unknown[] };
    expect(body).toMatchObject({ name: "Iron Plate factory", mode: "core" });
    // Its miner, depot, four smelters, four constructors and storage container.
    expect(body.members).toHaveLength(11);
  });
});

describe("PlannerView: designated factories", () => {
  it("marks one as designated and offers Rename, which sends only the name", async () => {
    serve({ designated: true });
    renderView();
    const rod = await card("Rod works");
    expect(rod).toHaveTextContent("Designated");
    expect(rod).not.toHaveTextContent("no longer found");
    fireEvent.click(within(rod).getByRole("button", { name: "Rename Rod works" }));
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Rod works");
    type("Name", "Rod line");
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toMatchObject({ method: "PUT", url: `/api/servers/default/planner/designations/${DESIGNATION}`, body: { name: "Rod line" } });
  });

  it("asks before removing, and only then deletes", async () => {
    serve({ designated: true });
    renderView();
    const rod = await card("Rod works");
    fireEvent.click(within(rod).getByRole("button", { name: "Remove Rod works" }));
    expect(seen).toHaveLength(0);
    const confirm = within(rod).getByRole("group", { name: "Confirm remove Rod works" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(seen).toHaveLength(0);
    fireEvent.click(within(rod).getByRole("button", { name: "Remove Rod works" }));
    fireEvent.click(within(within(rod).getByRole("group", { name: "Confirm remove Rod works" })).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toMatchObject({ method: "DELETE", url: `/api/servers/default/planner/designations/${DESIGNATION}` });
  });

  it("says how many machines are no longer found, and Clean up sends the members that are", async () => {
    serve({ designated: true, members: [...rodMembers, GHOST], match: { matched: 2, missing: 1 } });
    renderView();
    const rod = await card("Rod works");
    expect(await within(rod).findByText("1 machine no longer found")).toBeInTheDocument();
    fireEvent.click(within(rod).getByRole("button", { name: "Clean up Rod works" }));
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toMatchObject({ method: "PUT", body: { members: rodMembers } });
  });

  it("does not offer Clean up when this page cannot tell which members are gone", async () => {
    serve({ designated: true, match: { matched: 1, missing: 1 } });
    renderView();
    const rod = await card("Rod works");
    expect(await within(rod).findByText("1 machine no longer found")).toBeInTheDocument();
    expect(within(rod).queryByRole("button", { name: /Clean up/ })).not.toBeInTheDocument();
  });

  it("lists an unmatched designation as such: no Clean up, and nothing deletes it", async () => {
    serve({ designated: true, members: [GHOST], match: { matched: 0, missing: 1 } });
    renderView();
    const rod = await card("Rod works");
    expect(await within(rod).findByText(/All machines missing/)).toBeInTheDocument();
    expect(within(rod).queryByRole("button", { name: /Clean up/ })).not.toBeInTheDocument();
    expect(seen).toHaveLength(0);
  });

  it("says what an older designation claimed", async () => {
    serve({ designated: true, match: { claimedBy: { id: OLDER, name: "Iron line", count: 2 } } });
    renderView();
    expect(await within(await card("Rod works")).findByText("2 machines claimed by Iron line")).toBeInTheDocument();
  });
});

describe("PlannerView: a viewer", () => {
  it("sees designations and their status but gets no way to write", async () => {
    serve({ designated: true, members: [GHOST], match: { matched: 0, missing: 1 } });
    renderView(serversRoleViewer);
    const rod = await card("Rod works");
    expect(await within(rod).findByText(/All machines missing/)).toBeInTheDocument();
    expect(rod).toHaveTextContent("Designated");
    expect(within(rod).queryByRole("button", { name: /Rename|Remove|Clean up/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reason factories for me" }));
    const plate = await card("Iron Plate factory");
    expect(plate).toHaveTextContent("Suggestion");
    expect(within(plate).queryByRole("button", { name: /^Keep/ })).not.toBeInTheDocument();
    fireEvent.click(within(plate).getByRole("button", { name: /^Open factory/ }));
    await screen.findByRole("heading", { name: "Groups" });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Designate selected" })).not.toBeInTheDocument();
  });
});

describe("PlannerView: designating on the canvas (ADR-0055 Decision 5, PR 10b)", () => {
  beforeEach(() => {
    // A wide screen: the graph is the default view.
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("min-width"), addEventListener: () => {}, removeEventListener: () => {} }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const rodGraph = () => screen.findByRole("img", { name: /^Graph of Iron Rod factory/ }, { timeout: 3_000 });
  const openRodGraph = async (servers = serversRoleOwner) => {
    renderView(servers);
    fireEvent.click(await screen.findByRole("button", { name: /^Open factory: Iron Rod factory/ }, { timeout: 3_000 }));
    return rodGraph();
  };
  const cardList = () => screen.getByRole("list", { name: "Cards in the graph" });
  /** jsdom has no layout: the SVG's rect is empty, so stage points are client points. */
  const pointer = (type: string, pointerId: number, clientX: number, clientY: number) =>
    fireEvent(window, Object.assign(new MouseEvent(type, { clientX, clientY }), { pointerId }));
  /** A lasso round the whole drawing, from far outside it. */
  const lassoAll = (svg: HTMLElement, opts: { shiftKey?: boolean } = {}) => {
    fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: -5000, clientY: -5000, ...opts });
    pointer("pointermove", 1, 5000, -5000);
    pointer("pointermove", 1, 5000, 5000);
    pointer("pointermove", 1, -5000, 5000);
    pointer("pointerup", 1, -5000, 5000);
  };
  const transformOf = (svg: HTMLElement) => svg.querySelector(":scope > g")?.getAttribute("transform");
  const pickButtons = () => within(cardList()).getAllByRole("button", { name: /^Pick / });

  it("Select mode turns a card's button into a pick toggle shared with the table's ticks, and Designate selected sends its machines", async () => {
    serve();
    const svg = await openRodGraph();
    const select = screen.getByRole("button", { name: "Select" });
    expect(select).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(select);
    expect(select).toHaveAttribute("aria-pressed", "true");
    const pick = within(cardList()).getByRole("button", { name: /^Pick .*Constructor/ });
    expect(pick).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(pick);
    expect(pick).toHaveAttribute("aria-pressed", "true");
    expect(svg.querySelectorAll("[data-picked]")).toHaveLength(1);
    expect(svg.querySelector("[data-check]")).not.toBeNull();
    expect(screen.getByText("1 group, 2 machines selected")).toBeInTheDocument();
    // The ticks in the Tables view are the same selection.
    fireEvent.click(screen.getByRole("button", { name: "Tables" }));
    expect(screen.getByRole("checkbox", { name: "Select Constructor" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Graph" }));
    await rodGraph();
    fireEvent.click(screen.getByRole("button", { name: "Designate selected" }));
    type("Name", "Rod works");
    fireEvent.click(screen.getByRole("button", { name: "Designate" }));
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toMatchObject({ method: "POST", body: { name: "Rod works", mode: "core", members: rodMembers } });
  });

  it("a lasso in Select mode picks every card it encloses instead of panning, and Escape clears the picks", async () => {
    serve();
    const svg = await openRodGraph();
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    const before = transformOf(svg);
    fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: -5000, clientY: -5000 });
    pointer("pointermove", 1, 5000, -5000);
    pointer("pointermove", 1, 5000, 5000);
    // The shape is drawn while the pointer is down.
    expect(svg.querySelector("[data-lasso]")).not.toBeNull();
    pointer("pointermove", 1, -5000, 5000);
    pointer("pointerup", 1, -5000, 5000);
    expect(svg.querySelector("[data-lasso]")).toBeNull();
    expect(transformOf(svg)).toBe(before);
    const picks = pickButtons();
    expect(picks.length).toBeGreaterThan(0);
    for (const b of picks) expect(b).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(screen.getByRole("group", { name: /^Graph viewport/ }), { key: "Escape" });
    for (const b of pickButtons()) expect(b).toHaveAttribute("aria-pressed", "false");
  });

  it("Shift+drag lassos without Select mode, and a plain drag still pans", async () => {
    serve();
    const svg = await openRodGraph();
    const before = transformOf(svg);
    lassoAll(svg, { shiftKey: true });
    expect(transformOf(svg)).toBe(before);
    expect(svg.querySelectorAll("[data-picked]").length).toBeGreaterThan(0);
    fireEvent.pointerDown(svg, { button: 0, pointerId: 2, clientX: 100, clientY: 100 });
    pointer("pointermove", 2, 160, 130);
    pointer("pointerup", 2, 160, 130);
    expect(transformOf(svg)).not.toBe(before);
  });

  it("a member gets no Select mode, and Shift+drag pans", async () => {
    serve();
    const svg = await openRodGraph(serversRoleViewer);
    expect(screen.queryByRole("button", { name: "Select" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Designate selected" })).not.toBeInTheDocument();
    const before = transformOf(svg);
    lassoAll(svg, { shiftKey: true });
    expect(svg.querySelector("[data-picked]")).toBeNull();
    expect(transformOf(svg)).not.toBe(before);
  });

  it("shows suggestions on the overview canvas, dashed with Keep, and Keep saves one; Cancel hands focus back", async () => {
    serve();
    renderView();
    const svg = await screen.findByRole("img", { name: /^Graph of Factories/ }, { timeout: 3_000 });
    expect(svg.querySelector("[data-suggested]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reason factories for me" }));
    // The canvas stays: suggestions are drawn on it now.
    expect(screen.getByRole("img", { name: /^Graph of Factories/ })).toBe(svg);
    expect(svg.querySelectorAll("[data-suggested]").length).toBeGreaterThan(0);
    expect(within(svg).getAllByText("Suggestion").length).toBeGreaterThan(0);
    const keep = within(screen.getByRole("list", { name: "Suggested factories" })).getByRole("button", { name: "Keep Iron Plate factory" });
    fireEvent.click(keep);
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Iron Plate factory");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(keep).toHaveFocus());
    fireEvent.click(keep);
    fireEvent.click(screen.getByRole("button", { name: "Keep factory" }));
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].body).toMatchObject({ name: "Iron Plate factory", mode: "core" });
    expect((seen[0].body as { members: unknown[] }).members).toHaveLength(11);
  });

  it("a second finger cancels the lasso: nothing is picked and the pinch zooms", async () => {
    serve();
    const svg = await openRodGraph();
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    const before = transformOf(svg);
    fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: -5000, clientY: -5000 });
    pointer("pointermove", 1, 5000, -5000);
    fireEvent.pointerDown(svg, { button: 0, pointerId: 2, clientX: 100, clientY: 100 });
    expect(svg.querySelector("[data-lasso]")).toBeNull();
    pointer("pointermove", 2, 300, 300);
    pointer("pointermove", 1, 5000, 5000);
    pointer("pointerup", 2, 300, 300);
    pointer("pointerup", 1, 5000, 5000);
    expect(svg.querySelector("[data-picked]")).toBeNull();
    expect(transformOf(svg)).not.toBe(before);
  });

  it("a lasso with Shift adds to the picks, and one without replaces them", async () => {
    serve();
    const svg = await openRodGraph();
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(within(cardList()).getByRole("button", { name: /^Pick .*Constructor/ }));
    // A lasso far from every card, without Shift: replaces the pick with nothing.
    fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: -9000, clientY: -9000 });
    pointer("pointermove", 1, -8000, -9000);
    pointer("pointermove", 1, -8000, -8000);
    pointer("pointerup", 1, -8000, -8000);
    expect(svg.querySelector("[data-picked]")).toBeNull();
    fireEvent.click(within(cardList()).getByRole("button", { name: /^Pick .*Constructor/ }));
    const one = svg.querySelectorAll("[data-picked]").length;
    lassoAll(svg, { shiftKey: true });
    expect(svg.querySelectorAll("[data-picked]").length).toBeGreaterThan(one);
  });

  it("an open Keep form does not come back when the suggestions are switched off and on", async () => {
    serve();
    renderView();
    await screen.findByRole("img", { name: /^Graph of Factories/ }, { timeout: 3_000 });
    const toggle = screen.getByRole("button", { name: "Reason factories for me" });
    fireEvent.click(toggle);
    fireEvent.click(within(screen.getByRole("list", { name: "Suggested factories" })).getByRole("button", { name: "Keep Iron Plate factory" }));
    expect(screen.getByRole("textbox", { name: "Name" })).toBeInTheDocument();
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(screen.queryByRole("textbox", { name: "Name" })).not.toBeInTheDocument();
  });

  it("a member sees the suggestions on the canvas but no Keep", async () => {
    serve();
    renderView(serversRoleViewer);
    const svg = await screen.findByRole("img", { name: /^Graph of Factories/ }, { timeout: 3_000 });
    fireEvent.click(screen.getByRole("button", { name: "Reason factories for me" }));
    expect(svg.querySelectorAll("[data-suggested]").length).toBeGreaterThan(0);
    expect(svg.querySelector("[data-keep]")).toBeNull();
    expect(screen.queryByRole("list", { name: "Suggested factories" })).not.toBeInTheDocument();
  });
});
