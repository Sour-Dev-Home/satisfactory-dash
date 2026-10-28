import { describe, expect, it } from "vitest";
import type { PlannerDesignation } from "@satisfactory-dash/shared";
import { groupRequest, moveRequest } from "./designationOps";

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const d = (n: number, p: number | null, m: number): PlannerDesignation => ({
  id: u(n),
  name: `D${n}`,
  mode: "core",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  revision: 1,
  members: Array.from({ length: m }, (_, i) => ({ id: `B${n}${i}`, c: "Build_ConstructorMk1_C", x: n * 8 + i, y: 0 })),
  parentId: p === null ? null : u(p),
});
const all = [d(1, null, 0), d(2, 1, 1), d(3, 1, 1), d(4, null, 1)];

describe("hierarchy edges", () => {
  it("grouping the same factory twice is not a group", () => {
    const r = groupRequest({ all, picks: [{ designation: all[3]! }, { designation: all[3]! }], name: "G", parentId: null, newId: u(99) });
    expect(r.ok).toBe(false);
  });
  it("moving a parent into its own child is refused", () => {
    expect(moveRequest({ all, picks: [{ designation: all[0]! }], to: u(2) }).ok).toBe(false);
  });
});
