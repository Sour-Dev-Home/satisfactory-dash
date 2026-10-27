import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OVERLAY_GAP, OVERLAY_MARGIN, OVERLAY_W, placeOverlay, screenRect, stageBesideOverlay, type ScreenRect } from "./overlayPlacement";

const css = readFileSync(join(import.meta.dirname, "..", "..", "index.css"), "utf8");
const stage = { width: 1200, height: 700 };
const m = OVERLAY_MARGIN;
const card = (left: number, top: number, width = 160, height = 80): ScreenRect => ({ left, top, width, height });
const overlaps = (p: { x: number; y: number; width: number; height: number }, a: ScreenRect) =>
  p.x < a.left + a.width && a.left < p.x + p.width && p.y < a.top + a.height && a.top < p.y + p.height;

describe("the floating card's width", () => {
  it("is the --spacing-graph-panel token, in px", () => {
    const match = /--spacing-graph-panel:\s*([\d.]+)rem/.exec(css);
    expect(match).not.toBeNull();
    expect(Number(match![1]) * 16).toBe(OVERLAY_W);
  });
});

describe("placeOverlay, wide", () => {
  it("sits right of the card, level with its top, and is as tall as its content", () => {
    const p = placeOverlay(card(100, 200), 240, stage, true);
    expect(p).toMatchObject({ side: "right", x: 260 + OVERLAY_GAP, y: 200, width: OVERLAY_W, height: 240, covers: false });
  });

  it("flips to the left when the right has no room", () => {
    const p = placeOverlay(card(900, 200), 240, stage, true);
    expect(p.side).toBe("left");
    expect(p.x).toBe(900 - OVERLAY_GAP - OVERLAY_W);
    expect(p.covers).toBe(false);
  });

  it("goes below, then above, when neither side has room", () => {
    const narrow = { width: 700, height: 700 };
    const below = placeOverlay(card(200, 50, 300, 100), 200, narrow, true);
    expect(below.side).toBe("below");
    expect(below.y).toBe(150 + OVERLAY_GAP);
    expect(overlaps(below, card(200, 50, 300, 100))).toBe(false);
    const above = placeOverlay(card(200, 500, 300, 100), 200, narrow, true);
    expect(above.side).toBe("above");
    expect(above.y + above.height).toBe(500 - OVERLAY_GAP);
    expect(above.covers).toBe(false);
  });

  it("clamps inside the stage: never past the bottom, the top or either side", () => {
    const low = placeOverlay(card(100, 650), 300, stage, true);
    expect(low.y + low.height).toBe(stage.height - m);
    const high = placeOverlay(card(100, -400), 300, stage, true);
    expect(high.y).toBe(m);
    // A card panned off the left edge: the floating card stays inside, at the margin.
    const off = placeOverlay(card(-500, 200), 300, stage, true);
    expect(off.x).toBe(m);
    expect(off.covers).toBe(false);
  });

  it("caps its height at the stage less the margins, and takes the most when not measured yet", () => {
    expect(placeOverlay(card(100, 200), 5000, stage, true)).toMatchObject({ height: stage.height - 2 * m, maxHeight: stage.height - 2 * m, y: m });
    expect(placeOverlay(card(100, 200), 0, stage, true).height).toBe(stage.height - 2 * m);
  });

  it("narrows to the stage on a small one", () => {
    expect(placeOverlay(card(0, 0, 10, 10), 100, { width: 300, height: 400 }, true).width).toBe(300 - 2 * m);
  });

  it("says it covers the card when no side has room, so the view can move", () => {
    const tight = { width: 600, height: 400 };
    const big = card(150, 50, 300, 300);
    const p = placeOverlay(big, 300, tight, true);
    expect(p.covers).toBe(true);
    expect(p.x).toBeGreaterThanOrEqual(m);
    expect(p.x + p.width).toBeLessThanOrEqual(tight.width - m);
  });

  it("sits in the top-right corner with no card to stand by", () => {
    expect(placeOverlay(null, 200, stage, true)).toMatchObject({ x: stage.width - m - OVERLAY_W, y: m, covers: false });
  });
});

describe("placeOverlay, below lg", () => {
  it("lies across the bottom of the canvas, at most half its height", () => {
    const p = placeOverlay(card(100, 100), 200, stage, false);
    expect(p).toMatchObject({ side: "bottom", x: m, width: stage.width - 2 * m, height: 200, y: stage.height - m - 200, covers: false });
    const tall = placeOverlay(card(100, 100), 5000, stage, false);
    expect(tall.height).toBe(stage.height / 2);
    expect(tall.y + tall.height).toBe(stage.height - m);
  });

  it("says it covers a card in the bottom half", () => {
    expect(placeOverlay(card(100, 600), 200, stage, false).covers).toBe(true);
  });
});

describe("screenRect and stageBesideOverlay", () => {
  it("puts a layout box on screen at the view", () => {
    expect(screenRect({ x: 10, y: 20, k: 2 }, { x: 5, y: 5, width: 50, height: 30 })).toEqual({ left: 20, top: 30, width: 100, height: 60 });
  });

  it("leaves the part left of a wide floating card, or above a bottom one", () => {
    const wide = placeOverlay(null, 200, stage, true);
    expect(stageBesideOverlay(wide, stage, true)).toEqual({ width: stage.width - OVERLAY_W - OVERLAY_GAP - m, height: stage.height });
    const bottom = placeOverlay(null, 200, stage, false);
    expect(stageBesideOverlay(bottom, stage, false)).toEqual({ width: stage.width, height: stage.height - 200 - OVERLAY_GAP - m });
  });
});
