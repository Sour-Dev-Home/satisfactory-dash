import { droneRoutesWorldResponse } from "@satisfactory-dash/shared/fixtures";
import type { DronePort } from "@satisfactory-dash/shared";
import { render, screen } from "@testing-library/react";
import * as L from "leaflet";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MapContext } from "./layers";
import { GRID_BASE_MAP, project } from "./projection";
import { DRONE_PORT_HALF_PX, DRONE_ROUTE_WEIGHT_PX, dronePortsLayer, drawDronePorts } from "./dronePortsLayer";
import { DRONE_PORT_ROWS_MAX, DronePortsTable } from "./WorldTables";

// Leaflet runs for real (as in worldLayers.test.tsx); only the 2D context is a no-op (jsdom has none).
const originalGetContext = HTMLCanvasElement.prototype.getContext;
let map: L.Map;
let ctx: MapContext;

beforeEach(() => {
  const noop = new Proxy({}, { get: (_t, prop) => (prop === "canvas" || prop === "then" ? undefined : () => {}) });
  // @ts-expect-error -- test-only stub, not a real CanvasRenderingContext2D
  HTMLCanvasElement.prototype.getContext = () => noop;
  const host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { value: 400 });
  Object.defineProperty(host, "clientHeight", { value: 300 });
  document.body.append(host);
  const renderer = L.canvas();
  map = L.map(host, { crs: L.CRS.Simple, renderer, zoom: 0, center: [0, 0] });
  const colors = new Map([
    ["--color-map-drone", "DRONE"],
    ["--color-canvas", "DARK"],
  ]);
  ctx = {
    L,
    map,
    renderer,
    color: (t) => colors.get(t) ?? "UNKNOWN",
    token: () => "",
    project: (x, y) => project(GRID_BASE_MAP, x, y),
  };
});

afterEach(() => {
  map.remove();
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

const paths = () => {
  const found: L.Path[] = [];
  map.eachLayer((l) => {
    if (l instanceof L.Path) found.push(l);
  });
  return found;
};
const polygons = () => paths().filter((p): p is L.Polygon => p instanceof L.Polygon);
const routeLines = () => paths().filter((p): p is L.Polyline => p instanceof L.Polyline && !(p instanceof L.Polygon));
const tooltipText = (layer: L.Layer) => ((layer.getTooltip()!.getContent() as () => HTMLElement)() as HTMLElement).textContent;

const port = (over: Partial<DronePort> & Pick<DronePort, "id" | "name">): DronePort => ({
  paired: null,
  input: [],
  output: [],
  fuel: [],
  x: 0,
  y: 0,
  ...over,
});

describe("dronePortsLayer", () => {
  it("is on by default", () => {
    expect(dronePortsLayer.defaultVisible).toBe(true);
    expect(dronePortsLayer.label).toBe("Drone ports");
  });

  it("draws each port as a square in the drone token and one dashed, non-interactive path for the routes", () => {
    const cleanup = dronePortsLayer.draw(ctx, droneRoutesWorldResponse.data);
    const squares = polygons();
    expect(squares).toHaveLength(3);
    for (const s of squares) {
      expect(s.options.fillColor).toBe("DRONE");
      expect((s.getLatLngs() as L.LatLng[][])[0]).toHaveLength(4);
    }
    // The square is centred on the port's place, DRONE_PORT_HALF_PX each way on screen.
    const [x, y] = [droneRoutesWorldResponse.data[0].x, droneRoutesWorldResponse.data[0].y];
    const centre = map.latLngToLayerPoint(project(GRID_BASE_MAP, x, y));
    const corners = (squares[0].getLatLngs() as L.LatLng[][])[0].map((c) => map.latLngToLayerPoint(c));
    expect(Math.max(...corners.map((c) => Math.abs(c.x - centre.x)))).toBeCloseTo(DRONE_PORT_HALF_PX, 5);

    const lines = routeLines();
    expect(lines).toHaveLength(1);
    const parts = lines[0].getLatLngs() as L.LatLng[][];
    expect(parts).toHaveLength(1);
    expect(lines[0].options.dashArray).toBeTruthy();
    expect(lines[0].options.color).toBe("DRONE");
    expect(lines[0].options.weight).toBe(DRONE_ROUTE_WEIGHT_PX);
    expect(lines[0].options.interactive).toBe(false);
    cleanup();
    expect(paths()).toHaveLength(0);
  });

  it("draws no route for an unmatched pairing", () => {
    dronePortsLayer.draw(ctx, [port({ id: "a", name: "A", paired: "Twin" }), port({ id: "b", name: "Twin" }), port({ id: "c", name: "Twin", x: 5 })]);
    expect(routeLines()).toHaveLength(0);
    expect(polygons()).toHaveLength(3);
  });

  it("draws nothing for an empty layer and stops following the zoom on cleanup", () => {
    const off = vi.spyOn(map, "off");
    dronePortsLayer.draw(ctx, [])();
    expect(paths()).toHaveLength(0);
    dronePortsLayer.draw(ctx, droneRoutesWorldResponse.data)();
    expect(off).toHaveBeenCalledWith("zoomend", expect.any(Function));
  });

  it("builds the tooltip from text nodes: the name, the pairing and the cargo by item name", () => {
    const ports = [
      port({ id: "a", name: "<img src=x onerror=alert(1)>", paired: "B", input: ["Desc_Battery_C"] }),
      port({ id: "b", name: "B", paired: "<img src=x onerror=alert(1)>" }),
    ];
    drawDronePorts(ctx, ports, (c) => (c === "Desc_Battery_C" ? "Battery" : c));
    const el = (polygons()[0].getTooltip()!.getContent() as () => HTMLElement)();
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector("strong")!.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(tooltipText(polygons()[0])).toBe("<img src=x onerror=alert(1)>Paired with BCarries: Battery");
    expect(tooltipText(polygons()[1])).toBe("BPaired with <img src=x onerror=alert(1)>Carries: Nothing");
  });

  it("names cargo from the class name when no factory name is known", () => {
    dronePortsLayer.draw(ctx, [port({ id: "a", name: "A", input: ["Desc_IronPlate_C"] })]);
    expect(tooltipText(polygons()[0])).toBe("ANot pairedCarries: Iron Plate");
  });

  it("describes the ports, the routes and the pairings it couldn't match", () => {
    expect(dronePortsLayer.describe([])).toBe("No drone ports built yet.");
    expect(dronePortsLayer.describe(droneRoutesWorldResponse.data)).toBe("3 drone ports, 1 route on the map.");
    expect(dronePortsLayer.describe([port({ id: "a", name: "A" })])).toBe("1 drone port, 0 routes on the map.");
    expect(
      dronePortsLayer.describe([port({ id: "a", name: "A", paired: "Gone" }), port({ id: "b", name: "B", paired: "Lost" })]),
    ).toBe("2 drone ports, 0 routes on the map. 2 pairings couldn't be matched to one port.");
    expect(dronePortsLayer.describe([port({ id: "a", name: "A", paired: "Gone" })])).toBe(
      "1 drone port, 0 routes on the map. 1 pairing couldn't be matched to one port.",
    );
  });

  it("has legend rows for a port and a route", () => {
    render(<>{dronePortsLayer.legend()}</>);
    expect(screen.getByText("Drone port")).toBeInTheDocument();
    expect(screen.getByText("Drone route")).toBeInTheDocument();
  });
});

describe("DronePortsTable", () => {
  const name = (c: string) => (c === "Desc_Battery_C" ? "Battery" : c);

  it("lists the ports in view with their partner, cargo and place", () => {
    render(<DronePortsTable ports={droneRoutesWorldResponse.data} view={null} itemName={name} />);
    expect(screen.getByRole("heading", { name: "Drone ports in view (3)" })).toBeInTheDocument();
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent("FUEL 5TestLand1Batteryx -2,204, y 503");
    expect(rows[3]).toHaveTextContent("FUEL 1Not pairedNothingx -2,204, y 599");
  });

  it("follows the view", () => {
    render(<DronePortsTable ports={droneRoutesWorldResponse.data} view={{ minX: -2150, maxX: -2100, minY: 500, maxY: 520 }} itemName={name} />);
    expect(screen.getByRole("heading", { name: "Drone ports in view (1)" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "TestLand1" })).toBeInTheDocument();
  });

  it("says when the layer is empty", () => {
    render(<DronePortsTable ports={[]} view={null} itemName={name} />);
    expect(screen.getByText("None on the map.")).toBeInTheDocument();
  });

  it("caps the rows, says so, and keys repeated ids without a warning", () => {
    const errors: unknown[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => errors.push(a);
    try {
      render(<DronePortsTable ports={Array.from({ length: 2_000 }, () => port({ id: "same", name: "P" }))} view={null} itemName={name} />);
    } finally {
      console.error = orig;
    }
    expect(errors).toEqual([]);
    expect(screen.getAllByRole("row")).toHaveLength(DRONE_PORT_ROWS_MAX + 1);
    expect(screen.getByText(`Showing the first ${DRONE_PORT_ROWS_MAX} of 2,000. Zoom in to list the rest.`)).toBeInTheDocument();
  });

  it("shows a hostile name as text", () => {
    render(<DronePortsTable ports={[port({ id: "a", name: "<img src=x onerror=alert(1)>" })]} view={null} itemName={name} />);
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});
