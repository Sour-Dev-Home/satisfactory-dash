import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasFlow } from "./canvasScene";
import { marchCandidates, marchStep, marchingLines, type MarchCandidate } from "./marching";
import { useSettled } from "./useSettled";

const flow = (over: Partial<CanvasFlow> = {}): CanvasFlow =>
  ({ from: "a", to: "b", carrier: "belt", flow: "supply", mixed: false, rate: "measured", ratePerMinute: 200, unit: "items/min", ...over }) as CanvasFlow;
const pts = (x: number, y: number) => [{ x, y }, { x: x + 10, y: y + 10 }];

describe("marching hunt", () => {
  it("does not let out-of-view fast lines use up the cap", () => {
    const c: MarchCandidate[] = [
      { index: 0, step: "fast", box: { x: 5000, y: 0, width: 10, height: 10 } },
      { index: 1, step: "slow", box: { x: 0, y: 0, width: 10, height: 10 } },
    ];
    expect([...marchingLines(c, { x: 0, y: 0, k: 1 }, { width: 100, height: 100 }, 1).keys()]).toEqual([1]);
  });

  it("marches a straight (zero-width) route that crosses the stage, not one entirely off it", () => {
    const stage = { width: 100, height: 100 };
    const c = (x: number): MarchCandidate[] => [{ index: 0, step: "mid", box: { x, y: 10, width: 0, height: 50 } }];
    expect(marchingLines(c(50), { x: 0, y: 0, k: 1 }, stage).size).toBe(1);
    expect(marchingLines(c(150), { x: 0, y: 0, k: 1 }, stage).size).toBe(0);
    expect(marchingLines(c(-5), { x: 0, y: 0, k: 1 }, stage).size).toBe(0);
  });

  it("is deterministic regardless of input order and does not mutate its input", () => {
    const edges = [3, 1, 2, 0].map((i) => ({ index: i, flow: flow({ ratePerMinute: 200 }), points: pts(0, 0) }));
    const copy = [...edges];
    expect(marchCandidates(edges).map((c) => c.index)).toEqual([0, 1, 2, 3]);
    expect(edges).toEqual(copy);
  });

  it("skips routes with fewer than two points and ranks fast before mid before slow", () => {
    const edges = [
      { index: 0, flow: flow({ ratePerMinute: 10 }), points: pts(0, 0) },
      { index: 1, flow: flow({ ratePerMinute: 500 }), points: pts(0, 0) },
      { index: 2, flow: flow({ ratePerMinute: 200 }), points: pts(0, 0) },
      { index: 3, flow: flow({ ratePerMinute: 500 }), points: [{ x: 0, y: 0 }] },
    ];
    expect(marchCandidates(edges).map((c) => c.index)).toEqual([1, 2, 0]);
  });

  it("marchStep: thresholds, null/NaN/negative rates, unknown unit, stalled even at a high rate", () => {
    expect(marchStep(flow({ ratePerMinute: 119.99 }))).toBe("slow");
    expect(marchStep(flow({ ratePerMinute: 120 }))).toBe("mid");
    expect(marchStep(flow({ ratePerMinute: 479.99 }))).toBe("mid");
    expect(marchStep(flow({ ratePerMinute: 0 }))).toBeNull();
    expect(marchStep(flow({ ratePerMinute: -5 }))).toBeNull();
    expect(marchStep(flow({ ratePerMinute: Number.NaN }))).toBeNull();
    expect(marchStep(flow({ ratePerMinute: null as unknown as number }))).toBeNull();
    expect(marchStep(flow({ unit: "kW" as never }))).toBeNull();
    expect(marchStep(flow({ carrier: "truck" as never }))).toBeNull();
    expect(marchStep(flow({ carrier: "pipe", unit: "m3/min", ratePerMinute: 299 }))).toBe("slow");
    expect(marchStep(flow({ stalled: "blocked" as never, ratePerMinute: 900 }))).toBeNull();
  });
});

describe("useSettled hunt", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("restarts the quiet period on each change, and settles the latest value only", () => {
    const { result, rerender } = renderHook(({ v }) => useSettled(v, 150), { initialProps: { v: 1 } });
    rerender({ v: 2 });
    act(() => void vi.advanceTimersByTime(100));
    rerender({ v: 3 });
    act(() => void vi.advanceTimersByTime(100));
    expect(result.current).toBe(1);
    act(() => void vi.advanceTimersByTime(50));
    expect(result.current).toBe(3);
  });

  it("a change that returns to the settled value never moves it", () => {
    const { result, rerender } = renderHook(({ v }) => useSettled(v, 150), { initialProps: { v: 1 } });
    rerender({ v: 2 });
    rerender({ v: 1 });
    act(() => void vi.advanceTimersByTime(500));
    expect(result.current).toBe(1);
  });
});
