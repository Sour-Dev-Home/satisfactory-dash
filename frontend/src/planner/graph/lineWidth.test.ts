import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LINE_W_BASE, LINE_W_FAST, LINE_W_MID, LINE_W_SLOW, lineStroke, TRANSPORT_MIXED_W, TRANSPORT_W } from "./lineWidth";
import { FLUID_FAST_FROM, FLUID_MID_FROM, ITEMS_FAST_FROM, ITEMS_MID_FROM } from "./rateStep";

const belt = (ratePerMinute: number | null, mixed = false) => ({ carrier: "belt", mixed, ratePerMinute, unit: "items/min" as const });
const pipe = (ratePerMinute: number | null) => ({ carrier: "pipe", mixed: false, ratePerMinute, unit: "m3/min" as const });

describe("lineStroke: width means rate (ADR-0062 amendment Decision 4)", () => {
  it("gives a belt 2, 3 or 4 from its items/min step", () => {
    expect(lineStroke(belt(ITEMS_MID_FROM - 0.1)).width).toBe(LINE_W_SLOW);
    expect(lineStroke(belt(ITEMS_MID_FROM)).width).toBe(LINE_W_MID);
    expect(lineStroke(belt(ITEMS_FAST_FROM - 0.1)).width).toBe(LINE_W_MID);
    expect(lineStroke(belt(ITEMS_FAST_FROM)).width).toBe(LINE_W_FAST);
    expect([LINE_W_SLOW, LINE_W_MID, LINE_W_FAST]).toEqual([2, 3, 4]);
  });

  it("gives a pipe its step from m³/min, never compared with items", () => {
    expect(lineStroke(pipe(ITEMS_FAST_FROM)).width).toBe(LINE_W_MID);
    expect(lineStroke(pipe(FLUID_MID_FROM - 1)).width).toBe(LINE_W_SLOW);
    expect(lineStroke(pipe(FLUID_MID_FROM)).width).toBe(LINE_W_MID);
    expect(lineStroke(pipe(FLUID_FAST_FROM)).width).toBe(LINE_W_FAST);
  });

  it("keeps the base width (today's 2) for a line with no step: unknown, 0, negative or not finite", () => {
    expect(LINE_W_BASE).toBe(2);
    for (const rate of [null, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(lineStroke(belt(rate)), String(rate)).toEqual({ width: LINE_W_BASE, inner: null });
  });

  it("draws a mixed line's inner stroke at the same width as an unmixed line of its rate, thinner than the line", () => {
    for (const rate of [null, 60, ITEMS_MID_FROM, ITEMS_FAST_FROM]) {
      const plain = lineStroke(belt(rate));
      const mixed = lineStroke(belt(rate, true));
      expect(mixed.width, String(rate)).toBe(plain.width);
      expect(mixed.inner, String(rate)).not.toBeNull();
      // A warn rail of at least 0.75 on each side, so the warn colour stays visible.
      expect((mixed.width - mixed.inner!) / 2, String(rate)).toBeGreaterThanOrEqual(0.75);
    }
  });

  it("leaves a transport as today: 2, or 3 when mixed, whatever its rate, and no inner stroke", () => {
    for (const carrier of ["train", "truck", "drone", "depot", "hovercraft"]) {
      expect(lineStroke({ carrier, mixed: false, ratePerMinute: ITEMS_FAST_FROM * 2, unit: "items/min" })).toEqual({ width: TRANSPORT_W, inner: null });
      expect(lineStroke({ carrier, mixed: true, ratePerMinute: 30, unit: "items/min" })).toEqual({ width: TRANSPORT_MIXED_W, inner: null });
    }
    expect([TRANSPORT_W, TRANSPORT_MIXED_W]).toEqual([2, 3]);
  });
});

describe("the mixed line's contrast (WCAG 1.4.11, 3:1 for a graphic)", () => {
  const css = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");
  const hex = (token: string): string => {
    const value = new RegExp(`^\\s*--color-${token}:\\s*(#[0-9a-f]{6});`, "im").exec(css)?.[1];
    if (value === undefined) throw new Error(`--color-${token} is not a hex token in src/index.css`);
    return value;
  };
  const luminance = (colour: string): number => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = Number.parseInt(colour.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it("keeps the warn rails at 3:1 against the canvas they sit on and the inner stroke between them (both surface)", () => {
    // The graph and the legend sit on `bg-surface`; the inner stroke is `stroke-surface`, so both sides of a rail are surface.
    for (const surface of ["surface", "canvas"]) expect(ratio(hex("warn"), hex(surface)), surface).toBeGreaterThanOrEqual(3);
  });
});
