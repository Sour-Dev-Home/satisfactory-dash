import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PlannerDesignation, PlannerNode } from "@satisfactory-dash/shared";
import type { SplitSource } from "./selectionPlans";
import { usePopOut } from "./usePopOut";

const member = (id: string, x = 0) => ({ id, c: "Build_ConstructorMk1_C", x, y: 0 });
const node = (ids: string[], count = ids.length) => ({ key: ids.join(","), name: "Rod", machineIds: ids, count }) as unknown as PlannerNode;

function source(members: ReturnType<typeof member>[], buildings: (string | null)[]): SplitSource {
  return {
    designation: { id: "7b0f6c1e-3a52-4d6e-9d0e-2f0a5b9c1a11", name: "F", revision: 1, members } as unknown as PlannerDesignation,
    match: { designationId: "7b0f6c1e-3a52-4d6e-9d0e-2f0a5b9c1a11", memberBuildingIds: buildings } as unknown as SplitSource["match"],
  };
}
const canOf = (s: SplitSource | null) => renderHook(() => usePopOut(s, () => {})).result.current.canPopOut;

describe("canPopOut", () => {
  const two = source([member("m1", 0), member("m2", 100)], ["b1", "b2"]);

  it("is true for a group holding some, not all, of the members", () => {
    expect(canOf(two)(node(["b1"]))).toBe(true);
  });
  it("is false for a group with no members (a storage card) or all of them", () => {
    expect(canOf(two)(node(["s1"]))).toBe(false);
    expect(canOf(two)(node(["b1", "b2"]))).toBe(false);
  });
  it("is false when every selected member has a twin that stays", () => {
    // An id-less entry at the same class and place is the same building as the chosen one (the overlap rule).
    const twins = source([member("m1", 0), { ...member("m2", 0), id: null } as unknown as ReturnType<typeof member>], ["b1", "b2"]);
    expect(canOf(twins)(node(["b1"]))).toBe(false);
  });
  it("keeps the button for a group too large to split whole, so the error explains", () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `b${i}`);
    expect(canOf(two)(node(ids, 10_000))).toBe(true);
  });
  it("is false with no source, and when the backend sent no building ids", () => {
    expect(canOf(null)(node(["b1"]))).toBe(false);
    expect(canOf(source([member("m1")], [null]))(node(["b1"]))).toBe(false);
  });
});
