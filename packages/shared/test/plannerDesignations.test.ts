import { describe, expect, it } from "vitest";
import * as fixtures from "../fixtures/index";
import {
  ApiErrorResponseSchema,
  CreatePlannerDesignationRequestSchema,
  DesignationOverlapErrorSchema,
  KnownErrorCode,
  PLANNER_DESIGNATIONS_MAX_PER_SERVER,
  PLANNER_DESIGNATION_MAX_MEMBERS,
  PlannerDesignationSchema,
  PlannerDesignationsResponseSchema,
  UpdatePlannerDesignationRequestSchema,
  PlannerDesignationMatchSchema,
  ReplacePlannerDesignationsRequestSchema,
  ReplacePlannerDesignationsResponseSchema,
  PLANNER_DESIGNATIONS_REPLACE_MAX_EXPECT,
  PLANNER_DESIGNATIONS_REPLACE_MAX_PUT,
  PLANNER_DESIGNATIONS_REPLACE_MAX_TOTAL_MEMBERS,
  PLANNER_DESIGNATION_REVISION_MAX,
  PLANNER_DESIGNATION_MATCH_RADIUS_METRES,
  KNOWN_PLANNER_DESIGNATIONS_REPLACE_INTENTS,
  endpoints,
} from "../src/index";

const member = { id: "b-1", c: "Build_SmelterMk1_C", x: 10, y: -20 };
const create = (over: Record<string, unknown> = {}) => ({ name: "Iron", mode: "core", members: [member], ...over });

describe("planner designations: names", () => {
  it("accepts 1 to 64 visible characters", () => {
    expect(CreatePlannerDesignationRequestSchema.safeParse(create({ name: "A" })).success).toBe(true);
    expect(CreatePlannerDesignationRequestSchema.safeParse(create({ name: "x".repeat(64) })).success).toBe(true);
    expect(CreatePlannerDesignationRequestSchema.safeParse(create({ name: "Eisenfabrik Süd" })).success).toBe(true);
  });
  it.each([
    ["empty", ""],
    ["65 characters", "x".repeat(65)],
    ["only spaces", "   "],
    ["a newline", "a\nb"],
    ["a NUL", "a\u0000b"],
    ["a bidi override", "a‮b"],
    ["a bidi isolate", "a⁦b"],
    ["a zero-width space", "a​b"],
    ["a BOM", "﻿ab"],
    ["a Hangul filler", "aㅤb"],
    ["a braille blank", "⠀"],
    ["a line separator", "a b"],
    ["a paragraph separator", "a b"],
  ])("refuses %s", (_label, name) => {
    expect(CreatePlannerDesignationRequestSchema.safeParse(create({ name })).success).toBe(false);
  });
});

describe("planner designations: members", () => {
  it("allows 1 to 1000 members and refuses 0 and 1001", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `b-${i}`, c: "Build_X_C", x: i, y: 0 }));
    expect(CreatePlannerDesignationRequestSchema.safeParse(create({ members: many(PLANNER_DESIGNATION_MAX_MEMBERS) })).success).toBe(true);
    expect(CreatePlannerDesignationRequestSchema.safeParse(create({ members: many(PLANNER_DESIGNATION_MAX_MEMBERS + 1) })).success).toBe(false);
    expect(CreatePlannerDesignationRequestSchema.safeParse(create({ members: [] })).success).toBe(false);
  });
  it("accepts a missing building id as null, but not an absent or empty one", () => {
    expect(CreatePlannerDesignationRequestSchema.safeParse(create({ members: [{ ...member, id: null }] })).success).toBe(true);
    const { id: _id, ...noId } = member;
    expect(CreatePlannerDesignationRequestSchema.safeParse(create({ members: [noId] })).success).toBe(false);
    expect(CreatePlannerDesignationRequestSchema.safeParse(create({ members: [{ ...member, id: "" }] })).success).toBe(false);
  });
  it("refuses a repeated building id, but allows several null ids", () => {
    expect(CreatePlannerDesignationRequestSchema.safeParse(create({ members: [member, { ...member, x: 11 }] })).success).toBe(false);
    expect(CreatePlannerDesignationRequestSchema.safeParse(create({ members: [{ ...member, id: null }, { ...member, id: null, x: 11 }] })).success).toBe(true);
  });
  it.each([
    ["a fractional x", { x: 1.5 }],
    ["a fractional y", { y: -0.1 }],
    ["NaN", { x: Number.NaN }],
    ["Infinity", { y: Number.POSITIVE_INFINITY }],
    ["a string coordinate", { x: "10" }],
    ["a coordinate beyond the limit", { x: 1_000_001 }],
    ["an empty class", { c: "" }],
    ["a class with a control character", { c: "Build\u0000_C" }],
    ["a class over 200 characters", { c: "x".repeat(201) }],
    ["an unknown key", { z: 1 }],
  ])("refuses %s", (_label, over) => {
    expect(CreatePlannerDesignationRequestSchema.safeParse(create({ members: [{ ...member, ...over }] })).success).toBe(false);
  });
  it("accepts negative whole metres", () => {
    expect(CreatePlannerDesignationRequestSchema.safeParse(create({ members: [{ ...member, x: -375000, y: -0 }] })).success).toBe(true);
  });
});

describe("planner designations: mode and strictness", () => {
  it("accepts core and refuses an unknown or missing mode", () => {
    expect(CreatePlannerDesignationRequestSchema.safeParse(create({ mode: "core" })).success).toBe(true);
    expect(CreatePlannerDesignationRequestSchema.safeParse(create({ mode: "satellite" })).success).toBe(false);
    expect(CreatePlannerDesignationRequestSchema.safeParse(create({ mode: undefined })).success).toBe(false);
  });
  it("refuses unknown body keys on create and update (no smuggled id or timestamps)", () => {
    expect(CreatePlannerDesignationRequestSchema.safeParse(create({ id: "6f1c2a9e-3b7d-4e58-9a41-0c5d8e2f7b10" })).success).toBe(false);
    expect(UpdatePlannerDesignationRequestSchema.safeParse({ name: "A", mode: "core" }).success).toBe(false);
  });
  it("update needs a name, members, or both", () => {
    expect(UpdatePlannerDesignationRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdatePlannerDesignationRequestSchema.safeParse({ name: "B" }).success).toBe(true);
    expect(UpdatePlannerDesignationRequestSchema.safeParse({ members: [member] }).success).toBe(true);
    expect(UpdatePlannerDesignationRequestSchema.safeParse({ name: "B", members: [] }).success).toBe(false);
  });
});

describe("planner designations: responses and errors", () => {
  it("the list fixture holds the intended matching cases", () => {
    const list = PlannerDesignationsResponseSchema.parse(fixtures.plannerDesignationList);
    expect(list.designations).toHaveLength(2);
    expect(list.matches[0]).toMatchObject({ matched: 3, missing: 0 });
    expect(list.matches[0]?.claimedBy).toBeUndefined();
    expect(list.matches[1]).toMatchObject({ matched: 1, missing: 1, claimedBy: { count: 1 } });
    for (const m of list.matches) {
      const d = list.designations.find((x) => x.id === m.designationId);
      expect(d).toBeDefined();
    }
  });
  it("bounds the list at 50 designations", () => {
    const d = fixtures.plannerDesignationIronLine;
    const list = (n: number) => ({ designations: Array.from({ length: n }, () => d), matches: [] });
    expect(PlannerDesignationsResponseSchema.safeParse(list(PLANNER_DESIGNATIONS_MAX_PER_SERVER)).success).toBe(true);
    expect(PlannerDesignationsResponseSchema.safeParse(list(PLANNER_DESIGNATIONS_MAX_PER_SERVER + 1)).success).toBe(false);
  });
  it("a stored designation needs a uuid and timestamps", () => {
    expect(PlannerDesignationSchema.safeParse({ ...fixtures.plannerDesignationIronLine, id: "nope" }).success).toBe(false);
    expect(PlannerDesignationSchema.safeParse({ ...fixtures.plannerDesignationIronLine, createdAt: "yesterday" }).success).toBe(false);
  });
  it("the overlap error names the other designation and parses in the shared envelope", () => {
    const parsed = DesignationOverlapErrorSchema.parse(fixtures.plannerDesignationOverlapError);
    expect(parsed.error.other.name).toBe("Iron line");
    expect(ApiErrorResponseSchema.parse(fixtures.plannerDesignationOverlapError)).toEqual(fixtures.plannerDesignationOverlapError);
    const { other: _o, ...without } = fixtures.plannerDesignationOverlapError.error;
    expect(DesignationOverlapErrorSchema.safeParse({ error: without }).success).toBe(false);
    expect(DesignationOverlapErrorSchema.safeParse({ error: { ...without, code: "not_found", other: fixtures.plannerDesignationOverlapError.error.other } }).success).toBe(false);
  });
  it("registers the two stable codes", () => {
    expect(KnownErrorCode.options).toEqual(expect.arrayContaining(["designation_overlap", "designation_cap"]));
  });
});

describe("planner designations: endpoints", () => {
  const id = "6f1c2a9e-3b7d-4e58-9a41-0c5d8e2f7b10";
  it("follows the server-scoped planner naming", () => {
    expect(endpoints.plannerDesignations.list).toMatchObject({ method: "GET", route: "/api/servers/:serverId/planner/designations" });
    expect(endpoints.plannerDesignations.create).toMatchObject({ method: "POST", route: "/api/servers/:serverId/planner/designations" });
    expect(endpoints.plannerDesignations.update).toMatchObject({ method: "PUT", route: "/api/servers/:serverId/planner/designations/:designationId" });
    expect(endpoints.plannerDesignations.remove).toMatchObject({ method: "DELETE", route: "/api/servers/:serverId/planner/designations/:designationId" });
  });
  it("builds and encodes paths", () => {
    expect(endpoints.plannerDesignations.list.path("a b")).toBe("/api/servers/a%20b/planner/designations");
    expect(endpoints.plannerDesignations.update.path("default", id)).toBe(`/api/servers/default/planner/designations/${id}`);
    expect(endpoints.plannerDesignations.remove.path("default", "../x")).toBe("/api/servers/default/planner/designations/..%2Fx");
  });
});

// ADR-0055 amendment 2026-10-27 (#727): merge and split as one replace.
describe("planner designations: revision and memberBuildingIds (additive)", () => {
  it("an older backend's payloads, without revision or memberBuildingIds, still parse", () => {
    expect(PlannerDesignationSchema.parse(fixtures.plannerDesignationIronLine).revision).toBeUndefined();
    const list = PlannerDesignationsResponseSchema.parse(fixtures.plannerDesignationList);
    expect(list.matches.every((m) => m.memberBuildingIds === undefined)).toBe(true);
  });
  it("the revised list carries both, aligned to the members", () => {
    const list = PlannerDesignationsResponseSchema.parse(fixtures.plannerDesignationListRevised);
    expect(list.designations.map((d) => d.revision)).toEqual([2, 1]);
    for (const m of list.matches) {
      const d = list.designations.find((x) => x.id === m.designationId);
      expect(m.memberBuildingIds).toHaveLength(d?.members.length ?? -1);
      expect(m.memberBuildingIds?.filter((b) => b !== null)).toHaveLength(m.matched);
    }
  });
  it.each([
    ["0", 0],
    ["a negative", -1],
    ["a fraction", 1.5],
    ["beyond a Postgres integer", PLANNER_DESIGNATION_REVISION_MAX + 1],
    ["a string", "2"],
  ])("refuses %s revision", (_label, revision) => {
    expect(PlannerDesignationSchema.safeParse({ ...fixtures.plannerDesignationIronLine, revision }).success).toBe(false);
  });
  it("accepts revision 1 and the integer maximum", () => {
    expect(PlannerDesignationSchema.safeParse({ ...fixtures.plannerDesignationIronLine, revision: 1 }).success).toBe(true);
    expect(PlannerDesignationSchema.safeParse({ ...fixtures.plannerDesignationIronLine, revision: PLANNER_DESIGNATION_REVISION_MAX }).success).toBe(true);
  });
  it("memberBuildingIds: one entry per member, null or a non-empty id, at most 1000", () => {
    const base = { designationId: "6f1c2a9e-3b7d-4e58-9a41-0c5d8e2f7b10" };
    const ids = (n: number) => Array.from({ length: n }, (_, i) => (i % 2 === 0 ? `b-${i}` : null));
    expect(PlannerDesignationMatchSchema.safeParse({ ...base, matched: 1, missing: 1, memberBuildingIds: ["b-1", null] }).success).toBe(true);
    expect(PlannerDesignationMatchSchema.safeParse({ ...base, matched: 1, missing: 1, memberBuildingIds: ["b-1"] }).success).toBe(false);
    expect(PlannerDesignationMatchSchema.safeParse({ ...base, matched: 1, missing: 0, memberBuildingIds: [""] }).success).toBe(false);
    expect(PlannerDesignationMatchSchema.safeParse({ ...base, matched: 500, missing: 500, memberBuildingIds: ids(1000) }).success).toBe(true);
    expect(PlannerDesignationMatchSchema.safeParse({ ...base, matched: 500, missing: 501, memberBuildingIds: ids(1001) }).success).toBe(false);
  });
});

describe("planner designations: replace request", () => {
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const m = (id: string | null, x = 0) => ({ id, c: "Build_X_C", x, y: 0 });
  const put = (over: Record<string, unknown> = {}) => ({ name: "Iron", members: [m("b-1")], ...over });
  const parse = (body: unknown) => ReplacePlannerDesignationsRequestSchema.safeParse(body);

  it("the merge and split-back fixtures parse", () => {
    expect(parse(fixtures.plannerDesignationReplaceRequestMerge).success).toBe(true);
    expect(parse(fixtures.plannerDesignationReplaceRequestUndo).success).toBe(true);
  });
  it("accepts a dissolve (empty put) and a create of suggested machines (empty expect)", () => {
    expect(parse({ expect: [{ id: uuid(1), revision: 1 }], put: [], intent: "dissolve" }).success).toBe(true);
    expect(parse({ expect: [], put: [put()] }).success).toBe(true);
  });
  it("refuses a request with nothing to do, or without expect or put", () => {
    expect(parse({ expect: [], put: [] }).success).toBe(false);
    expect(parse({ put: [put()] }).success).toBe(false);
    expect(parse({ expect: [{ id: uuid(1), revision: 1 }] }).success).toBe(false);
  });
  it("bounds expect and put at 10 each", () => {
    const expects = (n: number) => Array.from({ length: n }, (_, i) => ({ id: uuid(i), revision: 1 }));
    const puts = (n: number) => Array.from({ length: n }, (_, i) => put({ members: [m(`b-${i}`)] }));
    expect(parse({ expect: expects(PLANNER_DESIGNATIONS_REPLACE_MAX_EXPECT), put: [] }).success).toBe(true);
    expect(parse({ expect: expects(PLANNER_DESIGNATIONS_REPLACE_MAX_EXPECT + 1), put: [] }).success).toBe(false);
    expect(parse({ expect: [], put: puts(PLANNER_DESIGNATIONS_REPLACE_MAX_PUT) }).success).toBe(true);
    expect(parse({ expect: [], put: puts(PLANNER_DESIGNATIONS_REPLACE_MAX_PUT + 1) }).success).toBe(false);
  });
  it("bounds the members across put at 2000, each entry still at 1000", () => {
    const members = (from: number, n: number) => Array.from({ length: n }, (_, i) => m(`b-${from + i}`, from + i));
    const half = PLANNER_DESIGNATIONS_REPLACE_MAX_TOTAL_MEMBERS / 2;
    expect(parse({ expect: [], put: [put({ members: members(0, half) }), put({ members: members(half, half) })] }).success).toBe(true);
    expect(
      parse({ expect: [], put: [put({ members: members(0, half) }), put({ members: members(half, half) }), put({ members: [m("b-extra")] })] }).success,
    ).toBe(false);
    expect(parse({ expect: [], put: [put({ members: members(0, 1001) })] }).success).toBe(false);
  });
  it("refuses put entries that share a building: the same id, or the same class and position when a side has no id", () => {
    expect(parse({ expect: [], put: [put({ members: [m("b-1")] }), put({ members: [m("b-1", 5)] })] }).success).toBe(false);
    expect(parse({ expect: [], put: [put({ members: [m(null, 3)] }), put({ members: [m("b-9", 3)] })] }).success).toBe(false);
    expect(parse({ expect: [], put: [put({ members: [m("b-9", 3)] }), put({ members: [m(null, 3)] })] }).success).toBe(false);
    expect(parse({ expect: [], put: [put({ members: [m(null, 3)] }), put({ members: [m(null, 3)] })] }).success).toBe(false);
  });
  it("allows different ids at one class and position, and different positions without ids", () => {
    expect(parse({ expect: [], put: [put({ members: [m("b-1", 3)] }), put({ members: [m("b-2", 3)] })] }).success).toBe(true);
    expect(parse({ expect: [], put: [put({ members: [m(null, 3)] }), put({ members: [m(null, 4)] })] }).success).toBe(true);
  });
  it("accepts the split back of originals whose members would match one live building by position but differ in stored key", () => {
    // Two stored designations can hold members the matcher resolves to the same live building (within
    // PLANNER_DESIGNATION_MATCH_RADIUS_METRES), as long as their stored keys differ. The put check compares stored keys
    // only, so restoring both together passes. That is why the undo pre-image must be the stored `members`, never
    // matcher-resolved building ids: resolving them could collapse two originals onto one building and refuse the undo.
    const originals = (a: ReturnType<typeof m>, b: ReturnType<typeof m>) => ({
      expect: [{ id: uuid(9), revision: 1 }],
      put: [put({ id: uuid(1), members: [a] }), put({ id: uuid(2), name: "Annex", members: [b] })],
      intent: "undo",
    });
    expect(PLANNER_DESIGNATION_MATCH_RADIUS_METRES).toBe(2);
    expect(parse(originals(m("b-1", 3), m("b-2", 4))).success).toBe(true);
    expect(parse(originals(m(null, 3), m(null, 4))).success).toBe(true);
    expect(parse(originals(m(null, 3), m(null, 3 + PLANNER_DESIGNATION_MATCH_RADIUS_METRES))).success).toBe(true);
  });
  it("names the offending put entry in the issue path", () => {
    const result = parse({ expect: [], put: [put({ members: [m("b-1")] }), put({ members: [m("b-2")] }), put({ members: [m("b-1", 2)] })] });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path)).toEqual([["put", 2, "members"]]);
  });
  it("refuses a repeated id within expect or within put", () => {
    expect(parse({ expect: [{ id: uuid(1), revision: 1 }, { id: uuid(1), revision: 2 }], put: [] }).success).toBe(false);
    expect(parse({ expect: [], put: [put({ id: uuid(1), members: [m("a")] }), put({ id: uuid(1), members: [m("b")] })] }).success).toBe(false);
  });
  it.each([
    ["an expect id that is not a uuid", { expect: [{ id: "x", revision: 1 }], put: [] }],
    ["an expect revision of 0", { expect: [{ id: "6f1c2a9e-3b7d-4e58-9a41-0c5d8e2f7b10", revision: 0 }], put: [] }],
    ["an expect without a revision", { expect: [{ id: "6f1c2a9e-3b7d-4e58-9a41-0c5d8e2f7b10" }], put: [] }],
    ["an unknown key on expect", { expect: [{ id: "6f1c2a9e-3b7d-4e58-9a41-0c5d8e2f7b10", revision: 1, name: "x" }], put: [] }],
    ["a put id that is not a uuid", { expect: [], put: [{ id: "x", name: "A", members: [{ id: "b", c: "C", x: 0, y: 0 }] }] }],
    ["a put createdAt that is not a time", { expect: [], put: [{ name: "A", members: [{ id: "b", c: "C", x: 0, y: 0 }], createdAt: "yesterday" }] }],
    ["a put with a mode", { expect: [], put: [{ name: "A", mode: "core", members: [{ id: "b", c: "C", x: 0, y: 0 }] }] }],
    ["a put with a bad name", { expect: [], put: [{ name: "a\nb", members: [{ id: "b", c: "C", x: 0, y: 0 }] }] }],
    ["a put without members", { expect: [], put: [{ name: "A", members: [] }] }],
    ["a put repeating a building id", { expect: [], put: [{ name: "A", members: [{ id: "b", c: "C", x: 0, y: 0 }, { id: "b", c: "C", x: 1, y: 0 }] }] }],
    ["an unknown body key", { expect: [], put: [{ name: "A", members: [{ id: "b", c: "C", x: 0, y: 0 }] }], force: true }],
  ])("refuses %s", (_label, body) => {
    expect(parse(body).success).toBe(false);
  });
  it("intent: optional, a lower-case word of at most 20 characters; every known intent passes", () => {
    const body = (intent: unknown) => ({ expect: [], put: [put()], intent });
    for (const intent of KNOWN_PLANNER_DESIGNATIONS_REPLACE_INTENTS) expect(parse(body(intent)).success, intent).toBe(true);
    expect(parse(body("x".repeat(20))).success).toBe(true);
    expect(parse(body("x".repeat(21))).success).toBe(false);
    expect(parse(body("")).success).toBe(false);
    expect(parse(body("Merge")).success).toBe(false);
    expect(parse(body("merge\n")).success).toBe(false);
    expect(parse(body(1)).success).toBe(false);
  });
});

describe("planner designations: replace response and the stale error", () => {
  it("the response carries the written designations with revision and the removed ids", () => {
    const parsed = ReplacePlannerDesignationsResponseSchema.parse(fixtures.plannerDesignationReplaceResponse);
    expect(parsed.designations[0]?.revision).toBe(3);
    expect(parsed.removedIds).toEqual([fixtures.plannerDesignationIronAnnex.id]);
    expect(ReplacePlannerDesignationsResponseSchema.safeParse({ ...parsed, removedIds: ["nope"] }).success).toBe(false);
  });
  it("a response entry without revision is refused, while revision stays optional on a listed designation", () => {
    const [written] = fixtures.plannerDesignationReplaceResponse.designations;
    const { revision: _revision, ...withoutRevision } = written!;
    const response = { ...fixtures.plannerDesignationReplaceResponse, designations: [withoutRevision] };
    expect(ReplacePlannerDesignationsResponseSchema.safeParse(response).success).toBe(false);
    expect(PlannerDesignationSchema.safeParse(withoutRevision).success).toBe(true);
  });
  it("merge then split back is the identity on ids, members, order and createdAt (the fixtures)", () => {
    const undo = ReplacePlannerDesignationsRequestSchema.parse(fixtures.plannerDesignationReplaceRequestUndo);
    expect(undo.put.map((p) => p.id)).toEqual([fixtures.plannerDesignationIronLine.id, fixtures.plannerDesignationIronAnnex.id]);
    expect(undo.put[0]?.members).toEqual(fixtures.plannerDesignationIronLine.members);
    expect(undo.put.map((p) => p.createdAt)).toEqual([fixtures.plannerDesignationIronLine.createdAt, fixtures.plannerDesignationIronAnnex.createdAt]);
    expect(undo.expect).toEqual([{ id: fixtures.plannerDesignationIronLine.id, revision: fixtures.plannerDesignationReplaceResponse.designations[0]?.revision }]);
  });
  it("registers designation_stale, and the stale error parses in the shared envelope", () => {
    expect(KnownErrorCode.options).toContain("designation_stale");
    expect(ApiErrorResponseSchema.parse(fixtures.plannerDesignationStaleError)).toEqual(fixtures.plannerDesignationStaleError);
  });
  it("an older client, whose code list lacks designation_stale, still parses the envelope (the code is a plain string)", () => {
    const olderCodes = KnownErrorCode.exclude(["designation_stale"]);
    expect(olderCodes.safeParse("designation_stale").success).toBe(false);
    expect(ApiErrorResponseSchema.safeParse({ error: { ...fixtures.plannerDesignationStaleError.error, code: "designation_from_the_future" } }).success).toBe(true);
  });
});
