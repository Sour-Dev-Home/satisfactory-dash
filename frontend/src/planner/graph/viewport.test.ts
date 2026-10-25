import { describe, expect, it } from "vitest";
import { FALLBACK_STAGE, FIT_PAD, MAX_ZOOM, MIN_FIT_ZOOM, MIN_ZOOM, canvasHeight, clippedEdges, fitView, isClipped, stageBesidePanel, keyView, panBy, pinchView, revealRect, toStage, zoomAt, zoomCentre } from "./viewport";

const home = { x: 0, y: 0, k: 1 };
const stage = FALLBACK_STAGE;

describe("viewport", () => {
  it("zooms about a point, which stays where it is", () => {
    const v = zoomAt({ x: 10, y: 20, k: 1 }, 2, 300, 200);
    expect(v.k).toBe(2);
    // The layout point under (300, 200) before is (290, 180); it is still drawn at (300, 200).
    expect(v.x + v.k * 290).toBeCloseTo(300);
    expect(v.y + v.k * 180).toBeCloseTo(200);
  });

  it("clamps the zoom", () => {
    expect(zoomCentre(home, 1000, stage).k).toBe(MAX_ZOOM);
    expect(zoomCentre(home, 1e-6, stage).k).toBe(MIN_ZOOM);
    // Manual zoom may go below the fit floor.
    expect(MIN_ZOOM).toBeLessThan(MIN_FIT_ZOOM);
  });

  it("fits a drawing that is a little too big by scaling it down, centred", () => {
    const k = (stage.width - 2 * FIT_PAD) / 1100;
    expect(k).toBeGreaterThan(MIN_FIT_ZOOM);
    const v = fitView(1100, 200, stage);
    expect(v.k).toBeCloseTo(k);
    expect(v.x).toBeCloseTo(FIT_PAD);
    expect(v.y).toBeCloseTo((stage.height - 200 * k) / 2);
  });

  it("never enlarges a small drawing past 1:1, and centres it", () => {
    expect(fitView(100, 100, stage)).toEqual({ k: 1, x: (stage.width - 100) / 2, y: (stage.height - 100) / 2 });
    expect(fitView(0, 0, stage)).toEqual(home);
  });

  it("never fits below the readable floor, and anchors a too-wide drawing at its left", () => {
    const v = fitView(5000, 200, stage);
    expect(v.k).toBe(MIN_FIT_ZOOM);
    expect(v.x).toBe(FIT_PAD);
    expect(v.y).toBeCloseTo((stage.height - 200 * MIN_FIT_ZOOM) / 2);
    const tall = fitView(300, 5000, stage);
    expect(tall.k).toBe(MIN_FIT_ZOOM);
    expect(tall.y).toBe(FIT_PAD);
    expect(tall.x).toBeCloseTo((stage.width - 300 * MIN_FIT_ZOOM) / 2);
  });

  it("sizes the canvas to the drawing at the fit scale, with padding", () => {
    expect(canvasHeight(400, 100, 1000)).toBe(100 + 2 * FIT_PAD);
    // Too wide for the floor: scaled to the floor and no further.
    expect(canvasHeight(5000, 1000, 1000)).toBe(Math.ceil(1000 * MIN_FIT_ZOOM + 2 * FIT_PAD));
    // Scaled down only as needed.
    expect(canvasHeight(1100, 1000, 1000)).toBe(Math.ceil(1000 * ((1000 - 2 * FIT_PAD) / 1100) + 2 * FIT_PAD));
    expect(canvasHeight(0, 0, 1000)).toBe(FALLBACK_STAGE.height);
  });

  it("maps keys to moves: + - zoom, arrows pan the picture the way the arrow points the view, 0 fits", () => {
    const fit = { x: 5, y: 5, k: 0.5 };
    expect(keyView(home, "+", fit, stage)!.k).toBeGreaterThan(1);
    expect(keyView(home, "-", fit, stage)!.k).toBeLessThan(1);
    expect(keyView(home, "0", fit, stage)).toBe(fit);
    expect(keyView(home, "ArrowRight", fit, stage)!.x).toBeLessThan(0);
    expect(keyView(home, "ArrowLeft", fit, stage)!.x).toBeGreaterThan(0);
    expect(keyView(home, "ArrowDown", fit, stage)!.y).toBeLessThan(0);
    expect(keyView(home, "ArrowUp", fit, stage)!.y).toBeGreaterThan(0);
    expect(keyView(home, "a", fit, stage)).toBeNull();
    expect(keyView(home, "Enter", fit, stage)).toBeNull();
  });

  it("pans by a delta", () => {
    expect(panBy(home, 5, -3)).toEqual({ x: 5, y: -3, k: 1 });
  });

  it("converts a pointer to stage units, allowing for bars when the element is not 5:3", () => {
    const wide = { left: 100, top: 50, width: 2000, height: 600 };
    // scale = min(2, 1) = 1; the stage is centred: bars of 500 px each side.
    const p = toStage(wide, stage, 100 + 500 + 250, 50 + 300);
    expect(p).toEqual({ x: 250, y: 300, scale: 1 });
    // A stage measured to the element is 1:1 with no bars.
    expect(toStage({ left: 10, top: 20, width: 800, height: 400 }, { width: 800, height: 400 }, 110, 70)).toEqual({ x: 100, y: 50, scale: 1 });
    expect(toStage({ left: 0, top: 0, width: 0, height: 0 }, stage, 7, 8)).toEqual({ x: 7, y: 8, scale: 1 });
  });

  it("reveals a rectangle with the least move, and leaves a visible one alone", () => {
    const inside = { x: 100, y: 100, width: 50, height: 50 };
    expect(revealRect(home, inside, stage)).toBe(home);
    const right = revealRect(home, { x: stage.width + 100, y: 100, width: 100, height: 50 }, stage);
    expect(right.x).toBeLessThan(0);
    expect(right.x + (stage.width + 200)).toBeLessThanOrEqual(stage.width);
    expect(right.y).toBe(0);
    expect(revealRect(home, { x: -200, y: -50, width: 100, height: 40 }, stage)).toMatchObject({ x: 224, y: 74 });
  });
});

describe("overflow", () => {
  const drawing = { width: 800, height: 400 };
  it("reports no clipped edge when the drawing is inside the stage, and none for an empty drawing", () => {
    const c = clippedEdges({ x: 100, y: 100, k: 1 }, drawing, stage);
    expect(c).toEqual({ left: false, right: false, top: false, bottom: false });
    expect(isClipped(c)).toBe(false);
    expect(isClipped(clippedEdges({ x: -500, y: 0, k: 1 }, { width: 0, height: 0 }, stage))).toBe(false);
  });

  it("reports each edge the drawing runs past", () => {
    expect(clippedEdges({ x: -50, y: 0, k: 1 }, drawing, stage)).toEqual({ left: true, right: false, top: false, bottom: false });
    expect(clippedEdges({ x: 300, y: 0, k: 1 }, drawing, stage)).toMatchObject({ right: true, left: false });
    expect(clippedEdges({ x: 0, y: -20, k: 1 }, drawing, stage)).toMatchObject({ top: true });
    expect(clippedEdges({ x: 0, y: 300, k: 1 }, drawing, stage)).toMatchObject({ bottom: true });
    // Zooming in grows the drawing past the stage on all sides.
    expect(isClipped(clippedEdges({ x: 0, y: 0, k: 2 }, drawing, stage))).toBe(true);
  });

  it("ignores a rounding error of a pixel", () => {
    expect(isClipped(clippedEdges({ x: -0.5, y: 0, k: 1 }, { width: 1000.5, height: 600 }, stage))).toBe(false);
  });

  it("a fit that reaches the floor clips the far edges only", () => {
    const big = { width: 3000, height: 2000 };
    const c = clippedEdges(fitView(big.width, big.height, stage), big, stage);
    expect(c).toEqual({ left: false, right: true, top: false, bottom: true });
  });

  it("leaves the part of the stage beside a drawer, never less than a pixel", () => {
    expect(stageBesidePanel(stage, 352)).toEqual({ width: stage.width - 352, height: stage.height });
    expect(stageBesidePanel(stage, 5000).width).toBe(1);
  });

  it("floors a fit at 0.6", () => {
    expect(MIN_FIT_ZOOM).toBe(0.6);
  });
});

describe("pinchView", () => {
  const at = (ax: number, ay: number, bx: number, by: number) => [{ x: ax, y: ay }, { x: bx, y: by }] as const;

  it("zooms by the change in finger distance, keeping the midpoint's layout point under it", () => {
    const view = { x: 10, y: 20, k: 1 };
    const out = pinchView(view, at(100, 100, 200, 100), at(50, 100, 250, 100));
    expect(out.k).toBeCloseTo(2);
    // The midpoint (150, 100) stays put, so the layout point under it is the same before and after.
    expect(out.x).toBeCloseTo(150 - (150 - view.x) * 2);
    expect(out.y).toBeCloseTo(100 - (100 - view.y) * 2);
  });

  it("pans with the midpoint when the distance is unchanged", () => {
    expect(pinchView({ x: 0, y: 0, k: 1.5 }, at(100, 100, 200, 100), at(130, 120, 230, 120))).toEqual({ k: 1.5, x: 30, y: 20 });
  });

  it("clamps the zoom to the same limits as the wheel", () => {
    expect(pinchView({ x: 0, y: 0, k: MAX_ZOOM }, at(0, 0, 10, 0), at(0, 0, 100, 0)).k).toBe(MAX_ZOOM);
    expect(pinchView({ x: 0, y: 0, k: MIN_ZOOM }, at(0, 0, 100, 0), at(0, 0, 10, 0)).k).toBe(MIN_ZOOM);
  });

  it("only pans when the fingers coincide", () => {
    expect(pinchView({ x: 0, y: 0, k: 1 }, at(5, 5, 5, 5), at(8, 5, 8, 5))).toEqual({ k: 1, x: 3, y: 0 });
  });
});
