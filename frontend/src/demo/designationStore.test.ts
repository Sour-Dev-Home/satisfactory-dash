import { describe, expect, it } from "vitest";
import { PLANNER_DESIGNATIONS_MAX_PER_SERVER } from "@satisfactory-dash/shared";
import { applyCreate, applyRemove, applyReplace, applyUpdate, type StoredDesignation } from "./designationStore";

const NOW = Date.parse("2026-10-27T12:00:00.000Z");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ids = () => {
  let n = 500;
  return () => uuid(n++);
};
const m = (n: number) => ({ id: `B${n}`, c: "Build_SmelterMk1_C", x: n, y: 0 });
const d = (n: number, members = [m(n)], revision = 1): StoredDesignation => ({
  id: uuid(n),
  name: `D${n}`,
  mode: "core",
  members,
  createdAt: `2026-10-2${n % 10}T00:00:00.000Z`,
  updatedAt: `2026-10-2${n % 10}T00:00:00.000Z`,
  revision,
});

describe("applyReplace", () => {
  it("updates an expected designation in place: kept id and createdAt, revision + 1", () => {
    const out = applyReplace([d(1)], { expect: [{ id: uuid(1), revision: 1 }], put: [{ id: uuid(1), name: "New", members: [m(1), m(2)] }] }, NOW, ids());
    if (!out.ok) throw new Error(out.code);
    expect(out.response.designations[0]).toMatchObject({ id: uuid(1), name: "New", createdAt: d(1).createdAt, revision: 2 });
    expect(out.response.removedIds).toEqual([]);
  });

  it("is stale when an expected designation is gone or at another revision, or an inserted id is still present", () => {
    expect(applyReplace([d(1)], { expect: [{ id: uuid(1), revision: 2 }], put: [] }, NOW, ids())).toMatchObject({ code: "designation_stale" });
    expect(applyReplace([], { expect: [{ id: uuid(1), revision: 1 }], put: [] }, NOW, ids())).toMatchObject({ code: "designation_stale" });
    expect(applyReplace([d(1)], { expect: [], put: [{ id: uuid(1), name: "X", members: [m(9)] }] }, NOW, ids())).toMatchObject({ code: "designation_stale" });
  });

  it("refuses a building another designation holds, naming it", () => {
    expect(applyReplace([d(1), d(2)], { expect: [{ id: uuid(1), revision: 1 }], put: [{ name: "X", members: [m(2)] }] }, NOW, ids())).toMatchObject({
      status: 409,
      code: "designation_overlap",
      other: { id: uuid(2), name: "D2" },
    });
  });

  it("refuses a resulting count above the cap and a createdAt in the future", () => {
    const full = Array.from({ length: PLANNER_DESIGNATIONS_MAX_PER_SERVER }, (_, i) => d(i + 1));
    expect(applyReplace(full, { expect: [], put: [{ name: "X", members: [m(999)] }] }, NOW, ids())).toMatchObject({ code: "designation_cap" });
    expect(applyReplace([], { expect: [], put: [{ name: "X", members: [m(9)], createdAt: "2030-01-01T00:00:00.000Z" }] }, NOW, ids())).toMatchObject({ status: 400 });
  });

  it("removes an expected designation no put names, and keeps the list oldest first", () => {
    const out = applyReplace([d(1), d(2)], { expect: [{ id: uuid(1), revision: 1 }], put: [] }, NOW, ids());
    if (!out.ok) throw new Error(out.code);
    expect(out.response.removedIds).toEqual([uuid(1)]);
    const restored = applyReplace(out.next, { expect: [], put: [{ id: uuid(1), name: "D1", members: [m(1)], createdAt: d(1).createdAt }] }, NOW, ids());
    if (!restored.ok) throw new Error(restored.code);
    expect(restored.next.map((x) => x.id)).toEqual([uuid(1), uuid(2)]);
  });
});

describe("the single writes", () => {
  it("creates, renames and removes", () => {
    const made = applyCreate([d(1)], { name: "New", members: [m(5)] }, NOW, ids());
    if (!made.ok) throw new Error(made.code);
    expect(made.next).toHaveLength(2);
    expect(applyCreate([d(1)], { name: "Dup", members: [m(1)] }, NOW, ids())).toMatchObject({ code: "designation_overlap" });
    const renamed = applyUpdate(made.next, made.designation.id, { name: "Renamed" }, NOW);
    if (!renamed.ok) throw new Error(renamed.code);
    expect(renamed.designation).toMatchObject({ name: "Renamed", revision: 2 });
    expect(applyUpdate([], uuid(3), { name: "X" }, NOW)).toMatchObject({ status: 404 });
    expect(applyRemove(renamed.next, uuid(1))).toMatchObject({ ok: true });
    expect(applyRemove([], uuid(1))).toMatchObject({ status: 404 });
  });
});
