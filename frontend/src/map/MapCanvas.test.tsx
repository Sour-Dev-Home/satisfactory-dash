import { render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GRID_BASE_MAP } from "./projection";
import MapCanvas, { type DrawnLayer, type ViewM } from "./MapCanvas";

/**
 * jsdom has no <canvas> 2D context; Leaflet's canvas renderer needs one just to add its grid
 * lines (drawGrid runs unconditionally). A no-op stub is enough: nothing here asserts on pixels.
 */
function stubCanvasContext() {
  const noop = () => {};
  const ctx = new Proxy(
    {},
    {
      get: (_target, prop) => (prop === "canvas" ? undefined : noop),
    },
  );
  const original = HTMLCanvasElement.prototype.getContext;
  // @ts-expect-error -- test-only stub, not a real CanvasRenderingContext2D
  HTMLCanvasElement.prototype.getContext = () => ctx;
  return () => {
    HTMLCanvasElement.prototype.getContext = original;
  };
}

/**
 * MapCanvas draws with real Leaflet (a stubbed 2D context: see above). Unlike MapPanel.test.tsx,
 * which stubs this module out entirely, these tests exercise the real map lifecycle.
 */
describe("MapCanvas fitTo (ADR-0023 decision 3)", () => {
  let restoreCanvas: () => void;
  beforeEach(() => {
    restoreCanvas = stubCanvasContext();
  });
  afterEach(() => {
    restoreCanvas();
  });

  it("centers on a fitTo extent that lies outside GRID_BASE_MAP.worldBoundsM", async () => {
    // A save whose factory sits outside the assumed 7,500 m square (ADR-0023's bounds are the
    // owner's one measured base, "approximate until checked in game" for anyone else's).
    const farBuilding = { xM: 20000, yM: 20000 };
    const onView = vi.fn();
    render(
      <MapCanvas
        config={GRID_BASE_MAP}
        layers={[]}
        fitTo={{ minX: farBuilding.xM, maxX: farBuilding.xM, minY: farBuilding.yM, maxY: farBuilding.yM }}
        onView={onView}
      />,
    );

    const reported = onView.mock.calls.at(-1)?.[0] as ViewM | undefined;
    expect(reported).toBeDefined();
    // BUG: `maxBounds` (built from the static, unverified worldBoundsM) clamps the initial
    // fitBounds to the nearest corner of that box instead of showing the factory. The reported
    // view ends up nowhere near the building it was supposed to fit to, with no error or
    // indication to the user that their factory is off the assumed map.
    expect(reported!.minX).toBeLessThanOrEqual(farBuilding.xM);
    expect(reported!.maxX).toBeGreaterThanOrEqual(farBuilding.xM);
    expect(reported!.minY).toBeLessThanOrEqual(farBuilding.yM);
    expect(reported!.maxY).toBeGreaterThanOrEqual(farBuilding.yM);
  });
});

describe("MapCanvas layer redraws (ADR-0038 M6)", () => {
  let restoreCanvas: () => void;
  beforeEach(() => {
    restoreCanvas = stubCanvasContext();
  });
  afterEach(() => {
    restoreCanvas();
  });

  /** A layer that logs its draws and cleanups. */
  function logged(id: string, log: string[]): DrawnLayer {
    return {
      id,
      draw: () => {
        log.push(`draw ${id}`);
        return () => log.push(`clean ${id}`);
      },
    };
  }
  const props = { config: GRID_BASE_MAP, onView: () => {} };

  it("redraws only the layers from the first changed one upward, top first on the way out", () => {
    const log: string[] = [];
    const [rails, buildings, trains] = [logged("rails", log), logged("buildings", log), logged("trains", log)];
    const { rerender } = render(<MapCanvas {...props} layers={[rails, buildings, trains]} />);
    expect(log).toEqual(["draw rails", "draw buildings", "draw trains"]);

    log.length = 0;
    const trains2 = logged("trains", log);
    rerender(<MapCanvas {...props} layers={[rails, buildings, trains2]} />);
    expect(log).toEqual(["clean trains", "draw trains"]);

    log.length = 0;
    const buildings2 = logged("buildings", log);
    rerender(<MapCanvas {...props} layers={[rails, buildings2, trains2]} />);
    expect(log).toEqual(["clean trains", "clean buildings", "draw buildings", "draw trains"]);
  });

  it("does nothing for a new array of the same layers, removes a layer that was dropped, and cleans up on unmount", () => {
    const log: string[] = [];
    const [rails, trains] = [logged("rails", log), logged("trains", log)];
    const { rerender, unmount } = render(<MapCanvas {...props} layers={[rails, trains]} />);
    log.length = 0;
    rerender(<MapCanvas {...props} layers={[rails, trains]} />);
    expect(log).toEqual([]);
    rerender(<MapCanvas {...props} layers={[rails]} />);
    expect(log).toEqual(["clean trains"]);
    log.length = 0;
    unmount();
    expect(log).toEqual(["clean rails"]);
  });

  it("under StrictMode every draw is matched by a cleanup, and what remains is drawn once", () => {
    const log: string[] = [];
    const layers = [logged("rails", log), logged("trains", log)];
    const { unmount } = render(
      <StrictMode>
        <MapCanvas {...props} layers={layers} />
      </StrictMode>,
    );
    const live = () => log.filter((l) => l.startsWith("draw")).length - log.filter((l) => l.startsWith("clean")).length;
    expect(live()).toBe(2);
    unmount();
    expect(live()).toBe(0);
  });

  it("redraws every layer when the config changes (a new map), cleaning the old ones first", () => {
    const log: string[] = [];
    const layers = [logged("rails", log), logged("trains", log)];
    const { rerender, unmount } = render(<MapCanvas {...props} layers={layers} />);
    log.length = 0;
    rerender(<MapCanvas {...props} config={{ ...GRID_BASE_MAP }} layers={layers} />);
    expect(log.filter((l) => l.startsWith("clean")).sort()).toEqual(["clean rails", "clean trains"]);
    expect(log.filter((l) => l.startsWith("draw")).sort()).toEqual(["draw rails", "draw trains"]);
    expect(log.lastIndexOf("clean rails")).toBeLessThan(log.indexOf("draw rails"));
    unmount();
  });

});
