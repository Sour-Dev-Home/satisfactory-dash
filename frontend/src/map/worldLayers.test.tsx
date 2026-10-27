import { mapMarkersWorldResponse, powerLinesWorldResponse, railsWorldResponse, resourceNodesWorldResponse } from "@satisfactory-dash/shared/fixtures";
import { render, screen, within } from "@testing-library/react";
import * as L from "leaflet";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MapContext } from "./layers";
import { GRID_BASE_MAP, project } from "./projection";
import { railsLayer, RAIL_WEIGHT_PX } from "./railsLayer";
import type { MapMarker, RailSegment } from "@satisfactory-dash/shared";
import { isLightFill, MARKER_EDGE_PX, markerKeys, markersLayer, PIN_HEAD_OFFSET_PX, PIN_HEAD_RADIUS_PX, STAMP_RADIUS_PX } from "./markersLayer";
import { resourceNodesLayer } from "./resourceNodesLayer";
import { POWER_LINE_WEIGHT_PX, powerLinesLayer } from "./powerLinesLayer";
import { nodeRadiusPx } from "./worldGeometry";

// Leaflet runs for real here; only the 2D context is a no-op (jsdom has none). The tests read the
// layers Leaflet holds (their points, options and tooltip content), not pixels: e2e covers the pixels.
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
    ["--color-rail", "RAIL"],
    ["--color-node", "NODE"],
    ["--color-marker-edge", "EDGE"],
    ["--color-canvas", "DARK"],
    ["--color-map-power-line", "WIRE"],
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

/** The layers on the map that are paths (the base map's grid is not drawn in these tests). */
const paths = <T extends L.Path>() => {
  const found: T[] = [];
  map.eachLayer((l) => {
    if (l instanceof L.Path) found.push(l as T);
  });
  return found;
};
const markersOnMap = () => {
  const found: L.Marker[] = [];
  map.eachLayer((l) => {
    if (l instanceof L.Marker) found.push(l);
  });
  return found;
};
const tooltipText = (layer: L.Layer) => ((layer.getTooltip()!.getContent() as () => HTMLElement)() as HTMLElement).textContent;

describe("railsLayer", () => {
  it("draws one polyline per segment, projected, in the rail token, and removes them on cleanup", () => {
    const cleanup = railsLayer.draw(ctx, railsWorldResponse.data);
    const lines = paths().filter((l): l is L.Polyline => l instanceof L.Polyline);
    expect(lines).toHaveLength(railsWorldResponse.data.length);
    const first = railsWorldResponse.data[0].points[0];
    const [lat, lng] = project(GRID_BASE_MAP, first[0], first[1]);
    expect(lines[0].getLatLngs()[0]).toMatchObject({ lat, lng });
    expect(lines[0].options.color).toBe("RAIL");
    cleanup();
    expect(paths()).toHaveLength(0);
  });

  it("strokes rails wide with round caps, and caps both ends of every segment, so a short one is visible", () => {
    railsLayer.draw(ctx, [{ id: "short", points: [[0, 0], [12, 0]] }]);
    const line = paths().find((l): l is L.Polyline => l instanceof L.Polyline)!;
    expect(line.options.weight).toBe(RAIL_WEIGHT_PX);
    expect(RAIL_WEIGHT_PX).toBeGreaterThanOrEqual(4);
    expect(line.options.lineCap).toBe("round");
    const caps = paths<L.CircleMarker>().filter((p) => !(p instanceof L.Polyline));
    expect(caps).toHaveLength(2);
    expect(caps.map((c) => c.getLatLng().lng).sort((a, b) => a - b)).toEqual([0, 12]);
  });

  it("says 'shown', not 'in all', when the layer was cut", () => {
    const segments = [{ id: "a", points: [[0, 0], [3, 4]] }] satisfies RailSegment[];
    expect(railsLayer.describe(segments, { truncated: true })).toBe("1 rail segment on the map, 5 m of track shown.");
  });

  it("draws nothing for an empty layer", () => {
    railsLayer.draw(ctx, [])();
    expect(paths()).toHaveLength(0);
  });

  it("builds the tooltip from text nodes, so a hostile id is never markup", () => {
    railsLayer.draw(ctx, [{ id: "<img src=x onerror=alert(1)>", points: [[0, 0], [3, 4]] }]);
    const line = paths()[0];
    expect(tooltipText(line)).toBe("Rail segment5 m");
  });

  it("describes the layer in text, with the total length", () => {
    expect(railsLayer.describe([])).toBe("No rails built yet.");
    expect(railsLayer.describe([{ id: "a", points: [[0, 0], [3, 4]] }, { id: "b", points: [[0, 0], [0, 10]] }])).toBe(
      "2 rail segments on the map, 15 m of track in all.",
    );
  });

  it("has a legend naming what is drawn", () => {
    render(<>{railsLayer.legend()}</>);
    expect(screen.getByText("Rail segment")).toBeInTheDocument();
  });
});

describe("resourceNodesLayer", () => {
  it("draws an icon marker per known resource at its projected point, ringed when in use, faded when free", () => {
    const nodes = resourceNodesWorldResponse.data;
    const cleanup = resourceNodesLayer.draw(ctx, nodes);
    const markers = markersOnMap();
    expect(markers).toHaveLength(nodes.length);
    expect(paths()).toHaveLength(0);
    nodes.forEach((n, i) => {
      const [lat, lng] = project(GRID_BASE_MAP, n.x, n.y);
      expect(markers[i].getLatLng()).toMatchObject({ lat, lng });
      const icon = markers[i].getIcon() as L.DivIcon;
      expect(icon.options.className).toContain(`node-icon-${n.purity}`);
      expect(icon.options.className).toContain(n.exploited ? "node-icon-used" : "node-icon-free");
      expect((icon.options.html as HTMLImageElement).getAttribute("src")).toMatch(/^\/game-assets\/resources\/.+\.webp$/);
    });
    cleanup();
    expect(markersOnMap()).toHaveLength(0);
  });

  it("falls back to the circle (sized by purity, filled only when in use) for a type with no icon", () => {
    const nodes = [
      { type: "Unobtainium", purity: "pure", nodeType: "node", x: 5, y: 7, exploited: true },
      { type: "Unobtainium", purity: "impure", nodeType: "node", x: 6, y: 8, exploited: false },
    ];
    const cleanup = resourceNodesLayer.draw(ctx, nodes);
    const circles = paths<L.CircleMarker>();
    expect(circles).toHaveLength(2);
    expect(markersOnMap()).toHaveLength(0);
    nodes.forEach((n, i) => {
      const [lat, lng] = project(GRID_BASE_MAP, n.x, n.y);
      expect(circles[i].getLatLng()).toMatchObject({ lat, lng });
      expect(circles[i].getRadius()).toBe(nodeRadiusPx(n.purity));
      expect(circles[i].options.fillOpacity).toBe(n.exploited ? 1 : 0);
      expect(circles[i].options.color).toBe("NODE");
    });
    cleanup();
    expect(paths()).toHaveLength(0);
  });

  it("builds an icon marker's tooltip from text nodes too", () => {
    resourceNodesLayer.draw(ctx, [{ type: "Iron Ore", purity: "pure", nodeType: "node", x: 1, y: 2, exploited: false }]);
    const content = (markersOnMap()[0].getTooltip()!.getContent() as () => HTMLElement)();
    expect(content.textContent).toContain("Iron Ore");
    expect(content.textContent).toContain("Free");
  });

  it("builds the tooltip from text nodes", () => {
    resourceNodesLayer.draw(ctx, [
      { type: "<b>Iron</b>", purity: "pure", nodeType: "node", x: 10, y: -20, exploited: true },
    ]);
    const text = tooltipText(paths()[0])!;
    expect(text).toContain("<b>Iron</b>");
    expect(text).toContain("Pure · Node");
    expect(text).toContain("In use");
    expect(text).toContain("x 10, y -20");
  });

  it("describes the layer in text: totals, in use and counts per resource", () => {
    expect(resourceNodesLayer.describe([])).toBe("No resource nodes reported by the server.");
    const text = resourceNodesLayer.describe(resourceNodesWorldResponse.data);
    expect(text).toBe(
      "7 resource nodes on the map (2 in use): 2 SAM, 1 Coal, 1 Crude Oil, 1 Iron Ore, 1 Limestone, 1 Nitrogen Gas.",
    );
  });

  it("has a legend for ring or fade (in use or free) and size (purity)", () => {
    render(<>{resourceNodesLayer.legend()}</>);
    const legend = screen.getAllByRole("list")[0];
    expect(within(legend).getByText("In use (ringed)")).toBeInTheDocument();
    expect(within(legend).getByText("Free (faded)")).toBeInTheDocument();
    expect(within(screen.getByText("Impure").closest("ul")!).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText(/Each resource has its own game icon; the type is also in the tooltip and the table/)).toBeInTheDocument();
  });
});

describe("count strings (hunt)", () => {
  it("uses the singular for one rail segment and one resource node", () => {
    expect(railsLayer.describe([{ id: "a", points: [[0, 0], [3, 4]] }])).toBe("1 rail segment on the map, 5 m of track in all.");
    const one = [{ type: "Iron Ore", purity: "pure", nodeType: "node", x: 0, y: 0, exploited: true }];
    expect(resourceNodesLayer.describe(one)).toBe("1 resource node on the map (1 in use): 1 Iron Ore.");
  });

  it("draws a hostile resource name and unknown purity without markup, and cleans up every shape", () => {
    const evil = "<img src=x onerror=alert(1)>";
    const cleanup = resourceNodesLayer.draw(ctx, [
      { type: evil, purity: "constructor", nodeType: "__proto__", x: 1_000_000, y: -1_000_000, exploited: false },
      { type: "B", purity: "toString", nodeType: "node", x: 0, y: 0, exploited: true },
    ]);
    const el = (paths()[0].getTooltip()!.getContent() as () => HTMLElement)();
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toContain(evil);
    expect(paths<L.CircleMarker>()[0].getRadius()).toBe(nodeRadiusPx("normal"));
    cleanup();
    expect(paths()).toHaveLength(0);
  });
});

describe("markersLayer (#330)", () => {
  const marker = (over: Partial<MapMarker> = {}): MapMarker => ({
    id: "m1",
    name: "Base",
    kind: "marker",
    icon: 349,
    color: "#6ea37b",
    x: 10,
    y: -20,
    ...over,
  });
  const polygons = () => paths().filter((p): p is L.Polygon => p instanceof L.Polygon);
  /** A polygon's corners in screen pixels, relative to the point it marks. */
  const offsetsFrom = (polygon: L.Polygon, m: MapMarker) => {
    const centre = map.latLngToLayerPoint(project(GRID_BASE_MAP, m.x, m.y));
    return (polygon.getLatLngs()[0] as L.LatLng[]).map((ll) => {
      const p = map.latLngToLayerPoint(ll);
      return [Math.round(p.x - centre.x), Math.round(p.y - centre.y)];
    });
  };

  it("tells a light fill from a dark one, so the rim can stay visible", () => {
    expect(["#ffffff", "#fbf8f2", "#f2e8a0"].map(isLightFill)).toEqual([true, true, true]);
    expect(["#6ea37b", "#1d1d1f", "#3470c2", "#d95926"].map(isLightFill)).toEqual([false, false, false, false]);
  });

  it("draws one shape per marker, in the player's colour with the token rim (dark on a light fill), and removes them on cleanup", () => {
    const markers = mapMarkersWorldResponse.data;
    const cleanup = markersLayer.draw(ctx, markers);
    const shapes = polygons();
    expect(shapes).toHaveLength(markers.length);
    // The capture's three stamps are white (the light rim would vanish into them); its one marker is green.
    expect(markers.some((m) => isLightFill(m.color)) && markers.some((m) => !isLightFill(m.color))).toBe(true);
    shapes.forEach((s, i) => {
      expect(s.options.fillColor).toBe(markers[i].color);
      expect(s.options.fillOpacity).toBe(1);
      expect(s.options.color).toBe(isLightFill(markers[i].color) ? "DARK" : "EDGE");
      expect(s.options.weight).toBe(MARKER_EDGE_PX);
    });
    cleanup();
    expect(paths()).toHaveLength(0);
  });

  it("draws a stamp as a diamond round its place and a marker as a pin with its tip on its place", () => {
    const stamp = marker({ kind: "stamp" });
    const pin = marker({ id: "m2" });
    markersLayer.draw(ctx, [stamp, pin]);
    const [diamond, teardrop] = polygons();
    expect(offsetsFrom(diamond, stamp)).toEqual([
      [0, -STAMP_RADIUS_PX],
      [STAMP_RADIUS_PX, 0],
      [0, STAMP_RADIUS_PX],
      [-STAMP_RADIUS_PX, 0],
    ]);
    const pinPoints = offsetsFrom(teardrop, pin);
    expect(pinPoints[0]).toEqual([0, 0]);
    // Everything else sits above the tip, up to the head's top.
    expect(Math.min(...pinPoints.map(([, y]) => y))).toBe(-(PIN_HEAD_OFFSET_PX + PIN_HEAD_RADIUS_PX));
    expect(Math.max(...pinPoints.slice(1).map(([, y]) => y))).toBeLessThan(0);
  });

  it("keeps the shapes the same size on screen when the zoom changes, and stops following it after cleanup", async () => {
    const stamp = marker({ kind: "stamp" });
    const cleanup = markersLayer.draw(ctx, [stamp]);
    map.setZoom(2, { animate: false });
    expect(offsetsFrom(polygons()[0], stamp)[1]).toEqual([STAMP_RADIUS_PX, 0]);
    await new Promise((resolve) => setTimeout(resolve, 60)); // let Leaflet's own repaint run while the map is alive
    const off = vi.spyOn(map, "off");
    cleanup();
    expect(off).toHaveBeenCalledWith("zoomend", expect.any(Function));
  });

  it("builds the tooltip from text nodes: the name, the kind and the place", () => {
    const evil = "<img src=x onerror=alert(1)>";
    markersLayer.draw(ctx, [marker({ name: evil })]);
    const el = (polygons()[0].getTooltip()!.getContent() as () => HTMLElement)();
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toBe(`${evil}Markerx 10, y -20`);
  });

  it("names an unnamed marker or stamp by its kind", () => {
    markersLayer.draw(ctx, [marker({ name: "" }), marker({ id: "s", name: "  ", kind: "stamp" })]);
    expect(tooltipText(polygons()[0])).toContain("Unnamed marker");
    expect(tooltipText(polygons()[1])).toBe("Unnamed stampStampx 10, y -20");
  });

  it("draws nothing for an empty layer", () => {
    markersLayer.draw(ctx, [])();
    expect(paths()).toHaveLength(0);
  });

  it("describes the layer in text: markers and stamps", () => {
    expect(markersLayer.describe([])).toBe("No map markers or stamps placed yet.");
    expect(markersLayer.describe(mapMarkersWorldResponse.data)).toBe("1 marker and 3 stamps on the map.");
    expect(markersLayer.describe([marker(), marker({ id: "b" })])).toBe("2 markers and 0 stamps on the map.");
  });

  it("has a legend naming each shape", () => {
    render(<>{markersLayer.legend()}</>);
    expect(screen.getByText("Marker (pin)")).toBeInTheDocument();
    expect(screen.getByText("Stamp (diamond)")).toBeInTheDocument();
  });

  it("keys markers by id and place, and still apart when even those repeat", () => {
    const a = marker();
    expect(markerKeys([a, marker({ x: 11 }), a])).toEqual(["m1:10:-20", "m1:11:-20", "m1:10:-20:1"]);
  });

  it("keeps keys unique when an id with colons imitates a suffixed key", () => {
    const list = [marker({ id: "a", x: 1, y: 2 }), marker({ id: "a", x: 1, y: 2 }), marker({ id: "a:1", x: 2, y: 1 })];
    expect(new Set(markerKeys(list)).size).toBe(3);
  });
});

describe("powerLinesLayer (#330)", () => {
  it("draws every line as one Leaflet path, projected, thin, in the power-line token, and removes it on cleanup", () => {
    const cleanup = powerLinesLayer.draw(ctx, powerLinesWorldResponse.data);
    const drawn = paths();
    expect(drawn).toHaveLength(1);
    const line = drawn[0] as L.Polyline;
    expect(line).toBeInstanceOf(L.Polyline);
    // One sub-path per power line, each its two ends.
    const parts = line.getLatLngs() as L.LatLng[][];
    expect(parts).toHaveLength(powerLinesWorldResponse.data.length);
    const [[x0, y0], [x1, y1]] = powerLinesWorldResponse.data[1].points;
    expect(parts[1]).toHaveLength(2);
    expect(parts[1][0]).toMatchObject({ lat: project(GRID_BASE_MAP, x0, y0)[0], lng: project(GRID_BASE_MAP, x0, y0)[1] });
    expect(parts[1][1]).toMatchObject({ lat: project(GRID_BASE_MAP, x1, y1)[0], lng: project(GRID_BASE_MAP, x1, y1)[1] });
    expect(line.options.color).toBe("WIRE");
    expect(line.options.weight).toBe(POWER_LINE_WEIGHT_PX);
    expect(POWER_LINE_WEIGHT_PX).toBeLessThan(RAIL_WEIGHT_PX);
    // Not interactive: a wire never takes the hover from the building or marker under the pointer.
    expect(line.options.interactive).toBe(false);
    cleanup();
    expect(paths()).toHaveLength(0);
  });

  it("stays one path for thousands of lines", () => {
    const many = Array.from({ length: 5_000 }, (_, i) => ({ id: `Build_PowerLine_C_${i}`, points: [[i, 0], [i, 10]] as [[number, number], [number, number]] }));
    powerLinesLayer.draw(ctx, many);
    expect(paths()).toHaveLength(1);
    expect((paths()[0] as L.Polyline).getLatLngs()).toHaveLength(5_000);
  });

  it("draws nothing for an empty layer", () => {
    powerLinesLayer.draw(ctx, [])();
    expect(paths()).toHaveLength(0);
  });

  it("describes the layer in text, with the wire's total length", () => {
    expect(powerLinesLayer.describe([])).toBe("No power lines built yet.");
    expect(powerLinesLayer.describe([{ id: "a", points: [[0, 0], [3, 4]] }])).toBe("1 power line on the map, 5 m of wire in all.");
    expect(
      powerLinesLayer.describe([
        { id: "a", points: [[0, 0], [3, 4]] },
        { id: "a", points: [[0, 0], [0, 1_000]] },
      ]),
    ).toBe("2 power lines on the map, 1,005 m of wire in all.");
  });

  it("says 'shown', not 'in all', when the layer was cut", () => {
    expect(powerLinesLayer.describe([{ id: "a", points: [[0, 0], [3, 4]] }], { truncated: true })).toBe(
      "1 power line on the map, 5 m of wire shown.",
    );
  });

  it("has a legend row that names the line", () => {
    render(<>{powerLinesLayer.legend()}</>);
    expect(screen.getByText("Power line")).toBeInTheDocument();
  });
});
