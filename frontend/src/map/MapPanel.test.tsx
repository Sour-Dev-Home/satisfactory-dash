import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  errorUpstreamUnreachable,
  factoryMixed,
  factoryOldBackend,
  railsWorldResponse,
  railsWorldResponseEmpty,
  railsWorldResponseTruncated,
  resourceNodesWorldResponse,
} from "@satisfactory-dash/shared/fixtures";
import { endpoints, type FactoryResponse } from "@satisfactory-dash/shared";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
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
const nodesRoute = endpoints.map.worldLayer.route.replace(":layer", "resourceNodes");
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
  it("draws rails, then resource nodes, then buildings, once the world data arrives", async () => {
    mount();
    await waitFor(() => expect(ids()).toEqual(["rails", "resourceNodes", "buildings"]));
  });

  it("describes both layers in text and lists them in view", async () => {
    canvas.view = null;
    mount();
    expect(await screen.findByText(/^1 rail segments on the map/)).toBeInTheDocument();
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
    expect(ids()).toEqual(["rails", "buildings"]);
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
    expect(await screen.findByText(/The server cut this layer to its size limit/)).toBeInTheDocument();
  });

  it("shows a failed layer as an error with Retry, and keeps the rest of the map", async () => {
    let failing = true;
    server.use(
      http.get(railsRoute, () =>
        failing ? HttpResponse.json(errorUpstreamUnreachable, { status: 502 }) : HttpResponse.json(railsWorldResponse),
      ),
    );
    mount();
    const retry = await screen.findByRole("button", { name: "Retry rails" });
    expect(await screen.findByText(/^7 resource nodes on the map/)).toBeInTheDocument();
    failing = false;
    fireEvent.click(retry);
    expect(await screen.findByText(/^1 rail segments on the map/)).toBeInTheDocument();
  });

  it("refuses a response for the wrong layer as a contract error", async () => {
    server.use(http.get(railsRoute, () => HttpResponse.json(resourceNodesWorldResponse)));
    mount();
    expect(await screen.findByRole("button", { name: "Retry rails" })).toBeInTheDocument();
  });
});
