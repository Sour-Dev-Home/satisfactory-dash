import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  errorUpstreamUnreachable,
  factoryMixed,
  factoryOldBackend,
  mapMarkersWorldResponse,
  railsWorldResponse,
  railsWorldResponseEmpty,
  railsWorldResponseTruncated,
  resourceNodesWorldResponse,
} from "@satisfactory-dash/shared/fixtures";
import { endpoints, type FactoryResponse } from "@satisfactory-dash/shared";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mapLiveResponse, mapLiveResponseEmpty, mapLiveResponseStale } from "../test/mapLiveResponses";
import { mapMarkersWorldResponseEmpty, mapMarkersWorldResponseTruncated } from "../test/mapMarkersResponses";
import { server } from "../test/server";
import { renderWithClient } from "../test/render";
import type { DrawnLayer, ViewM } from "./MapCanvas";
import { MapPanel } from "./MapPanel";

// jsdom has no canvas, so Leaflet can't draw here: a stub stands in for the lazy map chunk,
// records what it was given, and reports the view the test sets. The real map runs in e2e.
const canvas = vi.hoisted(() => ({ layers: [] as DrawnLayer[], fitTo: undefined as ViewM | undefined, view: null as ViewM | null }));
vi.mock("./MapCanvas", () => ({
  default: ({ layers, fitTo, onView }: { layers: DrawnLayer[]; fitTo?: ViewM; onView: (v: ViewM) => void }) => {
    canvas.layers = layers;
    canvas.fitTo = fitTo;
    if (canvas.view) queueMicrotask(() => onView(canvas.view!));
    return <div data-testid="map-canvas" />;
  },
}));

const buildings = factoryMixed.data.buildings;
const railsRoute = endpoints.map.worldLayer.route.replace(":layer", "rails");
const liveRoute = endpoints.map.live.route;
const nodesRoute = endpoints.map.worldLayer.route.replace(":layer", "resourceNodes");
const markersRoute = endpoints.map.worldLayer.route.replace(":layer", "mapMarkers");
const ids = () => canvas.layers.map((l) => l.id);
const mount = (snapshot: FactoryResponse = factoryMixed) => renderWithClient(<MapPanel snapshot={snapshot} serverId="default" />);

describe("MapPanel", () => {
  it("draws the buildings layer and fits the first view to the factory", async () => {
    canvas.view = null;
    mount();
    await screen.findByTestId("map-canvas");
    expect(ids()).toContain("buildings");
    const xs = buildings.map((b) => b.location!.xM);
    expect(canvas.fitTo).toMatchObject({ minX: Math.min(...xs), maxX: Math.max(...xs) });
  });

  it("describes the layer in text: counts by state and backed up", async () => {
    mount();
    await screen.findByTestId("map-canvas");
    expect(screen.getByText(/^5 buildings on the map:/)).toHaveTextContent(/2 backed up\./);
  });

  it("lists only the buildings in view, and follows the view", async () => {
    const first = buildings[0].location!;
    canvas.view = { minX: first.xM - 1, maxX: first.xM + 1, minY: first.yM - 1, maxY: first.yM + 1 };
    mount();
    const table = await screen.findByRole("table", { name: /Buildings in view \(\d+\)/ });
    const rows = within(table).getAllByRole("row").slice(1);
    const expected = buildings.filter((b) => b.location!.xM === first.xM && b.location!.yM === first.yM);
    expect(rows).toHaveLength(expected.length);
    expect(rows[0]).toHaveTextContent(buildings[0].name);
    canvas.view = null;
  });

  it("says so when nothing is in view", async () => {
    canvas.view = { minX: 9000, maxX: 9001, minY: 9000, maxY: 9001 };
    mount();
    expect((await screen.findAllByText("None in view. Zoom out or pan to see more.", { selector: "p" })).length).toBeGreaterThan(0);
    canvas.view = null;
  });

  it("hides the layer, its legend and its list when toggled off", async () => {
    mount();
    await screen.findByTestId("map-canvas");
    fireEvent.click(screen.getByRole("checkbox", { name: "Buildings" }));
    expect(ids()).not.toContain("buildings");
    expect(screen.queryByText("Backed up (ring)")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Buildings in view/ })).not.toBeInTheDocument();
  });

  it("works with an older backend that sends no positions: says so, and shows the whole world", async () => {
    mount(factoryOldBackend);
    await screen.findByTestId("map-canvas");
    expect(canvas.fitTo).toBeUndefined();
    expect(screen.getByText(/^0 buildings on the map/)).toHaveTextContent(/have no position yet/);
  });
});

describe("MapPanel world layers (ADR-0038 M5)", () => {
  it("draws rails, then resource nodes, then buildings, then markers, once the world data arrives", async () => {
    mount();
    await waitFor(() => expect(ids()).toEqual(["rails", "resourceNodes", "buildings", "mapMarkers", "trains"]));
  });

  it("describes both layers in text and lists them in view", async () => {
    canvas.view = null;
    mount();
    expect(await screen.findByText(/^1 rail segment on the map/)).toBeInTheDocument();
    expect(await screen.findByText(/^7 resource nodes on the map \(2 in use\)/)).toBeInTheDocument();
    const nodes = await screen.findByRole("table", { name: /Resource nodes in view \(7\)/ });
    expect(within(nodes).getAllByRole("row")).toHaveLength(1 + resourceNodesWorldResponse.data.length);
    const rails = await screen.findByRole("table", { name: /Rail segments in view \(1\)/ });
    expect(within(rails).getByText(railsWorldResponse.data[0].id)).toBeInTheDocument();
  });

  it("follows the view in the world tables too", async () => {
    const coal = resourceNodesWorldResponse.data.find((n) => n.type === "Coal")!;
    canvas.view = { minX: coal.x - 1, maxX: coal.x + 1, minY: coal.y - 1, maxY: coal.y + 1 };
    mount();
    const nodes = await screen.findByRole("table", { name: /Resource nodes in view \(1\)/ });
    expect(within(nodes).getByText("Coal")).toBeInTheDocument();
    expect(within(nodes).getByText("In use")).toBeInTheDocument();
    canvas.view = null;
  });

  it("drops a world layer, its legend, text and table when toggled off", async () => {
    mount();
    await screen.findByRole("table", { name: /Resource nodes in view/ });
    fireEvent.click(screen.getByRole("checkbox", { name: "Resource nodes" }));
    expect(ids()).toEqual(["rails", "buildings", "mapMarkers", "trains"]);
    expect(screen.queryByRole("table", { name: /Resource nodes in view/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/resource nodes on the map/)).not.toBeInTheDocument();
    expect(screen.queryByText("In use (filled)")).not.toBeInTheDocument();
  });

  it("asks for a world layer only while its toggle is on", async () => {
    const asked = vi.fn();
    server.use(
      http.get(nodesRoute, () => {
        asked();
        return HttpResponse.json(resourceNodesWorldResponse);
      }),
    );
    mount();
    fireEvent.click(screen.getByRole("checkbox", { name: "Resource nodes" })); // off before it answers
    await screen.findByRole("table", { name: /Rail segments in view/ });
    const whileOff = asked.mock.calls.length;
    fireEvent.click(screen.getByRole("checkbox", { name: "Resource nodes" })); // on again: read again
    await screen.findByRole("table", { name: /Resource nodes in view/ });
    expect(whileOff).toBeLessThanOrEqual(1);
    expect(asked.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("says when a world layer has nothing in it", async () => {
    server.use(http.get(railsRoute, () => HttpResponse.json(railsWorldResponseEmpty)));
    mount();
    expect(await screen.findByText("No rails built yet.")).toBeInTheDocument();
  });

  it("says when the server cut a layer to its limit", async () => {
    server.use(http.get(railsRoute, () => HttpResponse.json(railsWorldResponseTruncated)));
    mount();
    expect(await screen.findByText(/Showing part of the rails: the server cut this layer to its size limit/)).toBeInTheDocument();
  });

  it("shows a failed layer as an error with Retry, and keeps the rest of the map", async () => {
    let failing = true;
    server.use(
      http.get(railsRoute, () =>
        failing ? HttpResponse.json(errorUpstreamUnreachable, { status: 502 }) : HttpResponse.json(railsWorldResponse),
      ),
    );
    mount();
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(await screen.findByText(/^7 resource nodes on the map/)).toBeInTheDocument();
    failing = false;
    fireEvent.click(retry);
    expect(await screen.findByText(/^1 rail segment on the map/)).toBeInTheDocument();
  });

  it("refuses a response for the wrong layer as a contract error", async () => {
    server.use(http.get(railsRoute, () => HttpResponse.json(resourceNodesWorldResponse)));
    mount();
    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("MapPanel world tables (hunt)", () => {
  it("captions each legend row with its layer", async () => {
    mount();
    await screen.findByText("Rail segment");
    for (const label of ["Rails", "Resource nodes", "Buildings"]) {
      // The toggle and the caption both carry the name; the caption is a paragraph.
      expect(screen.getAllByText(label, { selector: "p" }), label).toHaveLength(1);
    }
  });

  it("shows no legend row for a layer that is off, empty or failed", async () => {
    server.use(
      http.get(railsRoute, () => HttpResponse.json(railsWorldResponseEmpty)),
      http.get(nodesRoute, () => HttpResponse.json(errorUpstreamUnreachable, { status: 502 })),
    );
    mount();
    await screen.findByRole("button", { name: "Retry" });
    expect(screen.queryByText("Rail segment")).not.toBeInTheDocument();
    expect(screen.queryByText("In use (filled)")).not.toBeInTheDocument();
    expect(screen.getAllByText("Buildings", { selector: "p" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("checkbox", { name: "Buildings" }));
    expect(screen.queryAllByText("Buildings", { selector: "p" })).toHaveLength(0);
  });

  it("explains a failure of both layers in one box, with one Retry and a small request ID", async () => {
    const body = { error: { ...errorUpstreamUnreachable.error, requestId: "req-42" } };
    server.use(
      http.get(railsRoute, () => HttpResponse.json(body, { status: 502 })),
      http.get(nodesRoute, () => HttpResponse.json(body, { status: 502 })),
    );
    mount();
    const box = await screen.findByRole("alert");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(box).toHaveTextContent("Rails and resource nodes couldn't load: game server unreachable.");
    expect(within(box).getAllByRole("button")).toHaveLength(1);
    expect(box).toHaveTextContent("Request ID: req-42");
  });

  it("names each layer's own reason when they differ", async () => {
    server.use(
      http.get(railsRoute, () => HttpResponse.json(errorUpstreamUnreachable, { status: 502 })),
      http.get(nodesRoute, () => HttpResponse.json(resourceNodesWorldResponse)),
    );
    mount();
    expect(await screen.findByText("Rails couldn't load: game server unreachable.")).toBeInTheDocument();
    expect(await screen.findByText(/^7 resource nodes on the map/)).toBeInTheDocument();
  });

  it("says 'None on the map.' for an empty layer's table, and says 'shown' when cut", async () => {
    server.use(http.get(nodesRoute, () => HttpResponse.json({ ...resourceNodesWorldResponse, count: 0, data: [] })));
    mount();
    expect(await screen.findByText("No resource nodes reported by the server.")).toBeInTheDocument();
    expect(await screen.findByText("None on the map.")).toBeInTheDocument();
  });

  it("labels each table cell with its column, for the stacked phone layout", async () => {
    mount();
    const table = await screen.findByRole("table", { name: /Resource nodes in view/ });
    const cells = within(table).getAllByRole("cell").slice(0, 5);
    expect(cells.map((c) => c.getAttribute("data-label"))).toEqual(["Resource", "Purity", "Kind", "State", "Position (m)"]);
    const buildingsTable = await screen.findByRole("table", { name: /Buildings in view/ });
    expect(within(buildingsTable).getAllByRole("cell").slice(0, 3).map((c) => c.getAttribute("data-label"))).toEqual([
      "Building",
      "Recipe",
      "State",
    ]);
  });

  it("does not warn about duplicate keys when two rail segments share an id", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const seg = railsWorldResponse.data[0];
    server.use(
      http.get(railsRoute, () => HttpResponse.json({ ...railsWorldResponse, count: 2, data: [seg, seg] })),
    );
    mount();
    await screen.findByRole("table", { name: /Rail segments in view \(2\)/ });
    expect(spy.mock.calls.flat().join(" ")).not.toMatch(/same key/);
    spy.mockRestore();
  });
});

describe("MapPanel map markers (#330)", () => {
  it("says what the layer holds, captions its legend and lists the markers in view by name, kind and place", async () => {
    canvas.view = null;
    mount();
    expect(await screen.findByText("1 marker and 3 stamps on the map.")).toBeInTheDocument();
    expect(screen.getAllByText("Markers", { selector: "p" })).toHaveLength(1);
    const table = await screen.findByRole("table", { name: /Markers in view \(4\)/ });
    const first = mapMarkersWorldResponse.data[3];
    const row = within(table).getByText(first.name).closest("tr")!;
    expect(within(row).getAllByRole("cell").map((c) => [c.getAttribute("data-label"), c.textContent])).toEqual([
      ["Name", first.name],
      ["Kind", "Marker"],
      ["Position (m)", "x 610, y -638"],
    ]);
  });

  it("follows the view in its table", async () => {
    const m = mapMarkersWorldResponse.data[3];
    canvas.view = { minX: m.x - 1, maxX: m.x + 1, minY: m.y - 1, maxY: m.y + 1 };
    mount();
    const table = await screen.findByRole("table", { name: /Markers in view \(1\)/ });
    expect(within(table).getByText(m.name)).toBeInTheDocument();
    canvas.view = null;
  });

  it("names an unnamed one by its kind in the table", async () => {
    const [stamp] = mapMarkersWorldResponse.data;
    server.use(http.get(markersRoute, () => HttpResponse.json({ ...mapMarkersWorldResponse, count: 1, data: [{ ...stamp, name: "" }] })));
    mount();
    const table = await screen.findByRole("table", { name: /Markers in view \(1\)/ });
    expect(within(table).getByText("Unnamed stamp")).toBeInTheDocument();
  });

  it("drops the layer, its legend, text and table when toggled off, and asks for it no more", async () => {
    const asked = vi.fn();
    server.use(
      http.get(markersRoute, () => {
        asked();
        return HttpResponse.json(mapMarkersWorldResponse);
      }),
    );
    mount();
    await screen.findByRole("table", { name: /Markers in view/ });
    fireEvent.click(screen.getByRole("checkbox", { name: "Markers" }));
    expect(ids()).not.toContain("mapMarkers");
    expect(screen.queryByRole("table", { name: /Markers in view/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/stamps on the map/)).not.toBeInTheDocument();
    expect(screen.queryByText("Marker (pin)")).not.toBeInTheDocument();
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it("says when no markers are placed yet, with no legend row", async () => {
    server.use(http.get(markersRoute, () => HttpResponse.json(mapMarkersWorldResponseEmpty)));
    mount();
    expect(await screen.findByText("No map markers or stamps placed yet.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Markers in view (0)" })).toBeInTheDocument();
    expect(screen.queryByText("Marker (pin)")).not.toBeInTheDocument();
  });

  it("says when the server cut the layer to its limit", async () => {
    server.use(http.get(markersRoute, () => HttpResponse.json(mapMarkersWorldResponseTruncated)));
    mount();
    expect(await screen.findByText(/Showing part of the markers: the server cut this layer to its size limit/)).toBeInTheDocument();
  });

  it("shows a failed read as an error with Retry, and keeps the rest of the map", async () => {
    let failing = true;
    server.use(
      http.get(markersRoute, () =>
        failing ? HttpResponse.json(errorUpstreamUnreachable, { status: 502 }) : HttpResponse.json(mapMarkersWorldResponse),
      ),
    );
    mount();
    expect(await screen.findByText("Markers couldn't load: game server unreachable.")).toBeInTheDocument();
    expect(await screen.findByText(/^1 rail segment on the map/)).toBeInTheDocument();
    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("1 marker and 3 stamps on the map.")).toBeInTheDocument();
  });

  it("refuses another layer's response as a contract error", async () => {
    server.use(http.get(markersRoute, () => HttpResponse.json(railsWorldResponse)));
    mount();
    expect(await screen.findByText(/Markers couldn't load/)).toBeInTheDocument();
  });

  it("does not warn about duplicate keys when two markers share an id, or repeat outright", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const m = mapMarkersWorldResponse.data[0];
    server.use(
      http.get(markersRoute, () => HttpResponse.json({ ...mapMarkersWorldResponse, count: 3, data: [m, { ...m, x: m.x + 5 }, m] })),
    );
    mount();
    await screen.findByRole("table", { name: /Markers in view \(3\)/ });
    expect(spy.mock.calls.flat().join(" ")).not.toMatch(/same key/);
    spy.mockRestore();
  });
});

describe("MapPanel live trains (ADR-0038 M6)", () => {
  afterEach(() => {
    canvas.view = null;
  });

  it("draws the trains layer on top once the live reading arrives, and says what it holds", async () => {
    canvas.view = null;
    mount();
    expect(await screen.findByText("1 train and 2 stations on the map.")).toBeInTheDocument();
    expect(ids().at(-1)).toBe("trains");
    const trains = await screen.findByRole("table", { name: /Trains in view \(1\)/ });
    expect(within(trains).getByText("Self-Driving")).toBeInTheDocument();
    expect(within(trains).getByText(mapLiveResponse.data.trains[0].name)).toBeInTheDocument();
    const stations = await screen.findByRole("table", { name: /Train stations in view \(2\)/ });
    expect(within(stations).getAllByRole("row")).toHaveLength(1 + mapLiveResponse.data.stations.length);
  });

  it("follows the view in the trains tables", async () => {
    const station = mapLiveResponse.data.stations[0];
    canvas.view = { minX: station.x - 1, maxX: station.x + 1, minY: station.y - 1, maxY: station.y + 1 };
    mount();
    await screen.findByRole("table", { name: /Train stations in view \(1\)/ });
    expect(screen.getByRole("heading", { name: "Trains in view (0)" })).toBeInTheDocument();
  });

  it("changes the trains layer, and no other, when a refetch brings new positions", async () => {
    const { client } = mount();
    await waitFor(() => expect(ids()).toContain("trains"));
    const before = Object.fromEntries(canvas.layers.map((l) => [l.id, l.draw]));
    // A refetch of the same reading changes nothing (structural sharing keeps the data): nothing redraws.
    await client.refetchQueries({ queryKey: ["servers", "default", "map", "live"] });
    expect(canvas.layers.find((l) => l.id === "trains")!.draw).toBe(before.trains);
    server.use(
      http.get(liveRoute, () =>
        HttpResponse.json({ ...mapLiveResponse, data: { ...mapLiveResponse.data, trains: [{ ...mapLiveResponse.data.trains[0], x: -900 }] } }),
      ),
    );
    await client.refetchQueries({ queryKey: ["servers", "default", "map", "live"] });
    await waitFor(() => expect(canvas.layers.find((l) => l.id === "trains")!.draw).not.toBe(before.trains));
    for (const id of ["rails", "resourceNodes", "buildings"]) {
      expect(canvas.layers.find((l) => l.id === id)!.draw, id).toBe(before[id]);
    }
  });

  it("drops the layer, its legend, text and tables when toggled off", async () => {
    mount();
    await screen.findByRole("table", { name: /Trains in view/ });
    fireEvent.click(screen.getByRole("checkbox", { name: "Trains" }));
    expect(ids()).toEqual(["rails", "resourceNodes", "buildings", "mapMarkers"]);
    expect(screen.queryByRole("table", { name: /Trains in view/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: /Train stations in view/ })).not.toBeInTheDocument();
    expect(screen.queryByText("1 train and 2 stations on the map.")).not.toBeInTheDocument();
  });

  it("asks for the live reading only while the Trains toggle is on", async () => {
    const asked = vi.fn();
    server.use(
      http.get(liveRoute, () => {
        asked();
        return HttpResponse.json(mapLiveResponse);
      }),
    );
    mount();
    fireEvent.click(screen.getByRole("checkbox", { name: "Trains" }));
    await screen.findByRole("table", { name: /Rail segments in view/ });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(asked.mock.calls.length).toBeLessThanOrEqual(1);
    const whileOff = asked.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(asked.mock.calls.length).toBe(whileOff);
  });

  it("says so when there are no trains or stations yet, and has no legend row", async () => {
    server.use(http.get(liveRoute, () => HttpResponse.json(mapLiveResponseEmpty)));
    mount();
    expect(await screen.findByText("No trains or stations built yet.")).toBeInTheDocument();
    expect(screen.queryByText("Station")).not.toBeInTheDocument();
  });

  it("says the positions are the last known ones when the backend flags the reading stale", async () => {
    server.use(http.get(liveRoute, () => HttpResponse.json(mapLiveResponseStale)));
    mount();
    expect(await screen.findByText(/last known train positions/)).toBeInTheDocument();
  });

  it("shows a failed live read as an error with Retry, and keeps the rest of the map", async () => {
    let failing = true;
    server.use(
      http.get(liveRoute, () => (failing ? HttpResponse.json(errorUpstreamUnreachable, { status: 502 }) : HttpResponse.json(mapLiveResponse))),
    );
    mount();
    expect(await screen.findByText(/Trains couldn't load/)).toBeInTheDocument();
    expect(await screen.findByText(/^1 rail segment on the map/)).toBeInTheDocument();
    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("1 train and 2 stations on the map.")).toBeInTheDocument();
  });

  it("refuses a malformed live reading as a contract error", async () => {
    server.use(http.get(liveRoute, () => HttpResponse.json({ ...mapLiveResponse, data: { trains: [{ id: "t" }], stations: [] } })));
    mount();
    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
