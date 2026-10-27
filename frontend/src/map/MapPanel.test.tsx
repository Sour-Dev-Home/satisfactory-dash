import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  conveyorsWorldResponse,
  conveyorsWorldResponseEmpty,
  droneRoutesWorldResponse,
  errorUpstreamUnreachable,
  factoryMixed,
  factoryOldBackend,
  mapMarkersWorldResponse,
  powerLinesWorldResponse,
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
import { powerLinesWorldResponseEmpty, powerLinesWorldResponseTruncated } from "../test/powerLinesResponses";
import { droneRoutesWorldResponseAmbiguous, droneRoutesWorldResponseEmpty, droneRoutesWorldResponseTruncated } from "../test/droneRoutesResponses";
import { conveyorsWorldResponseTruncated } from "../test/conveyorsResponses";
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
const powerLinesRoute = endpoints.map.worldLayer.route.replace(":layer", "powerLines");
const dronesRoute = endpoints.map.worldLayer.route.replace(":layer", "droneRoutes");
const conveyorsRoute = endpoints.map.worldLayer.route.replace(":layer", "conveyors");
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
  it("draws rails, then resource nodes, then buildings, then drone ports, then markers, once the world data arrives", async () => {
    mount();
    await waitFor(() => expect(ids()).toEqual(["rails", "resourceNodes", "buildings", "droneRoutes", "mapMarkers", "trains"]));
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
    expect(ids()).toEqual(["rails", "buildings", "droneRoutes", "mapMarkers", "trains"]);
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

describe("MapPanel drone ports (#330)", () => {
  it("is on by default and draws over the buildings, under the markers and trains", async () => {
    mount();
    expect(screen.getByRole("checkbox", { name: "Drone ports" })).toBeChecked();
    await waitFor(() => expect(ids()).toEqual(["rails", "resourceNodes", "buildings", "droneRoutes", "mapMarkers", "trains"]));
  });

  it("says how many ports and routes, captions its legend, and lists the ports in view", async () => {
    canvas.view = null;
    mount();
    expect(await screen.findByText("3 drone ports, 1 route on the map.")).toBeInTheDocument();
    expect(screen.getAllByText("Drone ports", { selector: "p" })).toHaveLength(1);
    expect(screen.getByText("Drone route")).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: /Drone ports in view \(3\)/ });
    const row = within(table).getAllByRole("row")[1];
    expect(within(row).getAllByRole("cell").map((c) => [c.getAttribute("data-label"), c.textContent])).toEqual([
      ["Port", "FUEL 5"],
      ["Paired with", "TestLand1"],
      ["Sends", "Battery"],
      ["Position (m)", "x -2,204, y 503"],
    ]);
  });

  it("follows the view in its table", async () => {
    const p = droneRoutesWorldResponse.data[1];
    canvas.view = { minX: p.x - 1, maxX: p.x + 1, minY: p.y - 1, maxY: p.y + 1 };
    mount();
    const table = await screen.findByRole("table", { name: /Drone ports in view \(1\)/ });
    expect(within(table).getByText(p.name)).toBeInTheDocument();
    canvas.view = null;
  });

  it("counts a pairing that names two ports, and draws no route for it", async () => {
    server.use(http.get(dronesRoute, () => HttpResponse.json(droneRoutesWorldResponseAmbiguous)));
    mount();
    expect(await screen.findByText("3 drone ports, 1 route on the map. 1 pairing couldn't be matched to one port.")).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: /Drone ports in view/ });
    expect(within(table).getByText("TestLand1 (not matched to one port)")).toBeInTheDocument();
  });

  it("drops the layer, its legend, text and table when toggled off, and asks for it no more", async () => {
    const asked = vi.fn();
    server.use(
      http.get(dronesRoute, () => {
        asked();
        return HttpResponse.json(droneRoutesWorldResponse);
      }),
    );
    mount();
    await screen.findByRole("table", { name: /Drone ports in view/ });
    fireEvent.click(screen.getByRole("checkbox", { name: "Drone ports" }));
    expect(ids()).not.toContain("droneRoutes");
    expect(screen.queryByRole("table", { name: /Drone ports in view/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/drone ports, \d+ routes? on the map/)).not.toBeInTheDocument();
    expect(screen.queryByText("Drone route")).not.toBeInTheDocument();
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it("says when no ports are built yet, with no legend row", async () => {
    server.use(http.get(dronesRoute, () => HttpResponse.json(droneRoutesWorldResponseEmpty)));
    mount();
    expect(await screen.findByText("No drone ports built yet.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Drone ports in view (0)" })).toBeInTheDocument();
    expect(screen.queryByText("Drone route")).not.toBeInTheDocument();
  });

  it("says when the server cut the layer to its limit", async () => {
    server.use(http.get(dronesRoute, () => HttpResponse.json(droneRoutesWorldResponseTruncated)));
    mount();
    expect(await screen.findByText(/Showing part of the drone ports: the server cut this layer to its size limit/)).toBeInTheDocument();
  });

  it("shows a failed read as an error with Retry, and keeps the rest of the map", async () => {
    let failing = true;
    server.use(
      http.get(dronesRoute, () =>
        failing ? HttpResponse.json(errorUpstreamUnreachable, { status: 502 }) : HttpResponse.json(droneRoutesWorldResponse),
      ),
    );
    mount();
    expect(await screen.findByText("Drone ports couldn't load: game server unreachable.")).toBeInTheDocument();
    expect(await screen.findByText(/^1 rail segment on the map/)).toBeInTheDocument();
    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("3 drone ports, 1 route on the map.")).toBeInTheDocument();
  });

  it("refuses another layer's response as a contract error", async () => {
    server.use(http.get(dronesRoute, () => HttpResponse.json(railsWorldResponse)));
    mount();
    expect(await screen.findByText(/Drone ports couldn't load/)).toBeInTheDocument();
  });

  it("does not redraw the ports when a factory poll brings the same items", async () => {
    const { rerender, client } = mount();
    await waitFor(() => expect(ids()).toContain("droneRoutes"));
    const before = canvas.layers.find((l) => l.id === "droneRoutes")!.draw;
    rerender(
      <QueryClientProvider client={client}>
        <MapPanel snapshot={structuredClone(factoryMixed)} serverId="default" />
      </QueryClientProvider>,
    );
    expect(canvas.layers.find((l) => l.id === "droneRoutes")!.draw).toBe(before);
  });
});

describe("MapPanel power lines (#330)", () => {
  const turnOn = () => fireEvent.click(screen.getByRole("checkbox", { name: "Power lines" }));

  it("starts off: unchecked, not drawn, and never asked for", async () => {
    const asked = vi.fn();
    server.use(
      http.get(powerLinesRoute, () => {
        asked();
        return HttpResponse.json(powerLinesWorldResponse);
      }),
    );
    mount();
    await waitFor(() => expect(ids()).toContain("trains"));
    expect(screen.getByRole("checkbox", { name: "Power lines" })).not.toBeChecked();
    expect(ids()).not.toContain("powerLines");
    expect(screen.queryByText(/power lines? on the map/)).not.toBeInTheDocument();
    expect(asked).not.toHaveBeenCalled();
  });

  it("once on, draws above the resource nodes and under the buildings, markers and trains", async () => {
    mount();
    await screen.findByTestId("map-canvas");
    turnOn();
    await waitFor(() => expect(ids()).toEqual(["rails", "resourceNodes", "powerLines", "buildings", "droneRoutes", "mapMarkers", "trains"]));
  });

  it("says how many lines and how much wire, captions its legend, and lists the lines in view", async () => {
    canvas.view = null;
    mount();
    await screen.findByTestId("map-canvas");
    turnOn();
    expect(await screen.findByText("2 power lines on the map, 243 m of wire in all.")).toBeInTheDocument();
    expect(screen.getAllByText("Power lines", { selector: "p" })).toHaveLength(1);
    expect(screen.getByText("Power line")).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: /Power lines in view \(2\)/ });
    const [, long] = powerLinesWorldResponse.data;
    const row = within(table).getByText(long.id).closest("tr")!;
    expect(within(row).getAllByRole("cell").map((c) => [c.getAttribute("data-label"), c.textContent])).toEqual([
      ["Line", long.id],
      ["Length", "240 m"],
      ["From (m)", "x -520, y -1,463"],
      ["To (m)", "x -423, y -1,683"],
    ]);
  });

  it("follows the view in its table", async () => {
    const [short] = powerLinesWorldResponse.data;
    const [x, y] = short.points[0];
    canvas.view = { minX: x - 5, maxX: x + 5, minY: y - 5, maxY: y + 5 };
    mount();
    await screen.findByTestId("map-canvas");
    turnOn();
    const table = await screen.findByRole("table", { name: /Power lines in view \(1\)/ });
    expect(within(table).getByText(short.id)).toBeInTheDocument();
    canvas.view = null;
  });

  it("drops the layer, its legend, text and table when toggled off again, and asks for it no more", async () => {
    const asked = vi.fn();
    server.use(
      http.get(powerLinesRoute, () => {
        asked();
        return HttpResponse.json(powerLinesWorldResponse);
      }),
    );
    mount();
    await screen.findByTestId("map-canvas");
    turnOn();
    await screen.findByRole("table", { name: /Power lines in view/ });
    turnOn();
    expect(ids()).not.toContain("powerLines");
    expect(screen.queryByRole("table", { name: /Power lines in view/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/power lines on the map/)).not.toBeInTheDocument();
    expect(screen.queryByText("Power line")).not.toBeInTheDocument();
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it("says when no lines are built yet, with no legend row", async () => {
    server.use(http.get(powerLinesRoute, () => HttpResponse.json(powerLinesWorldResponseEmpty)));
    mount();
    await screen.findByTestId("map-canvas");
    turnOn();
    expect(await screen.findByText("No power lines built yet.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Power lines in view (0)" })).toBeInTheDocument();
    expect(screen.queryByText("Power line")).not.toBeInTheDocument();
  });

  it("says when the server cut the layer to its limit", async () => {
    server.use(http.get(powerLinesRoute, () => HttpResponse.json(powerLinesWorldResponseTruncated)));
    mount();
    await screen.findByTestId("map-canvas");
    turnOn();
    expect(await screen.findByText("2 power lines on the map, 243 m of wire shown.")).toBeInTheDocument();
    expect(screen.getByText(/Showing part of the power lines: the server cut this layer to its size limit/)).toBeInTheDocument();
  });

  it("shows a failed read as an error with Retry, and keeps the rest of the map", async () => {
    let failing = true;
    server.use(
      http.get(powerLinesRoute, () =>
        failing ? HttpResponse.json(errorUpstreamUnreachable, { status: 502 }) : HttpResponse.json(powerLinesWorldResponse),
      ),
    );
    mount();
    await screen.findByTestId("map-canvas");
    turnOn();
    expect(await screen.findByText("Power lines couldn't load: game server unreachable.")).toBeInTheDocument();
    expect(await screen.findByText(/^1 rail segment on the map/)).toBeInTheDocument();
    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("2 power lines on the map, 243 m of wire in all.")).toBeInTheDocument();
  });

  it("does not warn about duplicate keys when two lines share an id, or repeat outright", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const [line] = powerLinesWorldResponse.data;
    const moved = { ...line, points: [[0, 0], [10, 0]] as [[number, number], [number, number]] };
    server.use(http.get(powerLinesRoute, () => HttpResponse.json({ ...powerLinesWorldResponse, count: 3, data: [line, moved, line] })));
    mount();
    await screen.findByTestId("map-canvas");
    turnOn();
    await screen.findByRole("table", { name: /Power lines in view \(3\)/ });
    expect(spy.mock.calls.flat().join(" ")).not.toMatch(/same key/);
    spy.mockRestore();
  });
});

describe("MapPanel belts and pipes (#330)", () => {
  const toggle = () => screen.getByRole("checkbox", { name: "Belts and pipes" });
  const turnOn = () => fireEvent.click(toggle());
  const SAMPLE_TEXT =
    "7 belts, 2 pipes, 2 lifts on the map, 30 m of belt measured, pipe length unknown, drawn straight between their ends. 7 belts and pipes with an end the map can't place are drawn as a dot.";

  it("starts off: unchecked, not drawn, and never asked for", async () => {
    const asked = vi.fn();
    server.use(
      http.get(conveyorsRoute, () => {
        asked();
        return HttpResponse.json(conveyorsWorldResponse);
      }),
    );
    mount();
    await waitFor(() => expect(ids()).toContain("trains"));
    expect(toggle()).not.toBeChecked();
    expect(ids()).not.toContain("conveyors");
    expect(asked).not.toHaveBeenCalled();
  });

  it("once on, draws just above the power lines and under the buildings", async () => {
    mount();
    await screen.findByTestId("map-canvas");
    turnOn();
    fireEvent.click(screen.getByRole("checkbox", { name: "Power lines" }));
    await waitFor(() =>
      expect(ids()).toEqual(["rails", "resourceNodes", "powerLines", "conveyors", "buildings", "droneRoutes", "mapMarkers", "trains"]),
    );
  });

  it("says what is on the map, captions its legend, and lists them in view", async () => {
    canvas.view = null;
    mount();
    await screen.findByTestId("map-canvas");
    turnOn();
    expect(await screen.findByText(SAMPLE_TEXT)).toBeInTheDocument();
    expect(screen.getAllByText("Belts and pipes", { selector: "p" })).toHaveLength(1);
    expect(screen.getByText("Belt or pipe, far end not placed")).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: /Belts, lifts and pipes in view \(11\)/ });
    // The miner's belt ends at the splitter, placed by the belt that leaves it; the splitter has no name in the factory.
    const row = within(table).getAllByRole("row")[5];
    expect(within(row).getAllByRole("cell").map((c) => c.textContent)).toEqual(["Belt", "Conveyor Belt Mk.1", "8 m", "Extractor", "Splitter"]);
  });

  it("places an end at the building the factory placed under its id, and names it", async () => {
    const [target] = buildings;
    const edge = { ...conveyorsWorldResponse.data[0], to: target.id, toKind: "machine" as const, at: { x: target.location!.xM, y: target.location!.yM + 40 } };
    server.use(http.get(conveyorsRoute, () => HttpResponse.json({ ...conveyorsWorldResponse, count: 1, data: [edge] })));
    canvas.view = null;
    mount();
    await screen.findByTestId("map-canvas");
    turnOn();
    expect(await screen.findByText(/^1 belt, 0 pipes, 0 lifts on the map, 40 m of belt measured, drawn straight/)).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: /Belts, lifts and pipes in view \(1\)/ });
    expect(within(table).getByText(target.name)).toBeInTheDocument();
  });

  it("drops the layer, its legend, text and table when toggled off again", async () => {
    mount();
    await screen.findByTestId("map-canvas");
    turnOn();
    await screen.findByRole("table", { name: /Belts, lifts and pipes in view/ });
    turnOn();
    expect(ids()).not.toContain("conveyors");
    expect(screen.queryByRole("table", { name: /Belts, lifts and pipes in view/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/belts?, \d+ pipes?, \d+ lifts? on the map/)).not.toBeInTheDocument();
    expect(screen.queryByText("Belt or pipe, far end not placed")).not.toBeInTheDocument();
  });

  it("says when none are reported yet, with no legend row", async () => {
    server.use(http.get(conveyorsRoute, () => HttpResponse.json(conveyorsWorldResponseEmpty)));
    mount();
    await screen.findByTestId("map-canvas");
    turnOn();
    expect(await screen.findByText("No belts, lifts or pipes reported yet.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Belts, lifts and pipes in view (0)" })).toBeInTheDocument();
    expect(screen.queryByText("Belt or pipe, far end not placed")).not.toBeInTheDocument();
  });

  it("says when the server cut the layer to its limit", async () => {
    server.use(http.get(conveyorsRoute, () => HttpResponse.json(conveyorsWorldResponseTruncated)));
    mount();
    await screen.findByTestId("map-canvas");
    turnOn();
    expect(await screen.findByText(/30 m of belt shown, pipe length unknown,/)).toBeInTheDocument();
    expect(screen.getByText(/Showing part of the belts and pipes: the server cut this layer to its size limit/)).toBeInTheDocument();
  });

  it("shows a failed read as an error with Retry, and keeps the rest of the map", async () => {
    let failing = true;
    server.use(
      http.get(conveyorsRoute, () =>
        failing ? HttpResponse.json(errorUpstreamUnreachable, { status: 502 }) : HttpResponse.json(conveyorsWorldResponse),
      ),
    );
    mount();
    await screen.findByTestId("map-canvas");
    turnOn();
    expect(await screen.findByText("Belts and pipes couldn't load: game server unreachable.")).toBeInTheDocument();
    expect(await screen.findByText(/^1 rail segment on the map/)).toBeInTheDocument();
    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(SAMPLE_TEXT)).toBeInTheDocument();
  });

  it("does not redraw the conveyors when a factory poll keeps every building where it was", async () => {
    const { rerender, client } = mount();
    await screen.findByTestId("map-canvas");
    turnOn();
    await waitFor(() => expect(ids()).toContain("conveyors"));
    const before = canvas.layers.find((l) => l.id === "conveyors")!.draw;
    rerender(
      <QueryClientProvider client={client}>
        <MapPanel snapshot={structuredClone(factoryMixed)} serverId="default" />
      </QueryClientProvider>,
    );
    expect(canvas.layers.find((l) => l.id === "conveyors")!.draw).toBe(before);
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
    expect(ids()).toEqual(["rails", "resourceNodes", "buildings", "droneRoutes", "mapMarkers"]);
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
