import { describe, expect, it } from "vitest";
import { MACHINE_HOUSING, STATION_VIEWBOX } from "../ui/stationShapes";
import { drawMachine, FALLBACK_COLOR, hitRadius, ICON_MAX_PX, ICON_MIN_PX, iconPx, ZOOM_AT_MAX, ZOOM_AT_MIN } from "./machineIcon";

/** A minimal 2D context that records each fill's colour; `roundRect` only when asked for. */
function fakeContext({ roundRect }: { roundRect: boolean }) {
  const ops: string[] = [];
  const fills: unknown[] = [];
  const scales: unknown[] = [];
  const ctx: Record<string, unknown> = { fillStyle: "STALE", strokeStyle: "STALE", globalAlpha: 1, lineWidth: 1 };
  for (const name of ["save", "restore", "translate", "beginPath", "moveTo", "lineTo", "arcTo", "closePath", "rect", "stroke"]) {
    ctx[name] = (..._args: unknown[]) => ops.push(name);
  }
  ctx.scale = (s: unknown) => scales.push(s);
  ctx.fill = () => {
    ops.push("fill");
    fills.push(ctx.fillStyle);
  };
  if (roundRect) ctx.roundRect = () => ops.push("roundRect");
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops, fills, scales };
}
const state = (ctx: CanvasRenderingContext2D) => ctx as unknown as { strokeStyle: string; lineWidth: number };

describe("iconPx: the icon's size follows the zoom, clamped", () => {
  it("is the minimum zoomed far out and the maximum zoomed in, growing in between", () => {
    expect(iconPx(-10)).toBe(ICON_MIN_PX);
    expect(iconPx(ZOOM_AT_MIN)).toBe(ICON_MIN_PX);
    expect(iconPx(ZOOM_AT_MAX)).toBe(ICON_MAX_PX);
    expect(iconPx(10)).toBe(ICON_MAX_PX);
    expect(iconPx((ZOOM_AT_MIN + ZOOM_AT_MAX) / 2)).toBe((ICON_MIN_PX + ICON_MAX_PX) / 2);
    expect(ICON_MAX_PX).toBe(2 * ICON_MIN_PX);
  });

  it("gives a hit circle that covers the housing at every size", () => {
    for (const size of [ICON_MIN_PX, 30, ICON_MAX_PX]) {
      expect(hitRadius(size) * 2).toBeGreaterThanOrEqual((MACHINE_HOUSING.width * size) / STATION_VIEWBOX);
    }
  });
});

describe("drawMachine", () => {
  it("scales the 48-unit shapes to the size it's given", () => {
    const { ctx, scales } = fakeContext({ roundRect: true });
    drawMachine(ctx, 10, 10, ICON_MAX_PX, { body: "OK", mark: "CANVAS" }, false);
    expect(scales).toEqual([ICON_MAX_PX / STATION_VIEWBOX]);
  });

  it("draws rounded corners by hand where the context has no roundRect (older browsers)", () => {
    const { ctx, ops, fills } = fakeContext({ roundRect: false });
    expect(() => drawMachine(ctx, 10, 10, ICON_MIN_PX, { body: "OK", mark: "CANVAS" }, false)).not.toThrow();
    expect(ops.filter((op) => op === "arcTo")).toHaveLength(8); // four corners, housing and window
    expect(fills).toEqual(["OK", "CANVAS"]);
  });

  it("uses roundRect where there is one", () => {
    const { ctx, ops } = fakeContext({ roundRect: true });
    drawMachine(ctx, 10, 10, ICON_MIN_PX, { body: "OK", mark: "CANVAS" }, false);
    expect(ops.filter((op) => op === "roundRect")).toHaveLength(2);
    expect(ops).not.toContain("arcTo");
  });

  it("never reuses the previous fill when a token is empty: it falls back to a defined colour", () => {
    const { ctx, fills } = fakeContext({ roundRect: true });
    drawMachine(ctx, 10, 10, ICON_MIN_PX, { body: "", mark: "" }, true);
    expect(fills).toEqual([FALLBACK_COLOR, FALLBACK_COLOR]);
    expect(fills).not.toContain("STALE");
  });

  it("draws a hollow housing (no body): an outline only, no fill, no window", () => {
    const { ctx, ops } = fakeContext({ roundRect: true });
    drawMachine(ctx, 10, 10, ICON_MIN_PX, { mark: "CANVAS", outline: "MUTED" }, false);
    expect(ops.filter((op) => op === "roundRect")).toHaveLength(1);
    expect(ops.filter((op) => op === "stroke")).toHaveLength(1);
    expect(ops).not.toContain("fill");
    expect(state(ctx).strokeStyle).toBe("MUTED");
  });

  it("keeps the hollow outline 1 CSS px at the smallest size, 2 at the largest", () => {
    for (const [size, px] of [
      [ICON_MIN_PX, 1],
      [ICON_MAX_PX, 2],
    ]) {
      const { ctx } = fakeContext({ roundRect: true });
      drawMachine(ctx, 10, 10, size, { mark: "CANVAS", outline: "MUTED" }, false);
      // lineWidth is in the scaled (viewBox) units.
      expect(state(ctx).lineWidth * (size / STATION_VIEWBOX)).toBeCloseTo(px);
    }
  });

  it("falls back for an empty outline token too", () => {
    const { ctx } = fakeContext({ roundRect: true });
    drawMachine(ctx, 10, 10, ICON_MIN_PX, { mark: "", outline: "" }, false);
    expect(state(ctx).strokeStyle).toBe(FALLBACK_COLOR);
  });
});
