import { railsWorldResponse, resourceNodesWorldResponse } from "@satisfactory-dash/shared/fixtures";
import { render, screen, within } from "@testing-library/react";
import * as L from "leaflet";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MapContext } from "./layers";
import { GRID_BASE_MAP, project } from "./projection";
import { railsLayer } from "./railsLayer";
import { resourceNodesLayer } from "./resourceNodesLayer";
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
    ["--color-muted", "MUTED"],
    ["--color-accent", "AMBER"],
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
const tooltipText = (layer: L.Layer) => ((layer.getTooltip()!.getContent() as () => HTMLElement)() as HTMLElement).textContent;

describe("railsLayer", () => {
  it("draws one polyline per segment, projected, in the muted token, and removes them on cleanup", () => {
    const cleanup = railsLayer.draw(ctx, railsWorldResponse.data);
    const lines = paths<L.Polyline>();
    expect(lines).toHaveLength(railsWorldResponse.data.length);
    const first = railsWorldResponse.data[0].points[0];
    const [lat, lng] = project(GRID_BASE_MAP, first[0], first[1]);
    expect(lines[0].getLatLngs()[0]).toMatchObject({ lat, lng });
    expect(lines[0].options.color).toBe("MUTED");
    cleanup();
    expect(paths()).toHaveLength(0);
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
  it("draws a circle per node at its projected point, sized by purity, filled only when in use", () => {
    const nodes = resourceNodesWorldResponse.data;
    const cleanup = resourceNodesLayer.draw(ctx, nodes);
    const circles = paths<L.CircleMarker>();
    expect(circles).toHaveLength(nodes.length);
    nodes.forEach((n, i) => {
      const [lat, lng] = project(GRID_BASE_MAP, n.x, n.y);
      expect(circles[i].getLatLng()).toMatchObject({ lat, lng });
      expect(circles[i].getRadius()).toBe(nodeRadiusPx(n.purity));
      expect(circles[i].options.fillOpacity).toBe(n.exploited ? 1 : 0);
      expect(circles[i].options.color).toBe("AMBER");
    });
    cleanup();
    expect(paths()).toHaveLength(0);
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
    expect(resourceNodesLayer.describe([])).toBe("No resource nodes read yet.");
    const text = resourceNodesLayer.describe(resourceNodesWorldResponse.data);
    expect(text).toBe(
      "7 resource nodes on the map (2 in use): 2 SAM, 1 Coal, 1 Crude Oil, 1 Iron Ore, 1 Limestone, 1 Nitrogen Gas.",
    );
  });

  it("has a legend for fill (in use or free) and size (purity)", () => {
    render(<>{resourceNodesLayer.legend()}</>);
    const legend = screen.getByRole("list");
    expect(within(legend).getByText("In use (filled)")).toBeInTheDocument();
    expect(within(legend).getByText("Free (outline)")).toBeInTheDocument();
    expect(within(legend).getByText(/impure, normal, pure/)).toBeInTheDocument();
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
