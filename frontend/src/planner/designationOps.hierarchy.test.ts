import { describe, expect, it } from "vitest";
import {
  ReplacePlannerDesignationsRequestSchema,
  type PlannerDesignation,
  type PlannerDesignationMember,
  type ReplacePlannerDesignationsRequest,
} from "@satisfactory-dash/shared";
import { applyReplace, type StoredDesignation } from "../demo/designationStore";
import {
  ALREADY_THERE,
  GROUP_MAX,
  NEEDS_NEWER_BACKEND,
  NOTHING_TO_MOVE,
  NOTHING_TO_UNGROUP,
  TOO_FEW_TO_GROUP,
  TOO_MANY_TO_GROUP,
  TOP_LEVEL,
  designatedName,
  dissolveRequest,
  groupRequest,
  moveRequest,
  moveTargets,
  splitRequest,
  undoRequest,
  ungroupRequest,
  type HierarchyPick,
  type OpResult,
} from "./designationOps";
import { CYCLE_TEXT, DEPTH_TEXT, designationErrorText, SHAPE_TEXT } from "./designationText";
import { ApiError } from "../api/errors";

// ADR-0061 build PR 5 (Decision 6): group, ungroup and move as one replace each, their undo, and the overlap, depth, cycle
// and stale paths. Round trips run on the demo's in-memory store, which follows the backend's replace rules.

const NOW = Date.parse("2026-10-28T12:00:00.000Z");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NEW = uuid(999);
const ids = () => {
  let n = 900;
  return () => uuid(n++);
};
const member = (n: number): PlannerDesignationMember => ({ id: `B${n}`, c: "Build_ConstructorMk1_C", x: n * 8, y: 0 });

const d = (n: number, parent: number | null, members: number[], revision = 1): StoredDesignation => ({
  id: uuid(n),
  name: `D${n}`,
  mode: "core",
  members: members.map(member),
  createdAt: `2026-10-2${n % 8}T10:00:00.000Z`,
  updatedAt: "2026-10-27T10:00:00.000Z",
  revision,
  parentId: parent === null ? null : uuid(parent),
});

// Top: 1 (no machines) > 2 (owns B20) > 3 (B30) and 4 (B40); 5 (B50) and 6 (B60) on their own at the top level.
const world = (): StoredDesignation[] => [d(1, null, []), d(2, 1, [20], 3), d(3, 2, [30]), d(4, 2, [40], 2), d(5, null, [50]), d(6, null, [60])];
const byN = (list: readonly PlannerDesignation[], n: number) => list.find((x) => x.id === uuid(n))!;
const pick = (x: PlannerDesignation): HierarchyPick => ({ designation: x });
const auto = (name: string, ns: number[]): HierarchyPick => ({ automatic: { name, members: ns.map(member) } });

function ok(result: OpResult) {
  if (!result.ok) throw new Error(`Expected a request, got: ${result.reason}`);
  expect(ReplacePlannerDesignationsRequestSchema.safeParse(result.request).success).toBe(true);
  return result;
}

/** The tree as (id, parent, members) rows, ordered by id: what group, move and undo change. */
const shape = (list: readonly PlannerDesignation[]) =>
  [...list].sort((a, b) => (a.id < b.id ? -1 : 1)).map((x) => ({ id: x.id, name: x.name, parentId: x.parentId ?? null, members: x.members }));

/** Runs an operation on the store and then its undo, answering the three states. */
function roundTrip(start: StoredDesignation[], result: OpResult) {
  const op = ok(result);
  const next = ids();
  const done = applyReplace(start, op.request, NOW, next);
  if (!done.ok) throw new Error(done.code);
  const undo = ok(undoRequest(op.preImage, done.response));
  expect(undo.request.intent).toBe("undo");
  const back = applyReplace(done.next, undo.request, NOW + 1000, next);
  if (!back.ok) throw new Error(back.code);
  return { request: op.request, undo: undo.request, after: done.next, back: back.next };
}

const putOf = (r: ReplacePlannerDesignationsRequest, id: string) => r.put.find((p) => p.id === id);

describe("groupRequest", () => {
  it("puts the new parent where the picks stood and moves each designated pick into it, as one replace", () => {
    const all = world();
    const { request: r, preImage } = ok(groupRequest({ all, picks: [pick(byN(all, 5)), pick(byN(all, 6))], name: "East", parentId: null, newId: NEW }));
    expect(r.intent).toBe("group");
    expect(r.expect).toEqual([
      { id: uuid(5), revision: 1 },
      { id: uuid(6), revision: 1 },
    ]);
    expect(r.put[0]).toEqual({ id: NEW, name: "East", members: [] });
    expect(putOf(r, uuid(5))).toEqual({ id: uuid(5), name: "D5", members: [member(50)], parentId: NEW });
    expect(preImage.map((x) => x.id)).toEqual([uuid(5), uuid(6)]);
  });

  it("designates picked automatic factories in the same replace, inside the new parent", () => {
    const all = world();
    const { request: r } = ok(groupRequest({ all, picks: [pick(byN(all, 5)), auto("Screws", [70, 71])], name: "East", parentId: null, newId: NEW }));
    expect(r.put).toContainEqual({ name: "Screws", members: [member(70), member(71)], parentId: NEW });
    // The automatic factory was never stored, so nothing about it is expected.
    expect(r.expect).toEqual([{ id: uuid(5), revision: 1 }]);
  });

  it("groups automatic factories alone (nothing expected) and undo removes all it made", () => {
    const all = world();
    const trip = roundTrip(all, groupRequest({ all, picks: [auto("A", [70]), auto("B", [80])], name: "New area", parentId: null, newId: NEW }));
    expect(trip.request.expect).toEqual([]);
    expect(trip.after).toHaveLength(all.length + 3);
    expect(trip.undo.put).toEqual([]);
    expect(trip.undo.expect).toHaveLength(3);
    expect(shape(trip.back)).toEqual(shape(all));
  });

  it("nests the new parent under the level's parent, and undo puts every pick back with its parent said", () => {
    // 8 (no machines) > 9 and 10: grouping 9 and 10 inside 8 makes 8 > new > 9, three deep.
    const all = [...world(), d(8, null, []), d(9, 8, [90]), d(10, 8, [100])];
    const trip = roundTrip(all, groupRequest({ all, picks: [pick(byN(all, 9)), pick(byN(all, 10))], name: "Lines", parentId: uuid(8), newId: NEW }));
    expect(trip.request.put[0]).toEqual({ id: NEW, name: "Lines", members: [], parentId: uuid(8) });
    // 8 loses both its factories but gains the new one, so it stays.
    expect(trip.request.expect.map((e) => e.id).sort()).toEqual([uuid(9), uuid(10)].sort());
    expect(trip.undo.put.find((p) => p.id === uuid(9))?.parentId).toBe(uuid(8));
    expect(shape(trip.back)).toEqual(shape(all));
  });

  it("is refused past the depth limit, before anything is sent", () => {
    const all = world();
    // 1 > 2 > 3 is three deep already: a new parent above 1 makes four.
    expect(groupRequest({ all, picks: [pick(byN(all, 1)), pick(byN(all, 5))], name: "Base", parentId: null, newId: NEW })).toEqual({ ok: false, reason: DEPTH_TEXT });
    // Under 2, the new parent is level 3 and its parts level 4.
    expect(groupRequest({ all, picks: [pick(byN(all, 3)), pick(byN(all, 4))], name: "Deep", parentId: uuid(2), newId: NEW }).ok).toBe(false);
  });

  it("needs two to GROUP_MAX factories", () => {
    const all = world();
    expect(groupRequest({ all, picks: [pick(byN(all, 5))], name: "N", parentId: null, newId: NEW })).toEqual({ ok: false, reason: TOO_FEW_TO_GROUP });
    const many = Array.from({ length: GROUP_MAX + 1 }, (_, i) => auto(`A${i}`, [100 + i]));
    expect(groupRequest({ all, picks: many, name: "N", parentId: null, newId: NEW })).toEqual({ ok: false, reason: TOO_MANY_TO_GROUP });
    expect(groupRequest({ all, picks: many.slice(1), name: "N", parentId: null, newId: NEW }).ok).toBe(true);
  });

  it("refuses an automatic factory whose machines another designation already holds, naming it (the overlap path)", () => {
    const all = world();
    const result = groupRequest({ all, picks: [pick(byN(all, 5)), auto("Screws", [70, 60])], name: "N", parentId: null, newId: NEW });
    expect(result).toEqual({ ok: false, reason: "Some of these machines already belong to D6" });
  });

  it("needs revisions from the backend", () => {
    const all: PlannerDesignation[] = world().map((x) => ({ ...x, revision: undefined }));
    expect(groupRequest({ all, picks: [pick(all[4]!), pick(all[5]!)], name: "N", parentId: null, newId: NEW })).toEqual({ ok: false, reason: NEEDS_NEWER_BACKEND });
  });

  it("names an automatic factory by its own name, or a plain fallback", () => {
    expect(designatedName("  Screws ")).toBe("Screws");
    expect(designatedName("bad\u0007name")).toBe("Factory");
  });
});

describe("ungroupRequest", () => {
  it("moves a parent's factories up and removes a parent that owns no machines; undo re-inserts it with its parent said", () => {
    const all = [...world(), d(7, 1, [70])];
    const trip = roundTrip(all, ungroupRequest({ all, parent: byN(all, 1) }));
    expect(trip.request.intent).toBe("ungroup");
    expect(trip.request.expect).toEqual(expect.arrayContaining([{ id: uuid(1), revision: 1 }, { id: uuid(2), revision: 3 }, { id: uuid(7), revision: 1 }]));
    expect(trip.request.put).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: uuid(2), parentId: null }), expect.objectContaining({ id: uuid(7), parentId: null })]),
    );
    expect(trip.request.put.some((p) => p.id === uuid(1))).toBe(false);
    expect(trip.after.some((x) => x.id === uuid(1))).toBe(false);
    // The undo of an ungroup names the parent on every put: an insert without one would be top level.
    expect(trip.undo.put).toContainEqual(expect.objectContaining({ id: uuid(1), members: [], parentId: null }));
    expect(trip.undo.put).toContainEqual(expect.objectContaining({ id: uuid(2), parentId: uuid(1) }));
    expect(shape(trip.back)).toEqual(shape(all));
  });

  it("keeps a parent that owns machines, as their factory where it stood", () => {
    const all = world();
    const trip = roundTrip(all, ungroupRequest({ all, parent: byN(all, 2) }));
    expect(trip.request.expect.map((e) => e.id).sort()).toEqual([uuid(3), uuid(4)]);
    expect(trip.request.put.every((p) => p.parentId === uuid(1))).toBe(true);
    expect(byN(trip.after, 2).parentId).toBe(uuid(1));
    expect(shape(trip.back)).toEqual(shape(all));
  });

  it("says when there is nothing inside to ungroup", () => {
    const all = world();
    expect(ungroupRequest({ all, parent: byN(all, 5) })).toEqual({ ok: false, reason: NOTHING_TO_UNGROUP });
  });
});

describe("moveRequest", () => {
  it("moves into another factory, which then has factories in it, and undo moves back", () => {
    const all = world();
    const trip = roundTrip(all, moveRequest({ all, picks: [pick(byN(all, 6))], to: uuid(5) }));
    expect(trip.request).toMatchObject({ intent: "move", expect: [{ id: uuid(6), revision: 1 }], put: [{ id: uuid(6), parentId: uuid(5) }] });
    expect(trip.undo.put).toEqual([expect.objectContaining({ id: uuid(6), parentId: null })]);
    expect(shape(trip.back)).toEqual(shape(all));
  });

  it("moves to the top level with parentId null said (absent would keep the parent)", () => {
    const all = world();
    const { request: r } = ok(moveRequest({ all, picks: [pick(byN(all, 3))], to: null }));
    expect(r.put).toEqual([{ id: uuid(3), name: "D3", members: [member(30)], parentId: null }]);
  });

  it("removes a parent the move leaves with nothing, up the tree, and undo restores both", () => {
    // 8 (no machines) > 9 (no machines) > 10 (B100): moving 10 out empties 9, which empties 8.
    const all = [...world(), d(8, null, []), d(9, 8, []), d(10, 9, [100])];
    const trip = roundTrip(all, moveRequest({ all, picks: [pick(byN(all, 10))], to: uuid(5) }));
    expect(trip.request.expect.map((e) => e.id).sort()).toEqual([uuid(10), uuid(8), uuid(9)].sort());
    expect(trip.request.put.map((p) => p.id)).toEqual([uuid(10)]);
    expect(trip.after.some((x) => x.id === uuid(8) || x.id === uuid(9))).toBe(false);
    expect(shape(trip.back)).toEqual(shape(all));
  });

  it("keeps a parent that still has a factory or machines after the move", () => {
    const all = world();
    const { request: r } = ok(moveRequest({ all, picks: [pick(byN(all, 3))], to: uuid(5) }));
    expect(r.expect).toEqual([{ id: uuid(3), revision: 1 }]);
  });

  it("designates a picked automatic factory where it goes", () => {
    const all = world();
    const { request: r } = ok(moveRequest({ all, picks: [auto("Screws", [70])], to: uuid(1) }));
    expect(r.put).toEqual([{ name: "Screws", members: [member(70)], parentId: uuid(1) }]);
  });

  it("refuses a cycle: into itself, or into a factory inside it", () => {
    const all = world();
    expect(moveRequest({ all, picks: [pick(byN(all, 1))], to: uuid(1) })).toEqual({ ok: false, reason: CYCLE_TEXT });
    expect(moveRequest({ all, picks: [pick(byN(all, 1))], to: uuid(3) })).toEqual({ ok: false, reason: CYCLE_TEXT });
  });

  it("refuses a move past the depth limit", () => {
    const all = [...world(), d(7, 5, [70])];
    expect(moveRequest({ all, picks: [pick(byN(all, 6))], to: uuid(3) })).toEqual({ ok: false, reason: DEPTH_TEXT });
    // 2 carries 3 with it: inside 5 > 7 that is four deep, inside 5 three.
    expect(moveRequest({ all, picks: [pick(byN(all, 2))], to: uuid(7) })).toEqual({ ok: false, reason: DEPTH_TEXT });
    expect(moveRequest({ all, picks: [pick(byN(all, 2))], to: uuid(5) }).ok).toBe(true);
  });

  it("says when there is nothing to move, or they are already there", () => {
    const all = world();
    expect(moveRequest({ all, picks: [], to: null })).toEqual({ ok: false, reason: NOTHING_TO_MOVE });
    expect(moveRequest({ all, picks: [pick(byN(all, 3)), pick(byN(all, 4))], to: uuid(2) })).toEqual({ ok: false, reason: ALREADY_THERE });
  });

  it("is not blocked by an old cycle elsewhere in the list", () => {
    const all = [...world(), { ...d(11, 12, [110]) }, { ...d(12, 11, [120]) }];
    expect(moveRequest({ all, picks: [pick(byN(all, 6))], to: uuid(5) }).ok).toBe(true);
  });
});

describe("moveTargets", () => {
  it("lists the top level and every designation a move is accepted into, by path, but not where they are", () => {
    const all = world();
    const targets = moveTargets(all, [pick(byN(all, 3))], uuid(2));
    // Not 2 (where it is), not 3 (itself), not 4 (1 > 2 > 4 > 3 would be four deep).
    expect(targets).toEqual([
      { id: null, label: TOP_LEVEL },
      { id: uuid(1), label: "D1" },
      { id: uuid(5), label: "D5" },
      { id: uuid(6), label: "D6" },
    ]);
    // A path names each level, root first.
    expect(moveTargets(all, [pick(byN(all, 6))], null)).toContainEqual({ id: uuid(2), label: "D1 / D2" });
  });

  it("leaves out the picks themselves, what is inside them, and anywhere too deep", () => {
    const all = world();
    const targets = moveTargets(all, [pick(byN(all, 1))], null).map((t) => t.id);
    expect(targets).not.toContain(uuid(1));
    expect(targets).not.toContain(uuid(2));
    expect(targets).not.toContain(null);
    // 1 is three deep: nowhere else takes it.
    expect(targets).toEqual([]);
  });
});

describe("dissolve and split in the tree", () => {
  it("dissolving a parent's last factory removes the parent too, and undo restores both", () => {
    const all = [...world(), d(8, null, []), d(9, 8, [90])];
    const trip = roundTrip(all, dissolveRequest(byN(all, 9), all));
    expect(trip.request.expect.map((e) => e.id).sort()).toEqual([uuid(8), uuid(9)].sort());
    expect(trip.request.put).toEqual([]);
    expect(shape(trip.back)).toEqual(shape(all));
  });

  it("dissolving a parent moves its factories up, as the server's delete does", () => {
    const all = world();
    const { request: r } = ok(dissolveRequest(byN(all, 2), all));
    expect(r.expect.map((e) => e.id).sort()).toEqual([uuid(2), uuid(3), uuid(4)]);
    expect(r.put.map((p) => [p.id, p.parentId])).toEqual([
      [uuid(3), uuid(1)],
      [uuid(4), uuid(1)],
    ]);
  });

  it("a split keeps the new factory beside its source in the tree", () => {
    const source = { ...d(3, 2, [30, 31]) };
    const { request: r } = ok(splitRequest({ source, memberBuildingIds: ["B30", "B31"], machineIds: new Set(["B31"]), name: "Out" }));
    expect(r.put[1]).toEqual({ name: "Out", members: [member(31)], parentId: uuid(2) });
  });
});

describe("stale paths", () => {
  it("an undo after someone else changed a factory is refused by the server as stale, never overwriting", () => {
    const all = world();
    const op = ok(moveRequest({ all, picks: [pick(byN(all, 6))], to: uuid(5) }));
    const done = applyReplace(all, op.request, NOW, ids());
    if (!done.ok) throw new Error(done.code);
    // Someone renames 6 meanwhile: its revision moves on.
    const theirs = done.next.map((x) => (x.id === uuid(6) ? { ...x, name: "Theirs", revision: x.revision + 1 } : x));
    const undo = ok(undoRequest(op.preImage, done.response));
    const back = applyReplace(theirs, undo.request, NOW + 1000, ids());
    expect(back).toMatchObject({ ok: false, code: "designation_stale" });
  });

  it("each 409 code reads in the planner's words", () => {
    const err = (code: "designation_depth" | "designation_cycle" | "designation_shape") => new ApiError(409, { code, message: "x", requestId: "r" });
    expect(designationErrorText(err("designation_depth"))).toBe(DEPTH_TEXT);
    expect(designationErrorText(err("designation_cycle"))).toBe(CYCLE_TEXT);
    expect(designationErrorText(err("designation_shape"))).toBe(SHAPE_TEXT);
    expect(DEPTH_TEXT).toBe("Factories nest at most 3 levels.");
  });
});
