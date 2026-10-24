import { describe, expect, it } from "vitest";
import { MAX_ZOOM, MIN_ZOOM, STAGE_H, STAGE_W, fitView, keyView, panBy, revealRect, toStage, zoomAt, zoomCentre } from "./viewport";

const home = { x: 0, y: 0, k: 1 };

describe("viewport", () => {
  it("zooms about a point, which stays where it is", () => {
    const v = zoomAt({ x: 10, y: 20, k: 1 }, 2, 300, 200);
    expect(v.k).toBe(2);
    // The layout point under (300, 200) before is (290, 180); it is still drawn at (300, 200).
    expect(v.x + v.k * 290).toBeCloseTo(300);
    expect(v.y + v.k * 180).toBeCloseTo(200);
  });

  it("clamps the zoom", () => {
    expect(zoomCentre(home, 1000).k).toBe(MAX_ZOOM);
    expect(zoomCentre(home, 1e-6).k).toBe(MIN_ZOOM);
  });

  it("fits a drawing into the stage, centred, and does not enlarge a small one", () => {
    const big = fitView(STAGE_W * 2, STAGE_H);
    expect(big.k).toBeCloseTo(0.5);
    expect(big.x).toBeCloseTo(0);
    expect(big.y).toBeCloseTo((STAGE_H - STAGE_H * 0.5) / 2);
    expect(fitView(100, 100)).toEqual({ k: 1, x: (STAGE_W - 100) / 2, y: (STAGE_H - 100) / 2 });
    expect(fitView(0, 0)).toEqual(home);
  });

  it("maps keys to moves: + - zoom, arrows pan the picture the way the arrow points the view, 0 fits", () => {
    const fit = { x: 5, y: 5, k: 0.5 };
    expect(keyView(home, "+", fit)!.k).toBeGreaterThan(1);
    expect(keyView(home, "-", fit)!.k).toBeLessThan(1);
    expect(keyView(home, "0", fit)).toBe(fit);
    expect(keyView(home, "ArrowRight", fit)!.x).toBeLessThan(0);
    expect(keyView(home, "ArrowLeft", fit)!.x).toBeGreaterThan(0);
    expect(keyView(home, "ArrowDown", fit)!.y).toBeLessThan(0);
    expect(keyView(home, "ArrowUp", fit)!.y).toBeGreaterThan(0);
    expect(keyView(home, "a", fit)).toBeNull();
    expect(keyView(home, "Enter", fit)).toBeNull();
  });

  it("pans by a delta", () => {
    expect(panBy(home, 5, -3)).toEqual({ x: 5, y: -3, k: 1 });
  });

  it("converts a pointer to stage units, allowing for bars when the element is not 5:3", () => {
    const wide = { left: 100, top: 50, width: 2000, height: 600 };
    // scale = min(2, 1) = 1; the stage is centred: bars of 500 px each side.
    const p = toStage(wide, 100 + 500 + 250, 50 + 300);
    expect(p).toEqual({ x: 250, y: 300, scale: 1 });
    expect(toStage({ left: 0, top: 0, width: 0, height: 0 }, 7, 8)).toEqual({ x: 7, y: 8, scale: 1 });
  });

  it("reveals a rectangle with the least move, and leaves a visible one alone", () => {
    const inside = { x: 100, y: 100, width: 50, height: 50 };
    expect(revealRect(home, inside)).toBe(home);
    const right = revealRect(home, { x: STAGE_W + 100, y: 100, width: 100, height: 50 });
    expect(right.x).toBeLessThan(0);
    expect(right.x + (STAGE_W + 200)).toBeLessThanOrEqual(STAGE_W);
    expect(right.y).toBe(0);
    expect(revealRect(home, { x: -200, y: -50, width: 100, height: 40 })).toMatchObject({ x: 224, y: 74 });
  });
});
