import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, within } from "@testing-library/react";
import { factoryMixed, railsWorldResponseEmpty, resourceNodesWorldResponse } from "@satisfactory-dash/shared/fixtures";
import { endpoints, isBackedUpState, type FactoryBuilding, type ResourceNode } from "@satisfactory-dash/shared";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server";
import { renderWithClient } from "../test/render";
import { buildingState } from "./buildingState";
import { MAP_FILTERS_KEY, parseFilters } from "./mapFilters";
import type { DrawnLayer, ViewM } from "./MapCanvas";
import type { MapContext } from "./layers";
import { buildingsLayer } from "./buildingsLayer";
import { MapPanel } from "./MapPanel";
import { resourceNodesLayer } from "./resourceNodesLayer";

// The same stand-in for the lazy map chunk as MapPanel.test.tsx: jsdom has no canvas.
const canvas = vi.hoisted(() => ({ layers: [] as DrawnLayer[] }));
vi.mock("./MapCanvas", () => ({
  default: ({ layers }: { layers: DrawnLayer[]; fitTo?: ViewM; onView: (v: ViewM) => void }) => {
    canvas.layers = layers;
    return <div data-testid="map-canvas" />;
  },
}));

const nodesRoute = endpoints.map.worldLayer.route.replace(":layer", "resourceNodes");
const railsRoute = endpoints.map.worldLayer.route.replace(":layer", "rails");
const allNodes = resourceNodesWorldResponse.data as ResourceNode[];
const buildings = factoryMixed.data.buildings as FactoryBuilding[];

/** What the map was handed to draw for a layer: the layer's draw is swapped for a recorder. */
function drawnData<T>(layer: { draw: (ctx: MapContext, data: T) => () => void; id: string }): T | undefined {
  let seen: T | undefined;
  const spy = vi.spyOn(layer, "draw").mockImplementation((_ctx, data) => {
    seen = data;
    return () => {};
  });
  canvas.layers.find((l) => l.id === layer.id)?.draw({} as MapContext);
  spy.mockRestore();
  return seen;
}
const drawnNodes = () => drawnData(resourceNodesLayer as never) as ResourceNode[] | undefined;
const drawnBuildings = () => (drawnData(buildingsLayer as never) as { buildings: FactoryBuilding[] } | undefined)?.buildings;

async function mount() {
  server.use(
    http.get(nodesRoute, () => HttpResponse.json(resourceNodesWorldResponse)),
    http.get(railsRoute, () => HttpResponse.json(railsWorldResponseEmpty)),
  );
  const result = renderWithClient(<MapPanel snapshot={factoryMixed} serverId="default" />);
  await screen.findByRole("table", { name: /Resource nodes in view/ });
  return result;
}
// jsdom opens a <details> on a summary click but never fires its `toggle` event, as a browser does.
const openFilters = () => {
  const summary = screen.getByText("Filters");
  fireEvent.click(summary);
  fireEvent(summary.closest("details")!, new Event("toggle"));
};
const box = (name: RegExp | string) => screen.getByRole("checkbox", { name });
const counted = (label: string, count: number) => new RegExp(String.raw`^${label}\s*\(${count}\)$`);
const stored = () => JSON.parse(window.localStorage.getItem(MAP_FILTERS_KEY) ?? "null");
const nodeRows = () => within(screen.getByRole("table", { name: /Resource nodes in view/ })).getAllByRole("row").length - 1;

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("map filters", () => {
  it("lists the resource types in the data with counts, and a hidden type is not drawn", async () => {
    await mount();
    openFilters();
    expect(box(/^SAM\s*\(2\)/)).toBeChecked();
    expect(box(/^Coal\s*\(1\)/)).toBeChecked();
    expect(drawnNodes()).toHaveLength(allNodes.length);
    fireEvent.click(box(/^SAM/));
    expect(drawnNodes()!.map((n) => n.type)).not.toContain("SAM");
    expect(drawnNodes()).toHaveLength(allNodes.length - 2);
    expect(nodeRows()).toBe(allNodes.length - 2);
  });

  it("says N of M shown in the summary when a filter hides some, and nothing extra when none do", async () => {
    await mount();
    expect(screen.queryByText(/resource nodes shown/)).not.toBeInTheDocument();
    openFilters();
    fireEvent.click(box(/^SAM/));
    // One sentence, not an "N of M" line over the usual summary.
    expect(screen.getByText(/^5 of 7 resource nodes shown \(2 in use\): .*; the rest are hidden by the filters\.$/)).toBeInTheDocument();
    expect(screen.queryByText(/resource nodes on the map/)).not.toBeInTheDocument();
  });

  it("None hides every type and All brings them back", async () => {
    await mount();
    openFilters();
    fireEvent.click(screen.getByRole("button", { name: /^None: hide.*resource types/ }));
    expect(drawnNodes()).toEqual([]);
    expect(screen.getByText("0 of 7 resource nodes shown (the rest are hidden by the filters).")).toBeInTheDocument();
    expect(screen.getByText("All hidden by the filters.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^All: show.*resource types/ }));
    expect(drawnNodes()).toHaveLength(allNodes.length);
  });

  it("filters in use vs free", async () => {
    await mount();
    openFilters();
    fireEvent.click(screen.getByRole("radio", { name: "In use only" }));
    expect(drawnNodes()!.every((n) => n.exploited)).toBe(true);
    expect(drawnNodes()).toHaveLength(allNodes.filter((n) => n.exploited).length);
    fireEvent.click(screen.getByRole("radio", { name: "Free only" }));
    expect(drawnNodes()!.every((n) => !n.exploited)).toBe(true);
    expect(drawnNodes()).toHaveLength(allNodes.filter((n) => !n.exploited).length);
    fireEvent.click(screen.getByRole("radio", { name: "All" }));
    expect(drawnNodes()).toHaveLength(allNodes.length);
  });

  it("counts the four states as the layer's text does, with backed up as a separate overlay", async () => {
    await mount();
    openFilters();
    const all = buildings;
    const n = (state: string) => all.filter((b) => buildingState(b) === state).length;
    expect(n("producing") + n("idle") + n("paused") + n("noRecipe")).toBe(all.length);
    expect(box(counted("Producing", n("producing")))).toBeInTheDocument();
    expect(box(counted("Not producing", n("idle")))).toBeInTheDocument();
    expect(box(counted("Paused", n("paused")))).toBeInTheDocument();
    expect(box(counted("No recipe", n("noRecipe")))).toBeInTheDocument();
    const backedUp = all.filter(isBackedUpState).length;
    expect(box(counted("Include backed-up buildings", backedUp))).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /^Backed up/ })).not.toBeInTheDocument();
    // The same numbers as the layer's summary.
    expect(
      screen.getByText(
        `${all.length} buildings on the map: ${n("producing")} producing, ${n("idle")} not producing, ${n("paused")} paused, ${n("noRecipe")} without a recipe; ${backedUp} backed up.`,
      ),
    ).toBeInTheDocument();
  });

  it("hides a state's buildings whether or not they are backed up, and backed-up ones whatever their state", async () => {
    await mount();
    openFilters();
    const all = buildings;
    const backedUpProducing = all.filter((b) => buildingState(b) === "producing" && isBackedUpState(b)).length;
    expect(backedUpProducing).toBeGreaterThan(0);
    fireEvent.click(box(/^Producing/));
    expect(drawnBuildings()!.some((b) => buildingState(b) === "producing")).toBe(false);
    fireEvent.click(box(/^Producing/));
    fireEvent.click(box(/^Include backed-up buildings/));
    expect(drawnBuildings()!.some(isBackedUpState)).toBe(false);
    expect(drawnBuildings()!.some((b) => buildingState(b) === "producing")).toBe(true);
  });

  it("keeps All and None to the four states and leaves the backed-up choice alone", async () => {
    await mount();
    openFilters();
    fireEvent.click(box(/^Include backed-up buildings/));
    fireEvent.click(screen.getByRole("button", { name: /^None: hide.*building states/ }));
    expect(box(/^Include backed-up buildings/)).not.toBeChecked();
    expect(box(/^Producing/)).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: /^All: show.*building states/ }));
    expect(box(/^Producing/)).toBeChecked();
    expect(box(/^Include backed-up buildings/)).not.toBeChecked();
  });

  it("hides buildings by state, with N of M in the text and the table", async () => {
    await mount();
    openFilters();
    const all = buildings;
    const backedUp = all.filter(isBackedUpState).length;
    expect(backedUp).toBeGreaterThan(0);
    fireEvent.click(box(/^Include backed-up buildings/));
    expect(drawnBuildings()).toHaveLength(all.length - backedUp);
    expect(drawnBuildings()!.some(isBackedUpState)).toBe(false);
    expect(
      screen.getByText(new RegExp(`^${all.length - backedUp} of ${all.length} buildings shown: .*; the rest are hidden by the filters\\.$`)),
    ).toBeInTheDocument();
    expect(screen.queryByText(/buildings on the map/)).not.toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: /Buildings in view/ })).getAllByRole("row")).toHaveLength(all.length - backedUp + 1);
    fireEvent.click(screen.getByRole("button", { name: /^None: hide.*building states/ }));
    expect(drawnBuildings()).toEqual([]);
    expect(screen.getByText("All hidden by the filters.", { selector: "p" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^All: show.*building states/ }));
    fireEvent.click(box(/^Include backed-up buildings/));
    expect(drawnBuildings()).toHaveLength(all.length);
  });

  it("shows a group only while its layer is on", async () => {
    await mount();
    openFilters();
    fireEvent.click(screen.getByRole("checkbox", { name: "Resource nodes" }));
    expect(screen.queryByRole("group", { name: "Resource types" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Building states" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Buildings" }));
    expect(screen.queryByText("Filters")).not.toBeInTheDocument();
  });

  it("packs each group's rows to the top, so a short group isn't spread over a long one's height", async () => {
    await mount();
    openFilters();
    for (const name of ["Resource types", "Resource nodes in use or free", "Building states"]) {
      expect(screen.getByRole("group", { name })).toHaveClass("content-start");
    }
  });

  it("gives every checkbox and radio a full-width row at least a touch target tall, and the summary too", async () => {
    await mount();
    openFilters();
    const inputs = [...screen.getAllByRole("checkbox"), ...screen.getAllByRole("radio")].filter((i) => i.closest("details"));
    expect(inputs.length).toBeGreaterThan(10);
    for (const input of inputs) {
      const row = input.closest("label")!;
      expect(row).toHaveClass("min-h-touch", "w-full", "items-center");
    }
    expect(screen.getByText("Filters").closest("summary")).toHaveClass("min-h-touch");
  });

  it("summarises what is hidden while collapsed", async () => {
    await mount();
    expect(screen.getByText("(nothing hidden)")).toBeInTheDocument();
    openFilters();
    fireEvent.click(box(/^SAM/));
    fireEvent.click(screen.getByRole("radio", { name: "Free only" }));
    fireEvent.click(box(/^Paused/));
    expect(screen.getByText("(1 resource type hidden, free nodes only, 1 building state hidden)")).toBeInTheDocument();
  });
});

describe("remembering the choices", () => {
  it("restores layer toggles, filters and the open state after a reload", async () => {
    const first = await mount();
    openFilters();
    fireEvent.click(box(/^SAM/));
    fireEvent.click(screen.getByRole("radio", { name: "In use only" }));
    fireEvent.click(box(/^Producing/));
    fireEvent.click(screen.getByRole("checkbox", { name: "Rails" }));
    expect(stored()).toMatchObject({ v: 1, layers: { rails: false }, open: true, hiddenTypes: ["SAM"], use: "used", hiddenStates: ["producing"] });
    first.unmount();

    await mount();
    expect(screen.getByRole("checkbox", { name: "Rails" })).not.toBeChecked();
    expect(box(/^SAM/)).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "In use only" })).toBeChecked();
    expect(box(/^Producing/)).not.toBeChecked();
    expect(drawnNodes()!.every((n) => n.exploited && n.type !== "SAM")).toBe(true);
  });

  it.each([
    ["not JSON", "{oops"],
    ["an old version", JSON.stringify({ v: 0, hiddenTypes: ["Coal"] })],
    ["a future version", JSON.stringify({ v: 2, layers: {}, open: false, hiddenTypes: ["Coal"], use: "all", hiddenStates: [] })],
    ["wrong shapes", JSON.stringify({ v: 1, layers: [], open: "yes", hiddenTypes: "Coal", use: "some", hiddenStates: [1] })],
    ["an unknown use choice", JSON.stringify({ v: 1, layers: {}, open: false, hiddenTypes: [], use: "some", hiddenStates: [] })],
    ["null", "null"],
  ])("falls back to everything shown for %s", async (_name, value) => {
    window.localStorage.setItem(MAP_FILTERS_KEY, value);
    expect(parseFilters(value)).toBeNull();
    await mount();
    expect(drawnNodes()).toHaveLength(allNodes.length);
    expect(drawnBuildings()).toHaveLength(factoryMixed.data.buildings.length);
    expect(screen.getByText("(nothing hidden)")).toBeInTheDocument();
  });

  it("keeps working when storage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await mount();
    openFilters();
    fireEvent.click(box(/^SAM/));
    expect(drawnNodes()).toHaveLength(allNodes.length - 2);
  });

  it("reads a value stored before backed up became an overlay, and applies it to backed-up buildings", async () => {
    window.localStorage.setItem(
      MAP_FILTERS_KEY,
      JSON.stringify({ v: 1, layers: {}, open: true, hiddenTypes: [], use: "all", hiddenStates: ["backedUp", "paused"] }),
    );
    await mount();
    expect(box(/^Include backed-up buildings/)).not.toBeChecked();
    expect(box(/^Paused/)).not.toBeChecked();
    expect(drawnBuildings()!.some(isBackedUpState)).toBe(false);
  });

  it("shows a type the saved state has never seen, and ignores saved types that are gone", async () => {
    window.localStorage.setItem(
      MAP_FILTERS_KEY,
      JSON.stringify({ v: 1, layers: {}, open: true, hiddenTypes: ["Coal", "Unobtainium"], use: "all", hiddenStates: [] }),
    );
    await mount();
    expect(box(/^Coal/)).not.toBeChecked();
    expect(box(/^SAM/)).toBeChecked();
    expect(screen.queryByRole("checkbox", { name: /Unobtainium/ })).not.toBeInTheDocument();
    expect(drawnNodes()!.map((n) => n.type)).not.toContain("Coal");
  });
});

describe("parseFilters", () => {
  it("drops unknown building states and keeps the known ones", () => {
    const parsed = parseFilters(
      JSON.stringify({ v: 1, layers: { rails: false }, open: false, hiddenTypes: [], use: "free", hiddenStates: ["paused", "bogus"] }),
    );
    expect([...parsed!.hiddenStates]).toEqual(["paused"]);
    expect(parsed!.layers.get("rails")).toBe(false);
    expect(parsed!.use).toBe("free");
  });
  it("refuses an oversized list", () => {
    const big = Array.from({ length: 500 }, (_, i) => `t${i}`);
    expect(parseFilters(JSON.stringify({ v: 1, layers: {}, open: false, hiddenTypes: big, use: "all", hiddenStates: [] }))).toBeNull();
  });
});

describe("hunt findings", () => {
  it("keeps prototype-looking names as plain data", () => {
    const parsed = parseFilters(
      '{"v":1,"layers":{"__proto__":true,"constructor":false},"open":false,"hiddenTypes":["__proto__"],"use":"all","hiddenStates":[]}',
    );
    expect(parsed!.layers.get("__proto__")).toBe(true);
    expect(parsed!.hiddenTypes.has("__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).constructor).toBe(Object);
  });

  it("does not hand the canvas new layers when a re-render brings nothing new", async () => {
    const { rerender, client } = await mount();
    const before = canvas.layers;
    rerender(<QueryClientProvider client={client}><MapPanel snapshot={factoryMixed} serverId="default" /></QueryClientProvider>);
    expect(canvas.layers).toBe(before);
  });

  it("gives the All and None buttons accessible names that contain their visible text", async () => {
    await mount();
    openFilters();
    for (const visible of ["All", "None"]) {
      for (const button of screen.getAllByText(visible, { selector: "button" })) {
        expect(button.getAttribute("aria-label") ?? "").toMatch(new RegExp(visible, "i"));
      }
    }
  });
});
