import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GRID_BASE_MAP } from "./projection";
import MapCanvas, { type ViewM } from "./MapCanvas";

/**
 * jsdom has no <canvas> 2D context; Leaflet's canvas renderer needs one just to add its grid
 * lines (drawGrid runs unconditionally). A no-op stub is enough: nothing here asserts on pixels.
 */
function stubCanvasContext() {
  const noop = () => {};
  const ctx = new Proxy(
    {},
    {
      get: (_target, prop) => (prop in { canvas: 1 } ? undefined : noop),
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
