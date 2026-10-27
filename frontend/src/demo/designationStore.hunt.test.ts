import { describe, expect, it } from "vitest";
import { applyReplace, type StoredDesignation } from "./designationStore";

const NOW = Date.parse("2026-10-27T12:00:00.000Z");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const mem = (id: string | null, x = 0) => ({ id, c: "Build_ConstructorMk1_C", x, y: 0 });
const des = (n: number, members: ReturnType<typeof mem>[], revision = 1): StoredDesignation => ({
  id: uuid(n),
  name: `F${n}`,
  mode: "core",
  members,
  createdAt: `2026-10-${10 + n}T10:00:00.000Z`,
  updatedAt: `2026-10-${10 + n}T10:00:00.000Z`,
  revision,
});
let next = 900;
const newId = () => uuid(next++);

describe("hunt: applyReplace", () => {
  const list = [des(1, [mem("a")], 3), des(2, [mem("b")], 5)];
  it("stale when an expected revision is behind, ahead, or the id is gone", () => {
    for (const e of [{ id: uuid(1), revision: 2 }, { id: uuid(1), revision: 4 }, { id: uuid(9), revision: 1 }]) {
      const r = applyReplace(list, { expect: [e], put: [] }, NOW, newId);
      expect(r).toMatchObject({ ok: false, code: "designation_stale" });
    }
  });
  it("overlap with a designation outside expect is 409 overlap naming it", () => {
    const r = applyReplace(list, { expect: [{ id: uuid(1), revision: 3 }], put: [{ id: uuid(1), name: "x", members: [mem("b")] }] }, NOW, newId);
    expect(r).toMatchObject({ ok: false, code: "designation_overlap", other: { id: uuid(2) } });
  });
  it("a put keeping an id that exists outside expect is stale", () => {
    const r = applyReplace(list, { expect: [{ id: uuid(1), revision: 3 }], put: [{ id: uuid(2), name: "x", members: [mem("z")] }] }, NOW, newId);
    expect(r).toMatchObject({ ok: false, code: "designation_stale" });
  });
  it("a future createdAt is refused; a past one is kept on insert", () => {
    const body = (createdAt: string) => ({ expect: [], put: [{ name: "x", members: [mem("z")], createdAt }] });
    expect(applyReplace(list, body("2026-10-28T00:00:00.000Z"), NOW, newId)).toMatchObject({ ok: false, status: 400 });
    const r = applyReplace(list, body("2026-10-01T00:00:00.000Z"), NOW, newId);
    expect(r.ok && r.response.designations[0]!.createdAt).toBe("2026-10-01T00:00:00.000Z");
  });
  it("in-place update keeps createdAt and bumps revision; removed ids list only the unput ones", () => {
    const r = applyReplace(
      list,
      { expect: [{ id: uuid(1), revision: 3 }, { id: uuid(2), revision: 5 }], put: [{ id: uuid(1), name: "n", members: [mem("a"), mem("b")], createdAt: "2026-10-01T00:00:00.000Z" }] },
      NOW,
      newId,
    );
    if (!r.ok) throw new Error(r.message);
    expect(r.response.designations[0]).toMatchObject({ id: uuid(1), revision: 4, createdAt: list[0]!.createdAt });
    expect(r.response.removedIds).toEqual([uuid(2)]);
    expect(r.next).toHaveLength(1);
  });
  it("the cap counts the result, not the input", () => {
    const many = Array.from({ length: 50 }, (_, i) => des(i + 1, [mem(`m${i}`)]));
    expect(applyReplace(many, { expect: [], put: [{ name: "x", members: [mem("new")] }] }, NOW, newId)).toMatchObject({ code: "designation_cap" });
    expect(
      applyReplace(many, { expect: [{ id: uuid(1), revision: 1 }], put: [{ name: "x", members: [mem("new")] }] }, NOW, newId).ok,
    ).toBe(true);
  });
});
