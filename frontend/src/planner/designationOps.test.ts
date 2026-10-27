import { describe, expect, it } from "vitest";
import {
  PLANNER_DESIGNATION_MAX_MEMBERS,
  ReplacePlannerDesignationsRequestSchema,
  type PlannerDesignation,
  type PlannerDesignationMember,
  type ReplacePlannerDesignationsRequest,
} from "@satisfactory-dash/shared";
import {
  plannerDesignationListRevised,
  plannerDesignationReplaceRequestMerge,
  plannerDesignationReplaceRequestUndo,
  plannerDesignationReplaceResponse,
} from "@satisfactory-dash/shared/fixtures";
import { applyReplace, type StoredDesignation } from "../demo/designationStore";
import {
  NEEDS_NEWER_BACKEND,
  NOTHING_SELECTED_IN_FACTORY,
  NOTHING_TO_UNDO,
  TOO_FEW_TO_MERGE,
  TOO_MANY_TO_MERGE,
  WHOLE_FACTORY,
  dissolveRequest,
  mergeRequest,
  popOutName,
  proposedMergeName,
  splitRequest,
  undoRequest,
  type OpResult,
} from "./designationOps";

const NOW = Date.parse("2026-10-27T12:00:00.000Z");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const newIds = () => {
  let n = 900;
  return () => uuid(n++);
};

const member = (n: number, c = "Build_ConstructorMk1_C"): PlannerDesignationMember => ({ id: `B${n}`, c, x: n * 8, y: 0 });

const stored = (n: number, members: PlannerDesignationMember[], createdAt: string, revision = 1): StoredDesignation => ({
  id: uuid(n),
  name: `Factory ${n}`,
  mode: "core",
  members,
  createdAt,
  updatedAt: createdAt,
  revision,
});

const A = stored(1, [member(1), member(2), { id: null, c: "Build_SmelterMk1_C", x: 24, y: 0 }], "2026-10-20T10:00:00.000Z", 4);
const B = stored(2, [member(10), member(11)], "2026-10-21T10:00:00.000Z", 2);
const C = stored(3, [member(20)], "2026-10-22T10:00:00.000Z");

function request(result: OpResult): { request: ReplacePlannerDesignationsRequest; preImage: PlannerDesignation[] } {
  if (!result.ok) throw new Error(`Expected a request, got: ${result.reason}`);
  expect(ReplacePlannerDesignationsRequestSchema.safeParse(result.request).success).toBe(true);
  return result;
}

/** Run an operation on the in-memory store, then its undo, and answer both states. */
function roundTrip(start: StoredDesignation[], result: OpResult) {
  const op = request(result);
  const ids = newIds();
  const done = applyReplace(start, op.request, NOW, ids);
  if (!done.ok) throw new Error(done.code);
  const undo = request(undoRequest(op.preImage, done.response));
  expect(undo.request.intent).toBe("undo");
  const back = applyReplace(done.next, undo.request, NOW + 1000, ids);
  if (!back.ok) throw new Error(back.code);
  return { after: done.next, back: back.next };
}

/** What undo must restore: ids, names, members in order, createdAt, and the list order. */
const identity = (list: readonly PlannerDesignation[]) => list.map((d) => ({ id: d.id, name: d.name, members: d.members, createdAt: d.createdAt }));

describe("mergeRequest", () => {
  it("keeps the oldest designation's id, expects every source at its revision, and unions the members oldest first", () => {
    const { request: r } = request(mergeRequest({ designations: [B, A], suggested: [], name: "Big works" }));
    expect(r.expect).toEqual([
      { id: A.id, revision: 4 },
      { id: B.id, revision: 2 },
    ]);
    expect(r.put).toEqual([{ id: A.id, name: "Big works", members: [...A.members, ...B.members] }]);
    expect(r.intent).toBe("merge");
  });

  it("adds the machines of selected suggestions, after the designations, once per building", () => {
    const free = [member(30), member(31)];
    const { request: r } = request(mergeRequest({ designations: [A], suggested: [free, [member(31), member(32)]], name: "Works" }));
    expect(r.put[0]!.members).toEqual([...A.members, member(30), member(31), member(32)]);
  });

  it("merges suggestions alone into a new designation, with nothing expected", () => {
    const { request: r, preImage } = request(mergeRequest({ designations: [], suggested: [[member(1)], [member(2)]], name: "New" }));
    expect(r.expect).toEqual([]);
    expect(r.put).toEqual([{ name: "New", members: [member(1), member(2)] }]);
    expect(preImage).toEqual([]);
  });

  it("drops a building two sources both name (an id, or a position when one side has none)", () => {
    const twin = stored(4, [{ id: "B1", c: "Build_ConstructorMk1_C", x: 8, y: 0 }, { id: "S9", c: "Build_SmelterMk1_C", x: 24, y: 0 }], "2026-10-25T00:00:00.000Z");
    const { request: r } = request(mergeRequest({ designations: [A, twin], suggested: [], name: "N" }));
    expect(r.put[0]!.members).toEqual(A.members);
  });

  it("matches the contract fixture's merge", () => {
    const [line, annex] = plannerDesignationListRevised.designations;
    const { request: r } = request(mergeRequest({ designations: [line!, annex!], suggested: [], name: "Iron line" }));
    expect(r).toEqual(plannerDesignationReplaceRequestMerge);
  });

  it("needs two to ten factories", () => {
    expect(mergeRequest({ designations: [A], suggested: [], name: "N" })).toEqual({ ok: false, reason: TOO_FEW_TO_MERGE });
    const eleven = Array.from({ length: 11 }, (_, i) => [member(100 + i)]);
    expect(mergeRequest({ designations: [], suggested: eleven, name: "N" })).toEqual({ ok: false, reason: TOO_MANY_TO_MERGE });
    expect(request(mergeRequest({ designations: [], suggested: eleven.slice(1), name: "N" })).request.put[0]!.members).toHaveLength(10);
  });

  it("refuses more machines than a designation holds, naming the number", () => {
    const big = Array.from({ length: 600 }, (_, i) => member(1000 + i));
    const more = Array.from({ length: 401 }, (_, i) => member(5000 + i));
    const result = mergeRequest({ designations: [], suggested: [big, more], name: "N" });
    expect(result).toEqual({ ok: false, reason: `A factory can hold up to ${PLANNER_DESIGNATION_MAX_MEMBERS} machines; these have 1001.` });
    expect(mergeRequest({ designations: [], suggested: [big, more.slice(1)], name: "N" }).ok).toBe(true);
  });

  it("needs revisions from the backend", () => {
    const old: PlannerDesignation = { ...A, revision: undefined };
    expect(mergeRequest({ designations: [old, B], suggested: [], name: "N" })).toEqual({ ok: false, reason: NEEDS_NEWER_BACKEND });
  });

  it("is refused before sending when the name is not one", () => {
    expect(mergeRequest({ designations: [A, B], suggested: [], name: "" }).ok).toBe(false);
  });
});

describe("splitRequest", () => {
  const ids = ["live-1", "live-2", null] as const;

  it("moves the members matched to selected machines into a new designation and keeps the rest under the source", () => {
    const { request: r, preImage } = request(splitRequest({ source: A, memberBuildingIds: ids, machineIds: new Set(["live-2"]), name: "Split off" }));
    expect(r.expect).toEqual([{ id: A.id, revision: 4 }]);
    expect(r.put).toEqual([
      { id: A.id, name: A.name, members: [A.members[0], A.members[2]] },
      { name: "Split off", members: [A.members[1]] },
    ]);
    expect(r.intent).toBe("split");
    expect(preImage).toEqual([A]);
  });

  it("leaves members the matcher cannot find with the source", () => {
    const { request: r } = request(splitRequest({ source: A, memberBuildingIds: [null, "live-2", null], machineIds: new Set(["live-2", "x"]), name: "S" }));
    expect(r.put[0]!.members).toEqual([A.members[0], A.members[2]]);
  });

  it("says when nothing selected is in the factory, or when everything is", () => {
    expect(splitRequest({ source: A, memberBuildingIds: ids, machineIds: new Set(["other"]), name: "S" })).toEqual({ ok: false, reason: NOTHING_SELECTED_IN_FACTORY });
    const whole = splitRequest({ source: B, memberBuildingIds: ["b1", "b2"], machineIds: new Set(["b1", "b2"]), name: "S" });
    expect(whole).toEqual({ ok: false, reason: WHOLE_FACTORY });
  });

  it("needs a revision and the member-to-building ids, aligned to the members", () => {
    expect(splitRequest({ source: A, memberBuildingIds: undefined, machineIds: new Set(["live-1"]), name: "S" })).toEqual({ ok: false, reason: NEEDS_NEWER_BACKEND });
    expect(splitRequest({ source: A, memberBuildingIds: ["live-1"], machineIds: new Set(["live-1"]), name: "S" })).toEqual({ ok: false, reason: NEEDS_NEWER_BACKEND });
    expect(splitRequest({ source: { ...A, revision: undefined }, memberBuildingIds: ids, machineIds: new Set(["live-1"]), name: "S" }).ok).toBe(false);
  });

  it("is a pop-out when asked, with the node's name", () => {
    const { request: r } = request(splitRequest({ source: A, memberBuildingIds: ids, machineIds: new Set(["live-1"]), name: popOutName({ name: "Constructor", recipe: "Iron Plate" }), intent: "pop_out" }));
    expect(r.intent).toBe("pop_out");
    expect(r.put[1]!.name).toBe("Iron Plate, Constructor");
  });
});

describe("dissolveRequest", () => {
  it("expects the designation and puts nothing", () => {
    const { request: r } = request(dissolveRequest(B));
    expect(r).toEqual({ expect: [{ id: B.id, revision: 2 }], put: [], intent: "dissolve" });
    expect(dissolveRequest({ ...B, revision: undefined })).toEqual({ ok: false, reason: NEEDS_NEWER_BACKEND });
  });
});

describe("undoRequest", () => {
  it("is the inverse the contract fixture shows for the merge (overlapping originals: the older keeps the building)", () => {
    const [line, annex] = plannerDesignationListRevised.designations;
    const { request: r } = request(undoRequest([line!, annex!], plannerDesignationReplaceResponse));
    expect(r).toEqual(plannerDesignationReplaceRequestUndo);
  });

  it("sends the stored members, never the matcher's building ids", () => {
    const { request: r } = request(undoRequest([A], { designations: [{ ...A, revision: 5 }], removedIds: [] }));
    expect(r.put[0]!.members).toEqual(A.members);
    expect(r.put[0]).toMatchObject({ id: A.id, createdAt: A.createdAt });
  });

  it("has nothing to undo for an empty change", () => {
    expect(undoRequest([], { designations: [], removedIds: [] })).toEqual({ ok: false, reason: NOTHING_TO_UNDO });
  });
});

describe("round trips through the replace rules", () => {
  const start = [A, B, C];

  it("merge then Split back is the identity on ids, names, members, order and createdAt", () => {
    const { after, back } = roundTrip(start, mergeRequest({ designations: [A, B, C], suggested: [], name: "All" }));
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(A.id);
    expect(identity(back)).toEqual(identity(start));
  });

  it("a merge with a suggestion, undone, frees the suggestion's machines again", () => {
    const { after, back } = roundTrip(start, mergeRequest({ designations: [B], suggested: [[member(40)]], name: "B+" }));
    expect(after.find((d) => d.id === B.id)!.members).toContainEqual(member(40));
    expect(identity(back)).toEqual(identity(start));
  });

  it("split then undo is the identity", () => {
    const { after, back } = roundTrip(start, splitRequest({ source: A, memberBuildingIds: ["l1", "l2", "l3"], machineIds: new Set(["l1", "l3"]), name: "Part" }));
    expect(after).toHaveLength(4);
    expect(identity(back)).toEqual(identity(start));
  });

  it("pop-out then undo is the identity", () => {
    const { back } = roundTrip(start, splitRequest({ source: B, memberBuildingIds: ["b1", "b2"], machineIds: new Set(["b2"]), name: "Popped", intent: "pop_out" }));
    expect(identity(back)).toEqual(identity(start));
  });

  it("dissolve then undo is the identity", () => {
    const { after, back } = roundTrip(start, dissolveRequest(B));
    expect(after.map((d) => d.id)).toEqual([A.id, C.id]);
    expect(identity(back)).toEqual(identity(start));
  });

  it("an undo after someone else changed a result is stale and changes nothing", () => {
    const op = request(dissolveRequest(B));
    const merged = request(mergeRequest({ designations: [A, C], suggested: [], name: "AC" }));
    const ids = newIds();
    const first = applyReplace(start, merged.request, NOW, ids);
    if (!first.ok) throw new Error(first.code);
    const undo = request(undoRequest(merged.preImage, first.response));
    // Someone renames the merged one meanwhile: its revision moves on.
    const renamed = first.next.map((d) => (d.id === A.id ? { ...d, revision: d.revision + 1 } : d));
    expect(applyReplace(renamed, undo.request, NOW, ids)).toMatchObject({ ok: false, code: "designation_stale" });
    expect(op.request.intent).toBe("dissolve");
  });
});

describe("names", () => {
  it("proposes the largest source's name", () => {
    expect(proposedMergeName([{ name: "Small", machineCount: 2 }, { name: "Large", machineCount: 9 }, { name: "Mid", machineCount: 9 }])).toBe("Large");
    expect(proposedMergeName([])).toBe("");
    expect(proposedMergeName([{ name: "x".repeat(80), machineCount: 1 }])).toBe("x".repeat(64));
    expect(proposedMergeName([{ name: "bad​name", machineCount: 1 }])).toBe("");
  });

  it("names a popped-out group after what it makes and what it is", () => {
    expect(popOutName({ name: "Smelter", recipe: null })).toBe("Smelter");
    expect(popOutName({ name: "Constructor", recipe: "Screw" })).toBe("Screw, Constructor");
    expect(popOutName({ name: "‮", recipe: null })).toBe("Popped-out group");
  });
});
