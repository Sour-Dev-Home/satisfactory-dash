import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCssTime } from "../../ui/loadTiming";
import { FLUID_FAST_FROM, FLUID_MID_FROM, ITEMS_FAST_FROM, ITEMS_MID_FROM, RATE_STEPS, rateStep, stepWord, withStepWord } from "./rateStep";

describe("the step word (amendment Decision 7)", () => {
  it("names each step, slowest first, the step mid as medium", () => {
    expect(RATE_STEPS.map(stepWord)).toEqual(["slow", "medium", "fast"]);
    expect(stepWord(null)).toBeNull();
  });

  it("follows a rate's words, and no step adds nothing", () => {
    expect(withStepWord("about 120 items/min", rateStep(120, "items/min"))).toBe("about 120 items/min, medium");
    expect(withStepWord("600 m³/min", rateStep(600, "m3/min"))).toBe("600 m³/min, fast");
    expect(withStepWord("0 items/min", rateStep(0, "items/min"))).toBe("0 items/min");
    expect(withStepWord("unknown", null)).toBe("unknown");
  });
});

describe("rateStep", () => {
  it("steps a belt's items/min at a full Mk.2 and a full Mk.4", () => {
    expect([ITEMS_MID_FROM, ITEMS_FAST_FROM]).toEqual([120, 480]);
    expect(rateStep(0.5, "items/min")).toBe("slow");
    expect(rateStep(60, "items/min")).toBe("slow");
    expect(rateStep(119.99, "items/min")).toBe("slow");
    expect(rateStep(120, "items/min")).toBe("mid");
    expect(rateStep(270, "items/min")).toBe("mid");
    expect(rateStep(479.99, "items/min")).toBe("mid");
    expect(rateStep(480, "items/min")).toBe("fast");
    expect(rateStep(5000, "items/min")).toBe("fast");
  });

  it("steps a pipe's m³/min at a full Mk.1 and a full Mk.2", () => {
    expect([FLUID_MID_FROM, FLUID_FAST_FROM]).toEqual([300, 600]);
    expect(rateStep(120, "m3/min")).toBe("slow");
    expect(rateStep(299.99, "m3/min")).toBe("slow");
    expect(rateStep(300, "m3/min")).toBe("mid");
    expect(rateStep(599.99, "m3/min")).toBe("mid");
    expect(rateStep(600, "m3/min")).toBe("fast");
  });

  it("never compares across units: the same number is a different step per unit", () => {
    expect(rateStep(480, "items/min")).toBe("fast");
    expect(rateStep(480, "m3/min")).toBe("mid");
    expect(rateStep(150, "items/min")).toBe("mid");
    expect(rateStep(150, "m3/min")).toBe("slow");
  });

  it("gives no step (the line does not move) for a missing, zero, negative or non-finite rate", () => {
    for (const rate of [null, undefined, 0, -0, -1, -600, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(rateStep(rate, "items/min")).toBeNull();
      expect(rateStep(rate, "m3/min")).toBeNull();
    }
  });

  it("moves at the slowest step for the smallest positive rate, in either unit", () => {
    expect(rateStep(Number.MIN_VALUE, "items/min")).toBe("slow");
    expect(rateStep(Number.MIN_VALUE, "m3/min")).toBe("slow");
  });

  it("gives no step for a missing or unknown unit, including inherited object keys", () => {
    for (const unit of [null, undefined, "", "items/s", "M3/MIN", "toString", "__proto__", "constructor"]) expect(rateStep(120, unit)).toBeNull();
  });
});

describe("the flow duration tokens", () => {
  const css = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");
  const themeValue = (name: string): number | undefined => parseCssTime(new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m").exec(css)?.[1] ?? "");
  const reduced = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n  \}\n/.exec(css)?.[0] ?? "";

  it("are defined in @theme, slow clearly slower than mid, mid than fast", () => {
    const [slow, mid, fast] = ["--duration-flow-slow", "--duration-flow-mid", "--duration-flow-fast"].map(themeValue);
    expect([slow, mid, fast]).toEqual([2400, 1200, 600]);
  });

  it("are zeroed under reduced motion", () => {
    for (const step of ["slow", "mid", "fast"]) expect(reduced).toMatch(new RegExp(`--duration-flow-${step}:\\s*0s;`));
  });
});
