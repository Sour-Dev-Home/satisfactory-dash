import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOAD_TOKENS, loadMs, parseCssTime } from "./loadTiming";

const css = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");

/** A token's value in the stylesheet's `@theme` block (the first definition, before any media query). */
function themeValue(name: string): string {
  const match = new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m").exec(css);
  if (!match) throw new Error(`${name} is not defined in src/index.css`);
  return match[1].trim();
}

describe("parseCssTime", () => {
  it("reads milliseconds and seconds", () => {
    expect(parseCssTime("150ms")).toBe(150);
    expect(parseCssTime(" 0.3s ")).toBe(300);
    expect(parseCssTime("0s")).toBe(0);
  });

  it("returns undefined for anything else", () => {
    expect(parseCssTime("")).toBeUndefined();
    expect(parseCssTime("fast")).toBeUndefined();
    expect(parseCssTime("12px")).toBeUndefined();
  });
});

describe("loading timings", () => {
  it("keeps each fallback equal to its token in src/index.css", () => {
    for (const token of Object.values(LOAD_TOKENS)) {
      expect(parseCssTime(themeValue(token.name)), token.name).toBe(token.fallbackMs);
    }
  });

  it("uses the issue's numbers: 150 ms to show, 300 ms minimum, 400 ms page budget", () => {
    expect(LOAD_TOKENS.skeletonDelay.fallbackMs).toBe(150);
    expect(LOAD_TOKENS.skeletonMin.fallbackMs).toBe(300);
    expect(LOAD_TOKENS.revealBudget.fallbackMs).toBe(400);
  });

  it("reads the live value from the stylesheet when there is one, else the fallback", () => {
    expect(loadMs(LOAD_TOKENS.skeletonMin)).toBe(300);
    document.documentElement.style.setProperty("--duration-skeleton-min", "0s");
    expect(loadMs(LOAD_TOKENS.skeletonMin)).toBe(0);
    document.documentElement.style.removeProperty("--duration-skeleton-min");
  });

  it("zeroes the minimum display and the shimmer under reduced motion, but not the delay or the budget", () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n  \}\n/.exec(css)?.[0] ?? "";
    expect(reduced).toMatch(/--duration-skeleton-min:\s*0s/);
    expect(reduced).toMatch(/--duration-shimmer:\s*0s/);
    expect(reduced).not.toMatch(/--duration-skeleton-delay/);
    expect(reduced).not.toMatch(/--duration-reveal-budget/);
  });
});
