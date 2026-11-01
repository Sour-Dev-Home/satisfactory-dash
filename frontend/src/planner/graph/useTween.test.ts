import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EASE_STANDARD, TWEEN_TOKEN, cubicBezier, durationOf, easeStandard, useTween } from "./useTween";

const css = readFileSync(join(import.meta.dirname, "..", "..", "index.css"), "utf8");

afterEach(() => vi.useRealTimers());

describe("the tween's constants mirror the motion tokens (ADR-0060 Decision 4)", () => {
  it("eases with exactly --ease-standard's curve", () => {
    const match = /--ease-standard:\s*cubic-bezier\(([^)]+)\)/.exec(css);
    expect(match).not.toBeNull();
    expect(match![1].split(",").map(Number)).toEqual([...EASE_STANDARD]);
  });

  it("lasts a token that reduced motion sets to 0s", () => {
    const reduced = css.slice(css.indexOf("prefers-reduced-motion"));
    expect(reduced).toMatch(new RegExp(`${TWEEN_TOKEN}:\\s*0s`));
  });
});

describe("cubicBezier", () => {
  it("starts at 0, ends at 1 and never goes back", () => {
    expect(easeStandard(0)).toBe(0);
    expect(easeStandard(1)).toBe(1);
    let last = 0;
    for (let i = 1; i <= 100; i++) {
      const y = easeStandard(i / 100);
      expect(y).toBeGreaterThanOrEqual(last - 1e-9);
      last = y;
    }
  });

  it("is the identity for a linear curve", () => {
    const linear = cubicBezier([1 / 3, 1 / 3, 2 / 3, 2 / 3]);
    for (const t of [0.1, 0.25, 0.5, 0.9]) expect(linear(t)).toBeCloseTo(t, 4);
  });
});

describe("durationOf", () => {
  it("reads ms and s, and is 0 for anything odd", () => {
    expect(durationOf("240ms")).toBe(240);
    expect(durationOf(" 0.3s ")).toBe(300);
    expect(durationOf("0s")).toBe(0);
    expect(durationOf("")).toBe(0);
    expect(durationOf("fast")).toBe(0);
  });
});

describe("useTween", () => {
  it("jumps to the end at once when the duration is 0 (reduced motion)", () => {
    const { result } = renderHook(() => useTween());
    const frames: number[] = [];
    const done = vi.fn();
    act(() => result.current.run(0, (t) => frames.push(t), done));
    expect(frames).toEqual([1]);
    expect(done).toHaveBeenCalledOnce();
  });

  it("runs from 0 to 1 over the duration, and a second run cancels the first", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTween());
    const first: number[] = [];
    const firstDone = vi.fn();
    act(() => result.current.run(200, (t) => first.push(t), firstDone));
    expect(first).toEqual([0]);
    act(() => vi.advanceTimersByTime(50));
    const second: number[] = [];
    const secondDone = vi.fn();
    act(() => result.current.run(200, (t) => second.push(t), secondDone));
    const seen = first.length;
    act(() => vi.advanceTimersByTime(400));
    expect(first).toHaveLength(seen);
    expect(firstDone).not.toHaveBeenCalled();
    expect(second.at(-1)).toBe(1);
    expect(secondDone).toHaveBeenCalledOnce();
  });
});
