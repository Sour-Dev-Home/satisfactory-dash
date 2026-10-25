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
