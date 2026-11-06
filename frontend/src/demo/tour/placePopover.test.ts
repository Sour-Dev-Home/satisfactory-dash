import { describe, expect, it } from "vitest";
import { ARROW_SIZE, holePath, padBox, placePopover, POPOVER_MARGIN, sheetAtTop, type Box } from "./placePopover";

const viewport = { width: 1440, height: 900 };
const size = { width: 352, height: 200 };
const box = (x: number, y: number, width = 200, height = 100): Box => ({ x, y, width, height });

/** The popover stays inside the viewport by the margin. */
function inside(p: { x: number; y: number }, s = size, v = viewport) {
  expect(p.x).toBeGreaterThanOrEqual(POPOVER_MARGIN);
  expect(p.y).toBeGreaterThanOrEqual(POPOVER_MARGIN);
  expect(p.x + s.width).toBeLessThanOrEqual(v.width - POPOVER_MARGIN);
  expect(p.y + s.height).toBeLessThanOrEqual(v.height - POPOVER_MARGIN);
}

describe("placePopover", () => {
  it("goes below the target when there is room, centred on it, with the arrow pointing up at it", () => {
    const p = placePopover(box(600, 100), size, viewport);
    expect(p.side).toBe("below");
    expect(p.y).toBe(200 + ARROW_SIZE);
    expect(p.x).toBe(700 - size.width / 2);
    expect(p.arrow).toBe(`M690 ${p.y}L700 200L710 ${p.y}Z`);
    inside(p);
  });

  it("goes above when below has no room", () => {
    const p = placePopover(box(600, 650), size, viewport);
    expect(p.side).toBe("above");
    expect(p.y + size.height + ARROW_SIZE).toBe(650);
    expect(p.arrow).toContain("L700 650");
    inside(p);
  });

  it("goes right when neither below nor above has room", () => {
    const p = placePopover(box(100, 100, 300, 700), size, viewport);
    expect(p.side).toBe("right");
    expect(p.x).toBe(400 + ARROW_SIZE);
    expect(p.arrow).toContain(`L400 `);
    inside(p);
  });

  it("goes left when only the left has room", () => {
    const p = placePopover(box(1000, 100, 400, 700), size, viewport);
    expect(p.side).toBe("left");
    expect(p.x + size.width + ARROW_SIZE).toBe(1000);
    inside(p);
  });

  it("is kept inside the viewport's edges, with its arrow still at the target", () => {
    const nearLeft = placePopover(box(0, 100, 40, 40), size, viewport);
    expect(nearLeft.side).toBe("below");
    expect(nearLeft.x).toBe(POPOVER_MARGIN);
    inside(nearLeft);
    // The target's centre (20) is left of where the arrow may sit (off the rounded corner): it is clamped there.
    expect(nearLeft.arrow).toMatch(/^M18 /);

    const nearRight = placePopover(box(1420, 100, 20, 40), size, viewport);
    expect(nearRight.x + size.width).toBe(viewport.width - POPOVER_MARGIN);
    inside(nearRight);

    const tallRight = placePopover(box(100, 0, 300, 880), size, viewport);
    expect(tallRight.side).toBe("right");
    inside(tallRight);
  });

  it("is centred with no arrow when nothing fits, or there is no target", () => {
    const filling = placePopover(box(0, 0, 1440, 900), size, viewport);
    expect(filling).toEqual({ x: (1440 - 352) / 2, y: (900 - 200) / 2, side: "center", arrow: null });
    expect(placePopover(null, size, viewport).side).toBe("center");
    // A viewport smaller than the popover: pinned to the margin, never negative.
    const tiny = placePopover(box(10, 10), size, { width: 300, height: 150 });
    expect(tiny).toMatchObject({ x: POPOVER_MARGIN, y: POPOVER_MARGIN, side: "center" });
  });

  it("is centred, on screen, when the target is wholly outside the viewport", () => {
    for (const off of [box(600, -400), box(600, 1200), box(-500, 300), box(1700, 300)]) {
      const p = placePopover(off, size, viewport);
      expect(p.side).toBe("center");
      inside(p);
    }
  });
});

describe("the hole and the phone sheet", () => {
  it("cuts a rounded hole out of the viewport, or none", () => {
    expect(holePath({ width: 100, height: 50 }, null, 8)).toBe("M0 0H100V50H0Z");
    const d = holePath({ width: 100, height: 50 }, box(10, 10, 20, 10), 8);
    expect(d.startsWith("M0 0H100V50H0ZM15 10")).toBe(true); // radius capped at half the height
    expect(d.endsWith("Z")).toBe(true);
  });

  it("pads the target's box on every side", () => {
    expect(padBox(box(10, 20, 30, 40), 8)).toEqual({ x: 2, y: 12, width: 46, height: 56 });
  });

  it("moves the sheet to the top when the target is in the bottom 40%", () => {
    const phone = { width: 390, height: 844 };
    expect(sheetAtTop(null, phone)).toBe(false);
    expect(sheetAtTop(box(0, 100, 390, 100), phone)).toBe(false);
    expect(sheetAtTop(box(0, 600, 390, 100), phone)).toBe(true);
  });
});
