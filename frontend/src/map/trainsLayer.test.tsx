import { mapLiveEmpty, mapLiveSample } from "@satisfactory-dash/shared/fixtures";
import type { MapLive } from "@satisfactory-dash/shared";
import * as L from "leaflet";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MapContext } from "./layers";
import { GRID_BASE_MAP, project } from "./projection";
import { durationMs, easeInOut, STATION_RADIUS_PX, TRAIN_RADIUS_PX, trainsLayer } from "./trainsLayer";

// Leaflet runs for real (the 2D context is a no-op); the tests read the layers Leaflet holds.
const originalGetContext = HTMLCanvasElement.prototype.getContext;
let map: L.Map;
let ctx: MapContext;
let glide = "1s";

beforeEach(() => {
  glide = "1s";
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
    ["--color-train", "TRAIN"],
    ["--color-station", "STATION"],
  ]);
  ctx = {
    L,
    map,
    renderer,
    color: (t) => colors.get(t) ?? "UNKNOWN",
    token: (t) => (t === "--duration-glide" ? glide : ""),
    project: (x, y) => project(GRID_BASE_MAP, x, y),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  map.remove();
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

const circles = () => {
  const found: L.CircleMarker[] = [];
  map.eachLayer((l) => {
    if (l instanceof L.CircleMarker) found.push(l);
  });
  return found;
};
const trainMarkers = () => circles().filter((c) => c.options.radius === TRAIN_RADIUS_PX);
const stationMarkers = () => circles().filter((c) => c.options.radius === STATION_RADIUS_PX);
const tooltipText = (layer: L.Layer) => ((layer.getTooltip()!.getContent() as () => HTMLElement)() as HTMLElement).textContent;

/** A controllable frame loop: `tick(ms)` runs the pending frame callback at that time. */
function fakeFrames() {
  let now = 1000;
  let pending: FrameRequestCallback | null = null;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const request = vi.fn((cb: FrameRequestCallback) => {
    pending = cb;
    return 7;
  });
  const cancel = vi.fn(() => {
    pending = null;
  });
  vi.stubGlobal("requestAnimationFrame", request);
  vi.stubGlobal("cancelAnimationFrame", cancel);
  return {
    request,
    cancel,
    tick(ms: number) {
      now = 1000 + ms;
      const cb = pending;
      pending = null;
      cb?.(now);
    },
    get waiting() {
      return pending !== null;
    },
  };
}

const live = (x: number, y = -1473): MapLive => ({
  trains: [{ id: "t1", name: "Train", x, y, status: "Self-Driving" }],
  stations: [],
});

describe("trainsLayer", () => {
  it("draws a ring per station and a dot per train, projected, in their tokens, and removes them on cleanup", () => {
    const cleanup = trainsLayer.draw(ctx, mapLiveSample);
    expect(stationMarkers()).toHaveLength(mapLiveSample.stations.length);
    expect(trainMarkers()).toHaveLength(mapLiveSample.trains.length);
    const [lat, lng] = project(GRID_BASE_MAP, mapLiveSample.trains[0].x, mapLiveSample.trains[0].y);
    expect(trainMarkers()[0].getLatLng()).toMatchObject({ lat, lng });
    expect(trainMarkers()[0].options.fillColor).toBe("TRAIN");
    expect(stationMarkers()[0].options.color).toBe("STATION");
    cleanup();
    expect(circles()).toHaveLength(0);
  });

  it("draws nothing for an empty reading", () => {
    trainsLayer.draw(ctx, mapLiveEmpty)();
    expect(circles()).toHaveLength(0);
  });

  it("builds both tooltips from text nodes, so a hostile name is never markup", () => {
    const hostile = "<img src=x onerror=alert(1)>";
    trainsLayer.draw(ctx, {
      trains: [{ id: "t", name: hostile, x: 0, y: 0, status: hostile }],
      stations: [{ id: "s", name: hostile, x: 5, y: 5 }],
    });
    expect(tooltipText(trainMarkers()[0])).toBe(`${hostile}${hostile}x 0, y 0`);
    expect(tooltipText(stationMarkers()[0])).toBe(`${hostile}Train stationx 5, y 5`);
    const content = (trainMarkers()[0].getTooltip()!.getContent() as () => HTMLElement)();
    expect(content.querySelector("img")).toBeNull();
  });

  it("describes the layer in text, with singular and plural forms", () => {
    expect(trainsLayer.describe(mapLiveEmpty)).toBe("No trains or stations built yet.");
    expect(trainsLayer.describe(mapLiveSample)).toBe("1 train and 2 stations on the map.");
    expect(trainsLayer.describe({ trains: [], stations: [mapLiveSample.stations[0]] })).toBe("0 trains and 1 station on the map.");
  });

  it("starts a train where it was last drawn and eases it to the new place over the glide token", () => {
    const frames = fakeFrames();
    trainsLayer.draw(ctx, live(0))();
    trainsLayer.draw(ctx, live(1000));
    const marker = trainMarkers()[0];
    const from = project(GRID_BASE_MAP, 0, -1473);
    const to = project(GRID_BASE_MAP, 1000, -1473);
    expect(marker.getLatLng()).toMatchObject({ lat: from[0], lng: from[1] });
    frames.tick(500); // halfway in time: an ease in and out is halfway in space too
    expect(marker.getLatLng().lng).toBeCloseTo((from[1] + to[1]) / 2, 6);
    frames.tick(1000);
    expect(marker.getLatLng()).toMatchObject({ lat: to[0], lng: to[1] });
    expect(frames.waiting).toBe(false);
  });

  it("eases both ways: slower than linear at the start and at the end", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.25)).toBeLessThan(0.25);
    expect(easeInOut(0.75)).toBeGreaterThan(0.75);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 10);
  });

  it("does not move a train at all under reduced motion (the glide token is 0s)", () => {
    const frames = fakeFrames();
    glide = "0s";
    trainsLayer.draw(ctx, live(0))();
    trainsLayer.draw(ctx, live(1000));
    const to = project(GRID_BASE_MAP, 1000, -1473);
    expect(trainMarkers()[0].getLatLng()).toMatchObject({ lat: to[0], lng: to[1] });
    expect(frames.request).not.toHaveBeenCalled();
  });

  it("puts a first sighting, and a train that has not moved, straight at its place without animating", () => {
    const frames = fakeFrames();
    trainsLayer.draw(ctx, live(0))();
    trainsLayer.draw(ctx, live(0));
    expect(frames.request).not.toHaveBeenCalled();
  });

  it("restarts a slide from where it had got to when a new reading arrives mid-slide, and cancels the old frame", () => {
    const frames = fakeFrames();
    trainsLayer.draw(ctx, live(0))();
    const cleanup = trainsLayer.draw(ctx, live(1000));
    frames.tick(500);
    const halfway = trainMarkers()[0].getLatLng().lng;
    cleanup();
    expect(frames.cancel).toHaveBeenCalled();
    trainsLayer.draw(ctx, live(2000));
    expect(trainMarkers()[0].getLatLng().lng).toBeCloseTo(halfway, 9);
  });

  it("forgets a train that is gone, so a train with a reused id does not slide in from far away", () => {
    fakeFrames();
    trainsLayer.draw(ctx, live(0))();
    trainsLayer.draw(ctx, mapLiveEmpty)();
    trainsLayer.draw(ctx, live(5000));
    const to = project(GRID_BASE_MAP, 5000, -1473);
    expect(trainMarkers()[0].getLatLng()).toMatchObject({ lat: to[0], lng: to[1] });
  });

  it("slides only the trains that moved, and keeps others still", () => {
    const frames = fakeFrames();
    const two = (x2: number): MapLive => ({
      trains: [
        { id: "a", name: "A", x: 0, y: 0, status: "Self-Driving" },
        { id: "b", name: "B", x: x2, y: 0, status: "Self-Driving" },
      ],
      stations: [],
    });
    trainsLayer.draw(ctx, two(100))();
    trainsLayer.draw(ctx, two(900));
    frames.tick(1000);
    const byName = Object.fromEntries(trainMarkers().map((m) => [tooltipText(m)!.slice(0, 1), m.getLatLng().lng]));
    expect(byName.A).toBe(project(GRID_BASE_MAP, 0, 0)[1]);
    expect(byName.B).toBe(project(GRID_BASE_MAP, 900, 0)[1]);
  });
});

describe("durationMs", () => {
  it("reads seconds and milliseconds, and gives 0 for anything else so nothing animates", () => {
    expect(durationMs("1s")).toBe(1000);
    expect(durationMs(" 0.5s ")).toBe(500);
    expect(durationMs("240ms")).toBe(240);
    expect(durationMs("0s")).toBe(0);
    for (const odd of ["", "fast", "1", "-1s", "NaNs", "1m"]) expect(durationMs(odd), odd).toBe(0);
  });
});
