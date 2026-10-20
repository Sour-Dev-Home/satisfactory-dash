import * as L from "leaflet";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { drawGrid } from "./grid";
import { GRID_BASE_MAP } from "./projection";

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
  // Paths first: one removed after its renderer would queue a repaint on a destroyed canvas.
  map.eachLayer((layer) => {
    if (layer instanceof L.Path) layer.remove();
  });
  map.remove();
  host.remove();
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

describe("drawGrid (the neutral base map, ADR-0023 decision 4)", () => {
  it("draws quiet lines in surface-2 every grid step and the world border in the line colour", () => {
    const renderer = L.canvas();
    drawGrid(L, map, renderer, GRID_BASE_MAP, (token) => `color(${token})`);
    const lines: L.Polyline[] = [];
    const borders: L.Rectangle[] = [];
    map.eachLayer((layer) => {
      if (layer instanceof L.Rectangle) borders.push(layer);
      else if (layer instanceof L.Polyline) lines.push(layer);
    });

    const { minX, maxX, minY, maxY } = GRID_BASE_MAP.worldBoundsM;
    const step = GRID_BASE_MAP.gridStepM;
    const count = (min: number, max: number) => Math.floor(max / step) - Math.ceil(min / step) + 1;
    expect(lines).toHaveLength(count(minX, maxX) + count(minY, maxY));
    for (const line of lines) {
      const { color, opacity, interactive } = line.options;
      expect({ color, opacity, interactive }).toEqual({ color: "color(--color-surface-2)", opacity: 1, interactive: false });
      // Identity, not deep equality: a renderer's object graph is the whole map.
      expect(line.options.renderer).toBe(renderer);
    }
    expect(borders).toHaveLength(1);
    const { color, fill, interactive } = borders[0].options;
    expect({ color, fill, interactive }).toEqual({ color: "color(--color-line)", fill: false, interactive: false });
  });
});
