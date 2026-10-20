import { describe, expect, it } from "vitest";
import { MACHINE_HOUSING } from "../ui/stationShapes";
import { drawMachine, FALLBACK_COLOR } from "./machineIcon";

/** A minimal 2D context that records each fill's colour; `roundRect` only when asked for. */
function fakeContext({ roundRect }: { roundRect: boolean }) {
  const ops: string[] = [];
  const fills: unknown[] = [];
  const ctx: Record<string, unknown> = { fillStyle: "STALE", strokeStyle: "STALE", globalAlpha: 1, lineWidth: 1 };
  for (const name of ["save", "restore", "translate", "scale", "beginPath", "moveTo", "lineTo", "arcTo", "closePath", "rect", "stroke"]) {
    ctx[name] = (..._args: unknown[]) => ops.push(name);
  }
  ctx.fill = () => {
    ops.push("fill");
    fills.push(ctx.fillStyle);
  };
  if (roundRect) ctx.roundRect = () => ops.push("roundRect");
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops, fills };
}

describe("drawMachine", () => {
  it("draws rounded corners by hand where the context has no roundRect (older browsers)", () => {
    const { ctx, ops, fills } = fakeContext({ roundRect: false });
    expect(() => drawMachine(ctx, 10, 10, { body: "OK", mark: "CANVAS" }, false)).not.toThrow();
    expect(ops.filter((op) => op === "arcTo")).toHaveLength(8); // four corners, housing and window
    expect(fills).toEqual(["OK", "CANVAS"]);
  });

  it("uses roundRect where there is one", () => {
    const { ctx, ops } = fakeContext({ roundRect: true });
    drawMachine(ctx, 10, 10, { body: "OK", mark: "CANVAS" }, false);
    expect(ops.filter((op) => op === "roundRect")).toHaveLength(2);
    expect(ops).not.toContain("arcTo");
  });

  it("never reuses the previous fill when a token is empty: it falls back to a defined colour", () => {
    const { ctx, fills } = fakeContext({ roundRect: true });
    drawMachine(ctx, 10, 10, { body: "", mark: "" }, true);
    expect(fills).toEqual([FALLBACK_COLOR, FALLBACK_COLOR]);
    expect(fills).not.toContain("STALE");
  });

  it("strokes the housing when given an outline, and only then", () => {
    const plain = fakeContext({ roundRect: true });
    drawMachine(plain.ctx, 10, 10, { body: "LINE", mark: "CANVAS" }, false);
    expect(plain.ops).not.toContain("stroke");
    const outlined = fakeContext({ roundRect: true });
    drawMachine(outlined.ctx, 10, 10, { body: "LINE", mark: "CANVAS", outline: "MUTED" }, false);
    expect(outlined.ops.filter((op) => op === "stroke")).toHaveLength(1);
    expect((outlined.ctx as unknown as { strokeStyle: string }).strokeStyle).toBe("MUTED");
  });

  it("keeps the housing's geometry from stationShapes", () => {
    expect(MACHINE_HOUSING).toEqual({ x: 6, y: 12, width: 36, height: 26, rx: 3 });
  });
});
