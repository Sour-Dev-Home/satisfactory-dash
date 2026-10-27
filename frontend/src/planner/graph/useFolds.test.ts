import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { readFolds, useFolds } from "./foldMemory";

describe("useFolds", () => {
  it("keeps both halves when two patches land in one render", () => {
    const { result } = renderHook(() => useFolds("a"));
    act(() => {
      result.current[1]({ flipped: new Set(["b1"]) });
      result.current[1]({ unfolded: new Set(["f1"]) });
    });
    expect([...result.current[0].flipped]).toEqual(["b1"]);
    expect([...result.current[0].unfolded]).toEqual(["f1"]);
    expect([...readFolds("a").flipped]).toEqual(["b1"]);
    expect([...readFolds("a").unfolded]).toEqual(["f1"]);
  });

  it("restores the folds on a later mount, and never stores the overview (null key)", () => {
    const first = renderHook(() => useFolds("a"));
    act(() => first.result.current[1]({ flipped: new Set(["b1"]) }));
    first.unmount();
    expect([...renderHook(() => useFolds("a")).result.current[0].flipped]).toEqual(["b1"]);
    const overview = renderHook(() => useFolds(null));
    act(() => overview.result.current[1]({ flipped: new Set(["x"]) }));
    expect([...overview.result.current[0].flipped]).toEqual(["x"]);
    expect(readFolds("null").flipped.size).toBe(0);
  });
});
