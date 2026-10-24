import { factoryMixed } from "@satisfactory-dash/shared/fixtures";
import type { Factory, FactoryBuilding } from "@satisfactory-dash/shared";
import { render, screen, within } from "@testing-library/react";
import * as L from "leaflet";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MACHINE_HOUSING, MACHINE_WINDOW, STATION_VIEWBOX } from "../ui/stationShapes";
import { buildingsLayer } from "./buildingsLayer";
import type { MapContext } from "./layers";
import { hitRadius, ICON_MAX_PX, ICON_MIN_PX, iconPx, ringRadius, ringReach } from "./machineIcon";

/** One canvas call, with the drawing state it ran under. */
interface Call {
  op: string;
  args: unknown[];
  fillStyle: unknown;
  strokeStyle: unknown;
  globalAlpha: unknown;
}

/**
 * jsdom has no 2D context. This one records every call with the fill, stroke and alpha it ran
 * under, so a test reads what the real Leaflet canvas renderer drew.
 */
function recordingContext() {
  const calls: Call[] = [];
  const state: Record<string | symbol, unknown> = { fillStyle: "", strokeStyle: "", globalAlpha: 1, lineWidth: 1 };
  const ctx = new Proxy(state, {
    get: (target, prop) => {
      if (Object.hasOwn(target, prop)) return target[prop];
      if (prop === "canvas" || prop === "then") return undefined;
      return (...args: unknown[]) => {
        calls.push({ op: String(prop), args, fillStyle: target.fillStyle, strokeStyle: target.strokeStyle, globalAlpha: target.globalAlpha });
      };
    },
    set: (target, prop, value) => {
      target[prop] = value;
      return true;
    },
  });
  return { ctx, calls };
}

const COLORS = new Map([
  ["--color-ok", "OK"],
  ["--color-muted", "MUTED"],
  ["--color-info", "INFO"],
  ["--color-line", "LINE"],
  ["--color-warn", "WARN"],
  ["--color-canvas", "CANVAS"],
]);

let recorder: ReturnType<typeof recordingContext>;
let host: HTMLDivElement;
let map: L.Map;
let renderer: L.Canvas;
let frames: FrameRequestCallback[];
const requestFrame = vi.fn((cb: FrameRequestCallback) => frames.push(cb));
const cancelFrame = vi.fn();
const originalGetContext = HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  recorder = recordingContext();
  // @ts-expect-error -- test-only stub, not a real CanvasRenderingContext2D
  HTMLCanvasElement.prototype.getContext = () => recorder.ctx;
  frames = [];
  requestFrame.mockClear();
  cancelFrame.mockClear();
  vi.stubGlobal("requestAnimationFrame", requestFrame);
  vi.stubGlobal("cancelAnimationFrame", cancelFrame);
  host = document.createElement("div");
  // Leaflet sizes the map (and so the canvas renderer's bounds) from the container.
  Object.defineProperty(host, "clientWidth", { value: 400 });
  Object.defineProperty(host, "clientHeight", { value: 300 });
  document.body.append(host);
  renderer = L.canvas({ padding: 0 });
  // MapCanvas's zoom range, so a test can zoom far out and in.
  map = L.map(host, { crs: L.CRS.Simple, renderer, minZoom: -5, maxZoom: 5 }).setView([0, 0], 0);
});

afterEach(() => {
  // Paths first: one removed after its renderer would queue a repaint on a destroyed canvas.
  map.eachLayer((layer) => {
    if (layer instanceof L.Path) layer.remove();
  });
  map.remove();
  host.remove();
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  vi.unstubAllGlobals();
});

function context(): MapContext {
  const token = (name: string) => COLORS.get(name) ?? "";
  return { L, map, renderer, project: (x, y) => [-y, x], color: token, token };
}

/** Leaflet draws on its next frame; run it now, from a clean record. */
type RendererInternals = { _redraw: () => void; _redrawRequest: number | null; _redrawBounds: unknown };
/** Every canvas renderer on the map: the shared one, and the backed-up rings' own when there is one. */
const renderers = () => {
  const found: L.Canvas[] = [];
  map.eachLayer((layer) => {
    if (layer instanceof L.Canvas) found.push(layer);
  });
  return found;
};
function paint(only?: L.Canvas) {
  recorder.calls.length = 0;
  for (const r of only ? [only] : renderers()) {
    const internals = r as unknown as RendererInternals;
    // Cancel the frame Leaflet queued, or it would run after the map is gone.
    L.Util.cancelAnimFrame(internals._redrawRequest ?? 0);
    internals._redraw();
  }
  return recorder.calls;
}

const base = factoryMixed.data.buildings[1];
const at = (i: number) => ({ xM: i * 40, yM: 20, zM: 0, rotationDeg: 0 });
const building = (i: number, over: Partial<FactoryBuilding>): FactoryBuilding => ({
  ...base,
  id: `b${i}`,
  isPaused: false,
  isBackedUp: false,
  location: at(i),
  ...over,
});
const running = [{ ...base.production[0], percent: 100 }];
const stopped = [{ ...base.production[0], percent: 0 }];
const ONE_PER_STATE: FactoryBuilding[] = [
  building(0, { recipe: "Iron Plate", production: running }),
  building(1, { recipe: "Iron Plate", production: stopped }),
  building(2, { recipe: "Iron Plate", production: running, isPaused: true }),
  building(3, { recipe: null, production: [] }),
];
const factory = (buildings: FactoryBuilding[]): Factory => ({ buildings, backedUpCount: buildings.filter((b) => b.isBackedUp).length });
const BACKED_UP = building(4, { recipe: "Screw", production: running, isBackedUp: true, state: "backedUp" });

const isRect = (call: Call, shape: { x: number; y: number; width: number; height: number }) =>
  call.op === "roundRect" && call.args[0] === shape.x && call.args[1] === shape.y && call.args[2] === shape.width && call.args[3] === shape.height;
/** How each housing (or window) was painted, in draw order: "fill:<colour>" or "stroke:<colour>". */
const paintsOf = (calls: Call[], shape: typeof MACHINE_HOUSING) =>
  calls.flatMap((call, i) => {
    if (!isRect(call, shape)) return [];
    const next = calls.slice(i + 1).find((c) => c.op === "fill" || c.op === "stroke")!;
    return [`${next.op}:${String(next.op === "fill" ? next.fillStyle : next.strokeStyle)}`];
  });
/** The colour each filled housing (or window) got, in draw order. */
const fillsOf = (calls: Call[], shape: typeof MACHINE_HOUSING) =>
  paintsOf(calls, shape).flatMap((p) => (p.startsWith("fill:") ? [p.slice(5)] : []));
const rings = (calls: Call[]) =>
  calls.flatMap((call, i) => {
    if (call.op !== "arc") return [];
    const stroke = calls.slice(i).find((c) => c.op === "stroke" || c.op === "fill")!;
    return stroke.op === "stroke" ? [{ radius: call.args[2] as number, color: stroke.strokeStyle, alpha: stroke.globalAlpha }] : [];
  });

describe("buildingsLayer.draw: machine icons on the canvas renderer", () => {
  it("draws one machine icon per building, its housing in the state's colour (ADR-0041)", () => {
    buildingsLayer.draw(context(), factory(ONE_PER_STATE));
    const calls = paint();
    // No recipe is the hollow housing: an outline in muted, no fill.
    expect(paintsOf(calls, MACHINE_HOUSING)).toEqual(["fill:OK", "fill:MUTED", "fill:INFO", "stroke:MUTED"]);
    // The centre mark: the machine's window, in the canvas colour, on each filled housing.
    expect(fillsOf(calls, MACHINE_WINDOW)).toEqual(["CANVAS", "CANVAS", "CANVAS"]);
    // Drawn on the canvas, not DOM: no marker elements, no SVG renderer. No ring without a backed-up machine.
    expect(host.querySelector(".leaflet-marker-icon, .leaflet-overlay-pane svg")).toBeNull();
    expect(host.querySelector(".leaflet-overlay-pane canvas")).not.toBeNull();
    expect(rings(calls)).toEqual([]);
  });

  it("draws no recipe hollow: the only stroke, and no fill of its own, so it differs from not producing by shape", () => {
    buildingsLayer.draw(context(), factory(ONE_PER_STATE));
    const calls = paint();
    const strokes = calls.filter((c) => c.op === "stroke");
    expect(strokes.map((c) => c.strokeStyle)).toEqual(["MUTED"]);
    // Nothing is filled after the no-recipe housing (the last icon drawn).
    const housings = calls.flatMap((c, i) => (isRect(c, MACHINE_HOUSING) ? [i] : []));
    expect(calls.slice(housings[3]).some((c) => c.op === "fill")).toBe(false);
  });

  it("keeps a backed-up machine without a recipe filled in warn, with its triangle", () => {
    buildingsLayer.draw(context(), factory([{ ...BACKED_UP, recipe: null, production: [] }]));
    expect(paintsOf(paint(), MACHINE_HOUSING)).toEqual(["fill:WARN"]);
  });

  it("draws a backed-up machine in the warn colour with a warning triangle instead of the window", () => {
    buildingsLayer.draw(context(), factory([BACKED_UP]));
    const calls = paint();
    expect(fillsOf(calls, MACHINE_HOUSING)).toEqual(["WARN"]);
    expect(fillsOf(calls, MACHINE_WINDOW)).toEqual([]);
    const triangle = calls.findIndex((c) => c.op === "closePath");
    expect(triangle).toBeGreaterThan(-1);
    expect(calls.slice(triangle).find((c) => c.op === "fill")!.fillStyle).toBe("CANVAS");
  });

  it("keeps hover hit-testing: every icon is an interactive canvas marker with its tooltip", () => {
    buildingsLayer.draw(context(), factory(ONE_PER_STATE));
    const markers: L.CircleMarker[] = [];
    map.eachLayer((layer) => {
      if (layer instanceof L.CircleMarker && layer.getTooltip()) markers.push(layer);
    });
    expect(markers).toHaveLength(ONE_PER_STATE.length);
    for (const marker of markers) {
      expect(marker.options.interactive).not.toBe(false);
      expect(marker.options.renderer).toBe(renderer);
      // The hit area covers the icon's housing at this zoom (Leaflet tests the circle).
      expect(marker.getRadius() * 2).toBeGreaterThanOrEqual((MACHINE_HOUSING.width * iconPx(map.getZoom())) / STATION_VIEWBOX);
    }
  });

  it("returns a cleanup that removes everything it drew", () => {
    buildingsLayer.draw(context(), factory([...ONE_PER_STATE, BACKED_UP]))();
    let left = 0;
    map.eachLayer((layer) => {
      if (layer instanceof L.Path) left++;
    });
    expect(left).toBe(0);
  });

  it("builds tooltips from text nodes: a building name is never parsed as HTML", () => {
    const hostile = building(0, { name: '<img src=x onerror="alert(1)">', recipe: "<b>Plate</b>", production: running });
    buildingsLayer.draw(context(), factory([hostile]));
    let tip: HTMLElement | undefined;
    map.eachLayer((layer) => {
      if (layer instanceof L.CircleMarker && layer.getTooltip()) {
        layer.openTooltip();
        tip = layer.getTooltip()!.getElement();
      }
    });
    expect(tip!.querySelector("img, b")).toBeNull();
    expect(tip!.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(tip!.textContent).toContain("<b>Plate</b>");
  });
});

/** Lets the repaints a zoom or a removal queued run on the stub. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("buildingsLayer.draw: the backed-up ring", () => {
  it("draws a still warn ring for a backed-up machine only, at the zoom's size, with no frame loop or timer", async () => {
    const setTimer = vi.spyOn(globalThis, "setTimeout");
    const setTick = vi.spyOn(globalThis, "setInterval");
    // A first draw starts jsdom's own frame timer (Leaflet's repaint); after that the ring adds no timer.
    buildingsLayer.draw(context(), factory(ONE_PER_STATE))();
    setTimer.mockClear();
    setTick.mockClear();
    const cleanup = buildingsLayer.draw(context(), factory([...ONE_PER_STATE, BACKED_UP]));
    expect(setTimer).not.toHaveBeenCalled();
    expect(setTick).not.toHaveBeenCalled();
    setTimer.mockRestore();
    setTick.mockRestore();
    for (const zoom of [-5, 3]) {
      // Centred on the backed-up machine, so it is in view (and painted) at every zoom.
      map.setView([-20, BACKED_UP.location!.xM], zoom, { animate: false });
      expect(rings(paint())).toEqual([{ radius: ringRadius(iconPx(zoom)), color: "WARN", alpha: 1 }]);
    }
    // Nothing re-arms itself: no animation frame of ours.
    expect(requestFrame).not.toHaveBeenCalled();
    cleanup();
    await settle();
  });

  it("draws no ring when no machine is backed up, at either zoom", async () => {
    const cleanup = buildingsLayer.draw(context(), factory(ONE_PER_STATE));
    for (const zoom of [-5, 3]) {
      map.setView([-20, 0], zoom, { animate: false });
      expect(rings(paint())).toEqual([]);
    }
    expect(requestFrame).not.toHaveBeenCalled();
    cleanup();
    await settle();
  });

  it("keeps the ring in proportion to the icon at every zoom", async () => {
    const cleanup = buildingsLayer.draw(context(), factory([BACKED_UP]));
    const ratio = (zoom: number) => {
      map.setZoom(zoom, { animate: false });
      return markersOf().find((m) => m.options.interactive === false)!._radius / iconPx(zoom);
    };
    expect(ratio(-5)).toBeCloseTo(ratio(3), 10);
    expect(ringReach(ICON_MAX_PX)).toBeCloseTo(ringReach(ICON_MIN_PX) * (ICON_MAX_PX / ICON_MIN_PX), 10);
    cleanup();
    await settle();
  });
});

describe("buildingsLayer.legend", () => {
  it("names each state with the same machine icon in its colour, and the ringed backed-up icon", () => {
    render(buildingsLayer.legend() as ReactElement);
    const expected: [RegExp, string][] = [
      [/^Producing$/, "fill-ok"],
      [/^Not producing$/, "fill-muted"],
      [/^Paused$/, "fill-info"],
      [/^No recipe$/, "fill-none"],
      [/^Backed up/, "fill-warn"],
    ];
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(expected.length);
    expected.forEach(([label, fill], i) => {
      const item = items[i];
      expect(within(item).getByText(label)).toBeInTheDocument();
      const housing = item.querySelector("svg rect")!;
      expect(housing).toHaveClass(fill);
      expect(housing).toHaveAttribute("x", String(MACHINE_HOUSING.x));
      expect(housing).toHaveAttribute("width", String(MACHINE_HOUSING.width));
    });
    expect(items[4].querySelector("svg polygon")).not.toBeNull();
    expect(items[4]).toHaveTextContent("Backed up (a ring marks it)");
    // No recipe is hollow as on the canvas: an outline in muted, no window; the others no outline.
    items.forEach((item, i) => {
      const housing = item.querySelector("svg rect")!;
      if (i === 3) {
        expect(housing).toHaveClass("stroke-muted");
        expect(item.querySelectorAll("svg rect, svg polygon")).toHaveLength(1);
      } else expect(housing.getAttribute("class")).not.toMatch(/stroke-/);
    });
  });
});

/** The Leaflet 1.9 private members buildingsLayer.tsx relies on (CanvasInternals, drawnMarker). */
interface Private {
  _radius: number;
  _renderer: unknown;
  _point: L.Point;
  _empty(): boolean;
  _containsPoint(p: L.Point): boolean;
}
const markersOf = () => {
  const found: (L.CircleMarker & Private)[] = [];
  map.eachLayer((layer) => {
    if (layer instanceof L.CircleMarker) found.push(layer as L.CircleMarker & Private);
  });
  return found;
};

describe("buildingsLayer: the Leaflet 1.9.4 internals it relies on fail loudly on an upgrade", () => {
  it("is built against the pinned Leaflet and its private canvas hooks", () => {
    expect(L.version).toBe("1.9.4");
    const marker = L.CircleMarker.prototype as unknown as Record<string, unknown>;
    // The override point and what the paint hook reads.
    for (const name of ["_updatePath", "_empty", "_containsPoint", "_project"]) expect(typeof marker[name]).toBe("function");
    const canvas = L.Canvas.prototype as unknown as Record<string, unknown>;
    // The renderer's draw loop calls layer._updatePath() under _drawing; redraw() goes through _updatePath(layer).
    for (const name of ["_draw", "_redraw", "_updatePath", "_updateCircle"]) expect(typeof canvas[name]).toBe("function");
  });

  it("gives a drawn marker the renderer, its 2D context, its point and the _drawing flag it reads", () => {
    buildingsLayer.draw(context(), factory([BACKED_UP]));
    const marker = markersOf().find((m) => m.options.interactive !== false)!;
    const internals = renderer as unknown as { _drawing: boolean; _ctx: unknown };
    expect(marker._renderer).toBe(renderer);
    expect(internals._ctx).toBe(recorder.ctx);
    expect(internals._drawing).toBe(false);
    expect(marker._point).toBeInstanceOf(L.Point);
    expect(marker._empty()).toBe(false);
    // The paint hook only runs inside the renderer's draw pass: drawing is on then, and off after.
    paint();
    expect(internals._drawing).toBe(false);
  });
});

describe("buildingsLayer: hit-testing after the shape change", () => {
  const hitMarkers = () => markersOf().filter((m) => m.options.interactive !== false);

  for (const zoom of [-5, 0, 5]) {
    it(`hits an icon near its centre and not 40 px away, at zoom ${zoom}`, async () => {
      const cleanup = buildingsLayer.draw(context(), factory([...ONE_PER_STATE, BACKED_UP]));
      // Centred on the first icon, so it is in view (and painted) at every zoom.
      map.setView([-20, 0], zoom, { animate: false });
      const hits = hitMarkers();
      expect(hits).toHaveLength(ONE_PER_STATE.length + 1);
      // The icon is drawn at the zoom's size, and the hit circle matches it.
      const size = iconPx(zoom);
      const radius = hitRadius(size);
      expect(size).toBe(zoom < 0 ? ICON_MIN_PX : zoom > 0 ? ICON_MAX_PX : iconPx(0));
      for (const marker of hits) {
        expect(marker._radius).toBe(radius);
        expect(marker._containsPoint(marker._point)).toBe(true);
        expect(marker._containsPoint(marker._point.add([radius - 1, 0]))).toBe(true);
        // Just past the edge: Leaflet adds its click tolerance (stroke off: the renderer's, 0 for a mouse).
        expect(marker._containsPoint(marker._point.add([radius + 2, 0]))).toBe(false);
        expect(marker._containsPoint(marker._point.add([40, 0]))).toBe(false);
      }
      // The paint pass scales the 48-unit housing to that size.
      const scales = paint()
        .filter((c) => c.op === "scale")
        .map((c) => c.args[0]);
      expect(scales).toContain(size / STATION_VIEWBOX);
      // The rings reach round the icon at that size, and never catch the pointer.
      const ring = markersOf().find((m) => m.options.interactive === false)!;
      expect(ring._radius).toBe(ringReach(size));
      cleanup();
      await new Promise((resolve) => setTimeout(resolve, 50)); // let the repaints the zoom and removal queued run on the stub
    });
  }

  it("never lets the rings catch the pointer: they are not interactive", () => {
    buildingsLayer.draw(context(), factory([BACKED_UP]));
    const rings = markersOf().filter((m) => m.options.interactive === false);
    expect(rings).toHaveLength(1);
    expect(rings[0].getTooltip()).toBeUndefined();
    expect(hitMarkers()).toHaveLength(1);
  });

  it("shows the tooltip content for a backed-up machine", () => {
    buildingsLayer.draw(context(), factory([BACKED_UP]));
    const marker = hitMarkers()[0];
    marker.openTooltip();
    expect(marker.getTooltip()!.getElement()!.textContent).toContain("Backed up");
  });
});

describe("buildingsLayer: the ring's lifecycle", () => {
  it("asks for no frame however many machines are backed up", () => {
    const many = Array.from({ length: 300 }, (_, i) => building(i, { recipe: "Screw", production: running, isBackedUp: true, state: "backedUp", location: { xM: (i % 20) * 8, yM: Math.floor(i / 20) * 8, zM: 0, rotationDeg: 0 } }));
    buildingsLayer.draw(context(), factory(many));
    expect(requestFrame).not.toHaveBeenCalled();
    expect(rings(paint())).toHaveLength(300);
  });

  it("draws no ring in the next draw when the last backed-up machine cleared", () => {
    const cleanup = buildingsLayer.draw(context(), factory([BACKED_UP]));
    cleanup();
    buildingsLayer.draw(context(), factory([{ ...BACKED_UP, isBackedUp: false, state: "producing" }]));
    expect(requestFrame).not.toHaveBeenCalled();
    expect(frames).toHaveLength(0);
    expect(rings(paint())).toEqual([]);
  });

  it("is safe to clean up twice", () => {
    const cleanup = buildingsLayer.draw(context(), factory([BACKED_UP]));
    cleanup();
    expect(() => cleanup()).not.toThrow();
  });

  it("is a no-op for an empty factory", () => {
    const cleanup = buildingsLayer.draw(context(), factory([]));
    expect(requestFrame).not.toHaveBeenCalled();
    cleanup();
  });

  it("listens to nothing, motion setting included, however many machines are backed up", () => {
    const query = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const matchMedia = vi.fn(() => query);
    vi.stubGlobal("matchMedia", matchMedia);
    const cleanup = buildingsLayer.draw(context(), factory([BACKED_UP]));
    cleanup();
    expect(matchMedia).not.toHaveBeenCalled();
    expect(query.addEventListener).not.toHaveBeenCalled();
  });
});

describe("buildingsLayer: icons scale with the zoom", () => {
  it("grows the icons, hit circles and rings when zooming in, at no cost beyond Leaflet's own reprojection", async () => {
    map.setZoom(-5, { animate: false });
    buildingsLayer.draw(context(), factory([...ONE_PER_STATE, BACKED_UP]));
    const radii = () => markersOf().map((m) => m._radius);
    const small = radii();
    map.setZoom(-1.5, { animate: false });
    const middle = radii();
    map.setZoom(3, { animate: false });
    const large = radii();
    small.forEach((r, i) => {
      expect(middle[i]).toBeGreaterThan(r);
      expect(large[i]).toBeGreaterThan(middle[i]);
    });
    expect(iconPx(-1.5)).toBeGreaterThan(ICON_MIN_PX);
    expect(iconPx(-1.5)).toBeLessThan(ICON_MAX_PX);
    // The size starts no frame loop of its own, and neither does the ring.
    expect(requestFrame).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 50)); // let the repaints the zooms queued run on the stub
  });
});

describe("buildingsLayer: the ring's own canvas", () => {
  it("repaints only the rings, on their own canvas: never the icons or the grid on the shared one", () => {
    // Scattered backed-up machines: their redraw areas would union into nearly the whole map.
    const scattered = [0, 1, 2, 3].map((i) =>
      building(i, { recipe: "Screw", production: running, isBackedUp: true, state: "backedUp", location: { xM: i % 2 ? 180 : -180, yM: i < 2 ? -130 : 130, zM: 0, rotationDeg: 0 } }),
    );
    buildingsLayer.draw(context(), factory([...ONE_PER_STATE, ...scattered]));
    paint();
    const shared = renderer as unknown as RendererInternals;
    const ringCanvas = renderers().find((r) => r !== renderer)!;
    expect(ringCanvas).toBeDefined();

    // Nothing is queued on the shared canvas, and no frame is waiting.
    expect(shared._redrawRequest).toBeNull();
    expect(shared._redrawBounds).toBeNull();
    expect(frames).toHaveLength(0);
    // The ring canvas's repaint draws exactly one arc per backed-up machine, and no icon.
    const calls = paint(ringCanvas);
    expect(rings(calls)).toHaveLength(scattered.length);
    expect(calls.filter((c) => c.op === "roundRect" || c.op === "lineTo")).toEqual([]);
  });

  it("keeps the ring canvas below the icons' canvas, so it never takes the pointer", () => {
    buildingsLayer.draw(context(), factory([BACKED_UP]));
    const ringCanvas = renderers().find((r) => r !== renderer)!;
    expect(ringCanvas.getPane()).toBe(map.getPane("tilePane"));
    expect(renderer.getPane()).toBe(map.getPane("overlayPane"));
  });

  it("adds no extra canvas without a backed-up machine, and removes its own with the layer", () => {
    buildingsLayer.draw(context(), factory(ONE_PER_STATE));
    expect(renderers()).toEqual([renderer]);
    const cleanup = buildingsLayer.draw(context(), factory([BACKED_UP]));
    expect(renderers()).toHaveLength(2);
    const ringCanvas = renderers().find((r) => r !== renderer)! as unknown as RendererInternals;
    cleanup();
    expect(renderers()).toEqual([renderer]);
    // A repaint Leaflet lost track of, running after the removal, does nothing.
    expect(() => ringCanvas._redraw()).not.toThrow();
  });
});
