import { render, screen } from "@testing-library/react";
import * as L from "leaflet";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ConveyorEdge } from "@satisfactory-dash/shared";
import type { MapContext } from "./layers";
import { GRID_BASE_MAP, project } from "./projection";
import { placeConveyors } from "./conveyors";
import { BELT_WEIGHT_PX, conveyorsLayer, LIFT_DOT_PX, PIPE_WEIGHT_PX } from "./conveyorsLayer";
import { POWER_LINE_WEIGHT_PX } from "./powerLinesLayer";
import { RAIL_WEIGHT_PX } from "./railsLayer";

// Leaflet runs for real; only the 2D context is a no-op (jsdom has none), as in worldLayers.test.tsx.
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
    ["--color-map-belt", "BELT"],
    ["--color-map-pipe", "PIPE"],
  ]);
  ctx = { L, map, renderer, color: (t) => colors.get(t) ?? "UNKNOWN", token: () => "", project: (x, y) => project(GRID_BASE_MAP, x, y) };
});

afterEach(() => {
  map.remove();
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

const paths = () => {
  const found: L.Polyline[] = [];
  map.eachLayer((l) => {
    if (l instanceof L.Polyline) found.push(l);
  });
  return found;
};
const latLng = (x: number, y: number) => {
  const [lat, lng] = project(GRID_BASE_MAP, x, y);
  return { lat, lng };
};

const edge = (over: Partial<ConveyorEdge> & Pick<ConveyorEdge, "id">): ConveyorEdge => ({
  kind: "belt",
  from: null,
  fromKind: null,
  to: null,
  toKind: null,
  capacityPerMinute: 60,
  tier: "Conveyor Belt Mk.1",
  at: { x: 0, y: 0 },
  ...over,
});

const sample = () =>
  placeConveyors(
    [
      edge({ id: "A", to: "M", toKind: "machine", at: { x: 0, y: 0 } }),
      edge({ id: "B", at: { x: 50, y: 50 } }),
      edge({ id: "P", kind: "pipe", capacityPerMinute: null, tier: "Pipeline Mk.1", to: "M", toKind: "machine", at: { x: 10, y: 10 } }),
      edge({ id: "L", kind: "lift", tier: "Conveyor Lift Mk.1", at: { x: 5, y: 5 } }),
    ],
    new Map([["M", { x: 100, y: 0, name: "Constructor" }]]),
  );

describe("conveyorsLayer (#330)", () => {
  it("is off by default and named for the toggle", () => {
    expect(conveyorsLayer.id).toBe("conveyors");
    expect(conveyorsLayer.label).toBe("Belts and pipes");
    expect(conveyorsLayer.defaultVisible).toBe(false);
  });

  it("draws one non-interactive path per kind: pipes, then belts, then lifts, and removes them on cleanup", () => {
    const cleanup = conveyorsLayer.draw(ctx, sample());
    const drawn = paths();
    expect(drawn).toHaveLength(3);
    const [pipes, belts, lifts] = drawn;
    expect(pipes.options).toMatchObject({ color: "PIPE", weight: PIPE_WEIGHT_PX, interactive: false, lineCap: "round" });
    expect(belts.options).toMatchObject({ color: "BELT", weight: BELT_WEIGHT_PX, interactive: false, lineCap: "round" });
    expect(lifts.options).toMatchObject({ color: "BELT", weight: LIFT_DOT_PX, interactive: false, lineCap: "round" });
    // A placed belt is a straight segment to its far end; an unplaced one a dot (a zero-length segment, round caps).
    expect(belts.getLatLngs()).toEqual([
      [expect.objectContaining(latLng(0, 0)), expect.objectContaining(latLng(100, 0))],
      [expect.objectContaining(latLng(50, 50)), expect.objectContaining(latLng(50, 50))],
    ]);
    expect(pipes.getLatLngs()).toEqual([[expect.objectContaining(latLng(10, 10)), expect.objectContaining(latLng(100, 0))]]);
    expect(lifts.getLatLngs()).toEqual([[expect.objectContaining(latLng(5, 5)), expect.objectContaining(latLng(5, 5))]]);
    cleanup();
    expect(paths()).toHaveLength(0);
  });

  it("sits between the power lines' hairline and the rails, a pipe a step wider than a belt, a lift a dot larger than both", () => {
    expect(BELT_WEIGHT_PX).toBeGreaterThan(POWER_LINE_WEIGHT_PX);
    expect(PIPE_WEIGHT_PX).toBeGreaterThan(BELT_WEIGHT_PX);
    expect(RAIL_WEIGHT_PX).toBeGreaterThan(PIPE_WEIGHT_PX);
    expect(LIFT_DOT_PX).toBeGreaterThan(PIPE_WEIGHT_PX);
  });

  it("skips a kind with nothing in it, and stays three paths for thousands of conveyors", () => {
    conveyorsLayer.draw(ctx, sample().filter((c) => c.edge.kind === "belt"));
    expect(paths()).toHaveLength(1);
    map.eachLayer((l) => void (l instanceof L.Polyline && l.remove()));
    const many = placeConveyors(
      Array.from({ length: 6_000 }, (_, i) => edge({ id: `C${i}`, kind: (["belt", "pipe", "lift"] as const)[i % 3], at: { x: i, y: 0 } })),
      new Map(),
    );
    conveyorsLayer.draw(ctx, many);
    expect(paths()).toHaveLength(3);
  });

  it("draws nothing for an empty layer", () => {
    conveyorsLayer.draw(ctx, [])();
    expect(paths()).toHaveLength(0);
  });

  it("describes the layer through the summary", () => {
    expect(conveyorsLayer.describe([])).toBe("No belts, lifts or pipes reported yet.");
    expect(conveyorsLayer.describe(sample())).toMatch(/^2 belts, 1 pipe, 1 lift on the map, 100 m of belt and 91 m of pipe in all/);
  });

  it("has a legend row per kind", () => {
    render(<>{conveyorsLayer.legend()}</>);
    expect(screen.getByText("Belt")).toBeInTheDocument();
    expect(screen.getByText("Pipe")).toBeInTheDocument();
    expect(screen.getByText("Lift")).toBeInTheDocument();
    expect(screen.getByText(/Far end not placed/)).toBeInTheDocument();
  });
});
