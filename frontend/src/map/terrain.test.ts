import * as L from "leaflet";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GRID_BASE_MAP } from "./projection";
import { drawTerrain, type Terrain } from "./terrain";

/** jsdom has no 2D context; the canvas renderer only needs the calls to exist. */
const noopContext = new Proxy({}, { get: (_t, prop) => (prop === "canvas" ? undefined : () => {}) });
const originalGetContext = HTMLCanvasElement.prototype.getContext;
let host: HTMLDivElement;
let map: L.Map;

beforeEach(() => {
  // @ts-expect-error -- test-only stub, not a real CanvasRenderingContext2D
  HTMLCanvasElement.prototype.getContext = () => noopContext;
  host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { value: 400 });
  Object.defineProperty(host, "clientHeight", { value: 300 });
  document.body.append(host);
  map = L.map(host, { crs: L.CRS.Simple }).setView([0, 0], -4);
});

afterEach(() => {
  map.eachLayer((layer) => {
    if (layer instanceof L.Path) layer.remove();
  });
  map.remove();
  host.remove();
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

const square = (x: number, y: number, s: number) => [x, y, x + s, y, x + s, y + s, x, y + s];
const TERRAIN: Terrain = {
  boundsM: GRID_BASE_MAP.worldBoundsM,
  land: [square(-1000, -1000, 2000), square(-200, -200, 400)],
  classes: [
    { id: "grass", rings: [square(-1000, -1000, 1000)] },
    { id: "unknown", rings: [square(0, 0, 500)] },
    { id: "sand", rings: [] },
  ],
};

const polygons = () => {
  const out: L.Polygon[] = [];
  map.eachLayer((layer) => {
    if (layer instanceof L.Polygon) out.push(layer);
  });
  return out;
};

describe("drawTerrain (the traced base map, ADR-0023 amendment)", () => {
  const color = (token: string) => (token === "--color-terrain-unknown" ? "" : `color(${token})`);

  it("draws the land, one even-odd polygon per class with a tint, and the coast on top, none interactive", () => {
    drawTerrain(L, map, L.canvas(), GRID_BASE_MAP, color, TERRAIN);
    const drawn = polygons();
    expect(drawn.map((p) => p.options.fillColor ?? p.options.color)).toEqual([
      "color(--color-terrain-land)",
      "color(--color-terrain-grass)",
      // A class with no token of its own falls back to the land colour, never the browser's default blue.
      "color(--color-terrain-land)",
      "color(--color-terrain-coast)",
    ]);
    for (const p of drawn) expect(p.options.interactive).toBe(false);
    expect(drawn[0].options).toMatchObject({ stroke: false, fillRule: "evenodd" });
    expect(drawn[3].options).toMatchObject({ fill: false, stroke: true });
  });

  it("projects world metres with the base map's projection: +y south is negative latitude", () => {
    drawTerrain(L, map, L.canvas(), GRID_BASE_MAP, color, TERRAIN);
    const outer = (polygons()[0].getLatLngs() as L.LatLng[][])[0];
    expect(outer[0]).toMatchObject({ lat: 1000, lng: -1000 });
    expect(outer[2]).toMatchObject({ lat: -1000, lng: 1000 });
  });

  it("removes everything it drew on cleanup", () => {
    const cleanup = drawTerrain(L, map, L.canvas(), GRID_BASE_MAP, color, TERRAIN);
    cleanup();
    expect(polygons()).toHaveLength(0);
  });
});
