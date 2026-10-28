/**
 * ADR-0055 Decision 5: planner designations. SYNTHETIC (invented ids and positions). Two designations: "Iron line" is the
 * older and complete; "Iron annex" has one member that no longer exists in the factory (missing 1) and one building the
 * older designation already holds (claimedBy).
 */

const IRON_LINE_ID = "6f1c2a9e-3b7d-4e58-9a41-0c5d8e2f7b10";
const IRON_ANNEX_ID = "a84d5e17-92c3-4f06-b1d8-3e7a6c90d254";

export const plannerDesignationIronLine = {
  id: IRON_LINE_ID,
  name: "Iron line",
  mode: "core" as const,
  members: [
    { id: "Build_SmelterMk1_C_2147001", c: "Build_SmelterMk1_C", x: 1200, y: -400 },
    { id: "Build_ConstructorMk1_C_2147002", c: "Build_ConstructorMk1_C", x: 1212, y: -400 },
    { id: null, c: "Build_ConstructorMk1_C", x: 1224, y: -401 },
  ],
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-22T18:30:00.000Z",
};

export const plannerDesignationIronAnnex = {
  id: IRON_ANNEX_ID,
  name: "Iron annex",
  mode: "core" as const,
  members: [
    { id: "Build_ConstructorMk1_C_2147002", c: "Build_ConstructorMk1_C", x: 1212, y: -400 },
    { id: "Build_AssemblerMk1_C_2147099", c: "Build_AssemblerMk1_C", x: 1260, y: -380 },
    { id: "Build_AssemblerMk1_C_2147100", c: "Build_AssemblerMk1_C", x: 1272, y: -380 },
  ],
  createdAt: "2026-10-23T09:15:00.000Z",
  updatedAt: "2026-10-23T09:15:00.000Z",
};

/** GET .../planner/designations: oldest first; one match entry per designation. */
export const plannerDesignationList = {
  designations: [plannerDesignationIronLine, plannerDesignationIronAnnex],
  matches: [
    { designationId: IRON_LINE_ID, matched: 3, missing: 0 },
    { designationId: IRON_ANNEX_ID, matched: 1, missing: 1, claimedBy: { id: IRON_LINE_ID, name: "Iron line", count: 1 } },
  ],
};

/** POST. */
export const plannerDesignationCreateRequest = {
  name: "Iron annex",
  mode: "core" as const,
  members: plannerDesignationIronAnnex.members,
};

/** PUT: a rename alone. */
export const plannerDesignationUpdateRequest = { name: "Iron annex (east)" };

/** DELETE. */
export const plannerDesignationDeleteResponse = { deleted: true as const };

/**
 * ADR-0055 amendment 2026-10-27 (#727): GET from a backend that has `revision` and `memberBuildingIds`. The Iron line's
 * member without an id matched by position; the Iron annex's first member is held by the Iron line (claimed, so null) and
 * its last no longer exists (null): matched 1, missing 2.
 */
export const plannerDesignationListRevised = {
  designations: [
    { ...plannerDesignationIronLine, revision: 2 },
    { ...plannerDesignationIronAnnex, revision: 1 },
  ],
  matches: [
    {
      designationId: IRON_LINE_ID,
      matched: 3,
      missing: 0,
      memberBuildingIds: ["Build_SmelterMk1_C_2147001", "Build_ConstructorMk1_C_2147002", "Build_ConstructorMk1_C_2147003"],
    },
    {
      designationId: IRON_ANNEX_ID,
      matched: 1,
      missing: 2,
      claimedBy: { id: IRON_LINE_ID, name: "Iron line", count: 1 },
      memberBuildingIds: [null, "Build_AssemblerMk1_C_2147099", null],
    },
  ],
};

/** Members of the merge: the Iron line's, then the Iron annex's it did not already hold. */
const MERGED_MEMBERS = [...plannerDesignationIronLine.members, ...plannerDesignationIronAnnex.members.slice(1)];

/** POST .../replace: merge the two, keeping the older one's id and createdAt (Decision 12). */
export const plannerDesignationReplaceRequestMerge = {
  expect: [
    { id: IRON_LINE_ID, revision: 2 },
    { id: IRON_ANNEX_ID, revision: 1 },
  ],
  put: [{ id: IRON_LINE_ID, name: "Iron line", members: MERGED_MEMBERS }],
  intent: "merge",
};

/** 200 for the merge: the Iron line updated in place (revision + 1), the Iron annex removed. */
export const plannerDesignationReplaceResponse = {
  designations: [{ ...plannerDesignationIronLine, members: MERGED_MEMBERS, updatedAt: "2026-10-27T12:00:00.000Z", revision: 3 }],
  removedIds: [IRON_ANNEX_ID],
};

/**
 * POST .../replace: "Split back", the inverse of the merge, restoring both with their ids and createdAt. Put entries may
 * not share a building, so the annex comes back without the building the line also names.
 */
export const plannerDesignationReplaceRequestUndo = {
  expect: [{ id: IRON_LINE_ID, revision: 3 }],
  put: [
    { id: IRON_LINE_ID, name: "Iron line", members: plannerDesignationIronLine.members, createdAt: plannerDesignationIronLine.createdAt },
    {
      id: IRON_ANNEX_ID,
      name: "Iron annex",
      members: plannerDesignationIronAnnex.members.slice(1),
      createdAt: plannerDesignationIronAnnex.createdAt,
    },
  ],
  intent: "undo",
};

/** 409 when a replace's `expect` names a designation someone else changed or removed meanwhile. */
export const plannerDesignationStaleError = {
  error: {
    code: "designation_stale" as const,
    message: "One of these factories was changed by someone else. Select again.",
    requestId: "req-designation-stale-1",
  },
};

const MAIN_BASE_ID = "3d9b7c42-1e6a-4f85-8b20-5a4c1e7d9f63";

/**
 * ADR-0061: GET from a backend with nesting. "Main base" owns no machines itself and has both iron designations as
 * children; the Iron line keeps its original members and the annex drops the building the line holds.
 */
export const plannerDesignationListNested = {
  designations: [
    { ...plannerDesignationIronLine, revision: 2, parentId: MAIN_BASE_ID },
    { ...plannerDesignationIronAnnex, members: plannerDesignationIronAnnex.members.slice(1), revision: 2, parentId: MAIN_BASE_ID },
    {
      id: MAIN_BASE_ID,
      name: "Main base",
      mode: "core" as const,
      members: [],
      createdAt: "2026-10-27T12:00:00.000Z",
      updatedAt: "2026-10-27T12:00:00.000Z",
      revision: 1,
      parentId: null,
    },
  ],
  matches: [
    { designationId: IRON_LINE_ID, matched: 3, missing: 0 },
    { designationId: IRON_ANNEX_ID, matched: 1, missing: 1 },
    { designationId: MAIN_BASE_ID, matched: 0, missing: 0 },
  ],
};

/** POST .../replace: "Group into a new factory", the two iron designations under a new parent without members. */
export const plannerDesignationReplaceRequestGroup = {
  expect: [
    { id: IRON_LINE_ID, revision: 1 },
    { id: IRON_ANNEX_ID, revision: 1 },
  ],
  put: [
    { id: MAIN_BASE_ID, name: "Main base", members: [] },
    { id: IRON_LINE_ID, name: "Iron line", members: plannerDesignationIronLine.members, parentId: MAIN_BASE_ID },
    { id: IRON_ANNEX_ID, name: "Iron annex", members: plannerDesignationIronAnnex.members.slice(1), parentId: MAIN_BASE_ID },
  ],
  intent: "group",
};

/** 409 when a write would leave a designation with neither members nor children. */
export const plannerDesignationShapeError = {
  error: {
    code: "designation_shape" as const,
    message: "A factory needs machines or factories inside it.",
    requestId: "req-designation-shape-1",
  },
};

/** 409 when a write names a building another designation holds. */
export const plannerDesignationOverlapError = {
  error: {
    code: "designation_overlap" as const,
    message: "A building in this designation already belongs to another designation.",
    requestId: "req-designation-overlap-1",
    other: { id: IRON_LINE_ID, name: "Iron line" },
  },
};
