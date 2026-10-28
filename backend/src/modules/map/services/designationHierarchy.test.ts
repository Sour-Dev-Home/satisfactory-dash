import { describe, expect, it } from "vitest";
import { PLANNER_DESIGNATION_MAX_DEPTH } from "@satisfactory-dash/shared";
import { checkHierarchy, emptiedAncestors, parentsFirst } from "./designationHierarchy.js";
import type { HierarchyNode } from "./designationHierarchy.js";

const n = (id: string, parentId: string | null = null, memberCount = 1): HierarchyNode => ({ id, parentId, memberCount });

describe("checkHierarchy (ADR-0061 Decision 1)", () => {
  it("passes a flat set, an empty set, and a 3-level chain", () => {
    expect(checkHierarchy([])).toBeUndefined();
    expect(checkHierarchy([n("a"), n("b")])).toBeUndefined();
    expect(PLANNER_DESIGNATION_MAX_DEPTH).toBe(3);
    expect(checkHierarchy([n("c", "b"), n("b", "a"), n("a")])).toBeUndefined();
  });

  it("stale: a parent not in the set, each id once", () => {
    expect(checkHierarchy([n("a", "gone"), n("b", "gone"), n("c", "other")])).toEqual({ kind: "stale", ids: ["gone", "other"] });
  });

  it("cycle: a self-parent, a 2-cycle, and a cycle above a valid node", () => {
    expect(checkHierarchy([n("a", "a")])).toEqual({ kind: "cycle" });
    expect(checkHierarchy([n("a", "b"), n("b", "a")])).toEqual({ kind: "cycle" });
    expect(checkHierarchy([n("leaf", "a"), n("a", "b"), n("b", "a")])).toEqual({ kind: "cycle" });
  });

  it("depth: a fourth level, however the nodes are ordered", () => {
    const chain = [n("a"), n("b", "a"), n("c", "b"), n("d", "c")];
    expect(checkHierarchy(chain)).toEqual({ kind: "depth" });
    expect(checkHierarchy([...chain].reverse())).toEqual({ kind: "depth" });
  });

  it("shape: no members is fine with a child, refused without one", () => {
    expect(checkHierarchy([n("p", null, 0), n("c", "p")])).toBeUndefined();
    expect(checkHierarchy([n("p", null, 0)])).toEqual({ kind: "shape" });
    // A parent with members and children is allowed (owner answer 2).
    expect(checkHierarchy([n("p", null, 3), n("c", "p")])).toBeUndefined();
  });

  it("checks in order: stale before cycle before depth before shape", () => {
    expect(checkHierarchy([n("a", "a"), n("b", "gone")])).toMatchObject({ kind: "stale" });
    expect(checkHierarchy([n("x", "x"), n("a"), n("b", "a"), n("c", "b"), n("d", "c")])).toEqual({ kind: "cycle" });
    expect(checkHierarchy([n("e", null, 0), n("a"), n("b", "a"), n("c", "b"), n("d", "c")])).toEqual({ kind: "depth" });
  });
});

describe("emptiedAncestors (DELETE, ADR-0061)", () => {
  it("removes an empty parent whose last child goes, and its empty parent too, nearest first", () => {
    const nodes = [n("g", null, 0), n("p", "g", 0), n("c", "p")];
    expect(emptiedAncestors(nodes, "c")).toEqual(["p", "g"]);
  });

  it("keeps a parent that owns machines or still has another child", () => {
    expect(emptiedAncestors([n("p", null, 2), n("c", "p")], "c")).toEqual([]);
    expect(emptiedAncestors([n("p", null, 0), n("c", "p"), n("d", "p")], "c")).toEqual([]);
    // Stops at the first kept ancestor.
    expect(emptiedAncestors([n("g", null, 1), n("p", "g", 0), n("c", "p")], "c")).toEqual(["p"]);
  });

  it("is empty for a top-level one, an unknown id, and one with children (they move up)", () => {
    expect(emptiedAncestors([n("a")], "a")).toEqual([]);
    expect(emptiedAncestors([n("a")], "zz")).toEqual([]);
    expect(emptiedAncestors([n("g", null, 0), n("p", "g"), n("c", "p")], "p")).toEqual([]);
  });
});

describe("parentsFirst", () => {
  it("puts every parent before its children and keeps the order otherwise", () => {
    const rows = [n("c", "b"), n("x"), n("b", "a"), n("a"), n("y", "outside")];
    const order = parentsFirst(rows).map((r) => r.id);
    expect(order).toEqual(["a", "b", "c", "x", "y"]);
    expect(parentsFirst([n("x"), n("y")]).map((r) => r.id)).toEqual(["x", "y"]);
  });
});
