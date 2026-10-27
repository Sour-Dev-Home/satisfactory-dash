import { describe, expect, it } from "vitest";
import type { PlannerDesignationMember } from "@satisfactory-dash/shared";
import { applyReplace, type StoredDesignation } from "../demo/designationStore";
import { mergeRequest, splitRequest, undoRequest, dissolveRequest, type OpResult } from "./designationOps";

const NOW = Date.parse("2026-10-27T12:00:00.000Z");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ids = () => {
  let n = 5000;
  return () => uuid(n++);
};
const m = (n: number, id: string | null = `B${n}`): PlannerDesignationMember => ({ id, c: "Build_ConstructorMk1_C", x: n * 8, y: 0 });
const des = (n: number, members: PlannerDesignationMember[], day: number, revision = 1): StoredDesignation => ({
  id: uuid(n),
  name: `F${n}`,
  mode: "core",
  members,
  createdAt: `2026-10-${String(day).padStart(2, "0")}T10:00:00.000Z`,
  updatedAt: `2026-10-${String(day).padStart(2, "0")}T10:00:00.000Z`,
  revision,
});
const ok = (r: OpResult) => {
  if (!r.ok) throw new Error(r.reason);
  return r;
};
const sortId = (l: StoredDesignation[]) => [...l].sort((a, b) => a.id.localeCompare(b.id));
const essence = (l: StoredDesignation[]) => sortId(l).map(({ id, name, members, createdAt }) => ({ id, name, members, createdAt }));

describe("hunt: round trips through the demo store", () => {
  it("merge then undo restores ids, createdAt, member order (with null-id members, not oldest-first in the list)", () => {
    const list = [des(1, [m(3), m(1, null), m(2)], 20, 3), des(2, [m(9), m(8)], 21, 7), des(3, [m(5, null)], 22)];
    const merge = ok(mergeRequest({ designations: [list[2]!, list[0]!, list[1]!], suggested: [], name: "Merged" }));
    const done = applyReplace(list, merge.request, NOW, ids());
    if (!done.ok) throw new Error(done.message);
    expect(done.next).toHaveLength(1);
    expect(done.next[0]!.id).toBe(list[0]!.id);
    const undo = ok(undoRequest(merge.preImage, done.response));
    const back = applyReplace(done.next, undo.request, NOW, ids());
    if (!back.ok) throw new Error(back.message);
    expect(essence(back.next)).toEqual(essence(list));
  });

  it("split then undo is identity, including members the matcher no longer finds", () => {
    const src = des(1, [m(1), m(2), m(3), m(4)], 20, 2);
    const split = ok(splitRequest({ source: src, memberBuildingIds: ["B1", null, "B3", null], machineIds: new Set(["B3", "B1"]), name: "Out" }));
    expect(split.request.put[0]!.members.map((x) => x.id)).toEqual(["B2", "B4"]);
    expect(split.request.put[1]!.members.map((x) => x.id)).toEqual(["B1", "B3"]);
    const done = applyReplace([src], split.request, NOW, ids());
    if (!done.ok) throw new Error(done.message);
    const undo = ok(undoRequest(split.preImage, done.response));
    const back = applyReplace(done.next, undo.request, NOW, ids());
    if (!back.ok) throw new Error(back.message);
    expect(essence(back.next)).toEqual(essence([src]));
  });

  it("dissolve then undo is identity", () => {
    const a = des(1, [m(1)], 20);
    const b = des(2, [m(2)], 21);
    const d = ok(dissolveRequest(a));
    const done = applyReplace([a, b], d.request, NOW, ids());
    if (!done.ok) throw new Error(done.message);
    const undo = ok(undoRequest(d.preImage, done.response));
    const back = applyReplace(done.next, undo.request, NOW, ids());
    if (!back.ok) throw new Error(back.message);
    expect(essence(back.next)).toEqual(essence([a, b]));
  });

  it("a second undo of the same change is stale, never an overwrite", () => {
    const a = des(1, [m(1), m(2)], 20);
    const b = des(2, [m(3)], 21);
    const merge = ok(mergeRequest({ designations: [a, b], suggested: [], name: "M" }));
    const done = applyReplace([a, b], merge.request, NOW, ids());
    if (!done.ok) throw new Error(done.message);
    const undo = ok(undoRequest(merge.preImage, done.response));
    const back = applyReplace(done.next, undo.request, NOW, ids());
    if (!back.ok) throw new Error(back.message);
    const again = applyReplace(back.next, undo.request, NOW, ids());
    expect(again.ok).toBe(false);
  });
});

describe("hunt: caps", () => {
  it("merges exactly 10 designations of 100 members, refuses 11", () => {
    const list = Array.from({ length: 11 }, (_, i) => des(i + 1, Array.from({ length: 100 }, (_, j) => m(i * 100 + j)), 10 + i));
    expect(mergeRequest({ designations: list.slice(0, 10), suggested: [], name: "M" }).ok).toBe(true);
    expect(mergeRequest({ designations: list, suggested: [], name: "M" }).ok).toBe(false);
  });

  it("counts suggestions toward the 10", () => {
    const list = Array.from({ length: 5 }, (_, i) => des(i + 1, [m(i)], 10 + i));
    const sug = Array.from({ length: 6 }, (_, i) => [m(100 + i)]);
    expect(mergeRequest({ designations: list, suggested: sug, name: "M" }).ok).toBe(false);
    expect(mergeRequest({ designations: list, suggested: sug.slice(0, 5), name: "M" }).ok).toBe(true);
  });

  it("refuses a union above 1000 members but accepts exactly 1000 (shared buildings counted once)", () => {
    const a = des(1, Array.from({ length: 600 }, (_, j) => m(j)), 10);
    const b = des(2, Array.from({ length: 600 }, (_, j) => m(400 + j)), 11);
    expect(mergeRequest({ designations: [a, b], suggested: [], name: "M" }).ok).toBe(true);
    const c = des(3, Array.from({ length: 600 }, (_, j) => m(401 + j)), 11);
    expect(mergeRequest({ designations: [a, c], suggested: [], name: "M" }).ok).toBe(false);
  });

  it("merging only suggestions has no expect and no keeper id", () => {
    const r = ok(mergeRequest({ designations: [], suggested: [[m(1)], [m(2)]], name: "M" }));
    expect(r.request.expect).toEqual([]);
    expect(r.request.put[0]).not.toHaveProperty("id");
  });
});

describe("hunt: split edges", () => {
  it("refuses a split whose memberBuildingIds length is off", () => {
    const src = des(1, [m(1), m(2)], 20);
    expect(splitRequest({ source: src, memberBuildingIds: ["B1"], machineIds: new Set(["B1"]), name: "x" }).ok).toBe(false);
  });

  it("selected machines that match nothing leave it as nothing selected", () => {
    const src = des(1, [m(1), m(2)], 20);
    const r = splitRequest({ source: src, memberBuildingIds: ["B1", "B2"], machineIds: new Set(["Z"]), name: "x" });
    expect(r.ok).toBe(false);
  });

  it("never gives a building to both sides when a null-id twin stays", () => {
    const twin = { id: null, c: "Build_ConstructorMk1_C", x: 8, y: 0 };
    const src = des(1, [m(1), twin, m(2)], 20);
    const r = splitRequest({ source: src, memberBuildingIds: ["B1", null, "B2"], machineIds: new Set(["B1", "B2"]), name: "x" });
    if (r.ok) {
      const done = applyReplace([src], r.request, NOW, ids());
      expect(done.ok).toBe(true);
    }
  });
});
