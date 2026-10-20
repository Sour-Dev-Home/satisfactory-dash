import { factoryMixed } from "@satisfactory-dash/shared/fixtures";
import type { Factory, FactoryBuilding } from "@satisfactory-dash/shared";
import { render, screen, within } from "@testing-library/react";
import * as L from "leaflet";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MACHINE_HOUSING, MACHINE_WINDOW } from "../ui/stationShapes";
import { buildingsLayer } from "./buildingsLayer";
import type { MapContext } from "./layers";
import { ICON_SCALE } from "./machineIcon";

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
  map = L.map(host, { crs: L.CRS.Simple, renderer }).setView([0, 0], 0);
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

function context(pulse = "1.6s"): MapContext {
  const token = (name: string) => (name === "--duration-pulse" ? pulse : (COLORS.get(name) ?? ""));
  return { L, map, renderer, project: (x, y) => [-y, x], color: token, token };
}

/** Leaflet draws on its next frame; run it now, from a clean record. */
function paint() {
  recorder.calls.length = 0;
  const internals = renderer as unknown as { _redraw: () => void; _redrawRequest: number | null };
  // Cancel the frame Leaflet queued, or it would run after the map is gone.
  L.Util.cancelAnimFrame(internals._redrawRequest ?? 0);
  internals._redraw();
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
const BACKED_UP = building(4, { recipe: "Screw", production: running, isBackedUp: true });

const isRect = (call: Call, shape: { x: number; y: number; width: number; height: number }) =>
  call.op === "roundRect" && call.args[0] === shape.x && call.args[1] === shape.y && call.args[2] === shape.width && call.args[3] === shape.height;
/** The colour each housing (or window) was filled with, in draw order. */
const fillsOf = (calls: Call[], shape: typeof MACHINE_HOUSING) =>
  calls.flatMap((call, i) => (isRect(call, shape) ? [calls.slice(i).find((c) => c.op === "fill")!.fillStyle] : []));
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
    expect(fillsOf(calls, MACHINE_HOUSING)).toEqual(["OK", "MUTED", "INFO", "LINE"]);
    // The centre mark: the machine's window, in the canvas colour.
    expect(fillsOf(calls, MACHINE_WINDOW)).toEqual(["CANVAS", "CANVAS", "CANVAS", "CANVAS"]);
    // Drawn on the canvas, not DOM: no marker elements, no SVG renderer. No ring without a backed-up machine.
    expect(host.querySelector(".leaflet-marker-icon, .leaflet-overlay-pane svg")).toBeNull();
    expect(host.querySelector(".leaflet-overlay-pane canvas")).not.toBeNull();
    expect(rings(calls)).toEqual([]);
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
      // The hit area covers the icon's housing (Leaflet tests the circle).
      expect(marker.getRadius() * 2).toBeGreaterThanOrEqual(MACHINE_HOUSING.width * ICON_SCALE);
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

describe("buildingsLayer.draw: the backed-up pulse", () => {
  it("runs no animation frame loop when no machine is backed up", () => {
    const cleanup = buildingsLayer.draw(context(), factory(ONE_PER_STATE));
    expect(requestFrame).not.toHaveBeenCalled();
    cleanup();
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it("pulses a backed-up machine: a warn ring that grows and fades, about 1.6 s a cycle", () => {
    buildingsLayer.draw(context(), factory([...ONE_PER_STATE, BACKED_UP]));
    expect(requestFrame).toHaveBeenCalledTimes(1);

    frames.shift()!(0);
    const start = rings(paint());
    frames.shift()!(800);
    const middle = rings(paint());
    frames.shift()!(1500);
    const late = rings(paint());

    for (const ring of [...start, ...middle, ...late]) expect(ring.color).toBe("WARN");
    expect(start).toHaveLength(1);
    expect(middle[0].radius).toBeGreaterThan(start[0].radius);
    expect(middle[0].alpha).toBeLessThan(start[0].alpha as number);
    expect(late[0].radius).toBeGreaterThan(middle[0].radius);
    // A cycle is 1.6 s: at 1.6 s it starts over, small and opaque again.
    frames.shift()!(1600);
    expect(rings(paint())).toEqual(start);
    // Still looping: each frame asks for the next.
    expect(frames).toHaveLength(1);
  });

  it("stops the loop when the layer is removed", () => {
    const cleanup = buildingsLayer.draw(context(), factory([BACKED_UP]));
    frames.shift()!(0);
    cleanup();
    expect(cancelFrame).toHaveBeenCalled();
    // A frame already queued doesn't start it again.
    frames.shift()?.(16);
    expect(frames).toHaveLength(0);
  });

  it("shows the ring still under reduced motion (the motion tokens are 0): no loop", () => {
    buildingsLayer.draw(context("0s"), factory([BACKED_UP]));
    expect(requestFrame).not.toHaveBeenCalled();
    const still = rings(paint());
    expect(still).toHaveLength(1);
    expect(still[0].color).toBe("WARN");
    expect(still[0].alpha).toBeGreaterThan(0);
  });

  it("reads the cycle from the token, in ms or s", () => {
    buildingsLayer.draw(context("1600ms"), factory([BACKED_UP]));
    frames.shift()!(0);
    const start = rings(paint());
    frames.shift()!(1600);
    expect(rings(paint())).toEqual(start);
  });
});

describe("buildingsLayer.legend", () => {
  it("names each state with the same machine icon in its colour, and the pulsing backed-up icon", () => {
    render(buildingsLayer.legend() as ReactElement);
    const expected: [RegExp, string][] = [
      [/^Producing$/, "fill-ok"],
      [/^Not producing$/, "fill-muted"],
      [/^Paused$/, "fill-info"],
      [/^No recipe$/, "fill-line"],
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
    expect(items[4]).toHaveTextContent(/pulses/);
  });
});

/** The Leaflet 1.9 private members buildingsLayer.tsx relies on (CanvasInternals, drawnMarker). */
interface Private {
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
    const [marker] = markersOf();
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
      map.setZoom(zoom, { animate: false });
      const hits = hitMarkers();
      expect(hits).toHaveLength(ONE_PER_STATE.length + 1);
      for (const marker of hits) {
        expect(marker._containsPoint(marker._point)).toBe(true);
        expect(marker._containsPoint(marker._point.add([9, 0]))).toBe(true);
        expect(marker._containsPoint(marker._point.add([40, 0]))).toBe(false);
      }
      cleanup();
      await new Promise((resolve) => setTimeout(resolve, 50)); // let the repaints the zoom and removal queued run on the stub
    });
  }

  it("never lets the pulse rings catch the pointer: they are not interactive", () => {
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

describe("buildingsLayer: the pulse loop's lifecycle", () => {
  it("asks for one frame at a time however many machines are backed up", () => {
    const many = Array.from({ length: 300 }, (_, i) => building(i, { recipe: "Screw", production: running, isBackedUp: true, location: { xM: (i % 20) * 8, yM: Math.floor(i / 20) * 8, zM: 0, rotationDeg: 0 } }));
    buildingsLayer.draw(context(), factory(many));
    expect(requestFrame).toHaveBeenCalledTimes(1);
    frames.shift()!(0);
    expect(requestFrame).toHaveBeenCalledTimes(2);
    expect(frames).toHaveLength(1);
    expect(rings(paint())).toHaveLength(300);
  });

  it("starts no loop again when the next draw has no backed-up machine, after the last one cleared", () => {
    const cleanup = buildingsLayer.draw(context(), factory([BACKED_UP]));
    frames.shift()!(0);
    cleanup();
    expect(cancelFrame).toHaveBeenCalledTimes(1);
    frames.length = 0; // the mock does not drop the cancelled frame
    requestFrame.mockClear();
    buildingsLayer.draw(context(), factory([{ ...BACKED_UP, isBackedUp: false }]));
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

  it("treats an unreadable pulse token as no animation (ring shown still)", () => {
    buildingsLayer.draw(context(""), factory([BACKED_UP]));
    expect(requestFrame).not.toHaveBeenCalled();
    expect(rings(paint())).toHaveLength(1);
  });

  // KNOWN BUG (reported): the duration token is read once at draw time, so switching reduced
  // motion on while a machine pulses leaves the loop running until the layer is redrawn.
  it.fails("stops the loop when reduced motion is switched on while it runs", () => {
    let pulse = "1.6s";
    const ctx = { ...context(), token: (name: string) => (name === "--duration-pulse" ? pulse : (COLORS.get(name) ?? "")) };
    buildingsLayer.draw(ctx, factory([BACKED_UP]));
    frames.shift()!(0);
    pulse = "0s"; // the OS setting changed at runtime
    frames.shift()!(16);
    expect(frames).toHaveLength(0);
  });
});
