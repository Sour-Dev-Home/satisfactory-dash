import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNow } from "./useNow";

describe("useNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the current time on first render, before any tick", () => {
    const start = Date.now();
    const { result } = renderHook(() => useNow(1_000));
    expect(result.current).toBeGreaterThanOrEqual(start);
  });

  it("re-reads the clock every everyMs", () => {
    const { result } = renderHook(() => useNow(1_000));
    const first = result.current;
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current).toBeGreaterThan(first);
  });

  it("restarts the ticker on the new interval when everyMs changes, without a leftover tick from the old one", () => {
    const { result, rerender } = renderHook(({ everyMs }) => useNow(everyMs), {
      initialProps: { everyMs: 1_000 },
    });
    const first = result.current;

    rerender({ everyMs: 5_000 });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    // The old 1s interval was cleared on rerender, so a plain 1s advance should not tick yet.
    expect(result.current).toBe(first);

    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(result.current).toBeGreaterThan(first);
  });
});
