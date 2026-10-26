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

/** 409 when a write names a building another designation holds. */
export const plannerDesignationOverlapError = {
  error: {
    code: "designation_overlap" as const,
    message: "A building in this designation already belongs to another designation.",
    requestId: "req-designation-overlap-1",
    other: { id: IRON_LINE_ID, name: "Iron line" },
  },
};
