import { z } from "zod";

/**
 * ADR-0055 Decision 5 (and its 2026-10-25 amendment: id-first matching): Planner designations. A designation is a named
 * set of the player's own buildings ("core" mode: these machines are one factory). Contract only; no route serves these
 * yet. Additive: the graph's `designationId` (productionGraph.ts, nullable per factory) is reused, nothing is duplicated.
 *
 * LIMITS. At most PLANNER_DESIGNATIONS_MAX_PER_SERVER designations per server and PLANNER_DESIGNATION_MAX_MEMBERS members
 * per designation. The schemas cap members; the per-server cap is not enforceable in a schema, so the route enforces it
 * (409 `designation_cap`).
 *
 * MATCHING (read time, never stored). A member is found again in the live factory by, in order: the game's building id
 * when both sides have one; else an exact (class, x, y); else the nearest building of the same class within
 * PLANNER_DESIGNATION_MATCH_RADIUS_METRES. One-to-one (a building matches at most one member), members taken in order.
 * When two designations would claim the same building on read, the OLDER designation (by `createdAt`) keeps it and the
 * newer reports `claimedBy`.
 *
 * ERRORS reuse the shared envelope (`ApiErrorResponseSchema`): not a member of the server is 404 `server_not_found`;
 * a viewer writing is 403 `forbidden` (the existing member-write guard); an unknown designation is 404 `not_found`; a bad
 * body is 400 `bad_request`; a write whose members overlap another designation is 409 `designation_overlap` with
 * `error.other` = `{ id, name }` naming the other designation (`DesignationOverlapErrorSchema`); a create beyond the
 * per-server cap is 409 `designation_cap`.
 *
 * NAMES are untrusted text shown in the UI: no control, format (bidi, zero-width) or line characters, rendered as text.
 */

export const PLANNER_DESIGNATIONS_MAX_PER_SERVER = 50;
export const PLANNER_DESIGNATION_MAX_MEMBERS = 1000;
export const PLANNER_DESIGNATION_NAME_MAX = 64;
export const PLANNER_DESIGNATION_MATCH_RADIUS_METRES = 2;
/** Whole metres; the game world is far smaller than this, so it only bounds hostile input. */
export const PLANNER_DESIGNATION_COORD_LIMIT = 1_000_000;

/** `core` is the only mode today. Kept an enum so another can be added additively; a client treats an unknown one as `core`. */
export const KNOWN_PLANNER_DESIGNATION_MODES = ["core"] as const;
export const PlannerDesignationModeSchema = z.enum(KNOWN_PLANNER_DESIGNATION_MODES);

const IsoTimeSchema = z.iso.datetime({ offset: true });

export const PlannerDesignationNameSchema = z
  .string()
  .min(1)
  .max(PLANNER_DESIGNATION_NAME_MAX)
  .regex(/^[^\p{C}\p{Zl}\p{Zp}ᅟᅠㅤ⠀ﾠ]+$/u, "No control or invisible characters")
  .refine((s) => s.trim().length > 0, "Not only spaces");

const ClassNameSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^\p{C}\p{Zl}\p{Zp}]+$/u, "No control or invisible characters");

const Coordinate = z.number().int().min(-PLANNER_DESIGNATION_COORD_LIMIT).max(PLANNER_DESIGNATION_COORD_LIMIT);

/** One building: the game's id when known (may be absent), its class, and its position in whole metres. */
export const PlannerDesignationMemberSchema = z.strictObject({
  id: z.string().min(1).max(128).nullable().describe("The game's building id; null when the source gave none"),
  c: ClassNameSchema.describe("The building's class name"),
  x: Coordinate.describe("Metres, whole number"),
  y: Coordinate.describe("Metres, whole number"),
});

const MembersSchema = z
  .array(PlannerDesignationMemberSchema)
  .min(1)
  .max(PLANNER_DESIGNATION_MAX_MEMBERS)
  .refine((members) => {
    const ids = members.flatMap((m) => (m.id === null ? [] : [m.id]));
    return new Set(ids).size === ids.length;
  }, "A building id appears once");

export const PlannerDesignationSchema = z.object({
  id: z.uuid(),
  name: PlannerDesignationNameSchema,
  mode: PlannerDesignationModeSchema,
  members: z.array(PlannerDesignationMemberSchema).min(1).max(PLANNER_DESIGNATION_MAX_MEMBERS),
  createdAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
});

/** POST: a member of the server with write rights. 201 with the new designation. */
export const CreatePlannerDesignationRequestSchema = z.strictObject({
  name: PlannerDesignationNameSchema,
  mode: PlannerDesignationModeSchema,
  members: MembersSchema,
});

/** PUT: name and/or members (at least one); the mode does not change. 200 with the designation. */
export const UpdatePlannerDesignationRequestSchema = z
  .strictObject({
    name: PlannerDesignationNameSchema.optional(),
    members: MembersSchema.optional(),
  })
  .refine((v) => v.name !== undefined || v.members !== undefined, "Send a name, members, or both");

/** Read-time matching info for one designation (computed, not stored). matched + missing = the member count. */
export const PlannerDesignationMatchSchema = z.object({
  designationId: z.uuid(),
  matched: z.number().int().min(0).max(PLANNER_DESIGNATION_MAX_MEMBERS),
  missing: z.number().int().min(0).max(PLANNER_DESIGNATION_MAX_MEMBERS),
  claimedBy: z
    .object({
      id: z.uuid(),
      name: PlannerDesignationNameSchema,
      count: z.number().int().min(1).max(PLANNER_DESIGNATION_MAX_MEMBERS),
    })
    .optional()
    .describe("The older designation that holds buildings this one also names; absent when none"),
});

/** GET: the designations, oldest first, with one match entry per designation. */
export const PlannerDesignationsResponseSchema = z.object({
  designations: z.array(PlannerDesignationSchema).max(PLANNER_DESIGNATIONS_MAX_PER_SERVER),
  matches: z.array(PlannerDesignationMatchSchema).max(PLANNER_DESIGNATIONS_MAX_PER_SERVER),
});

/** DELETE: 200. */
export const DeletePlannerDesignationResponseSchema = z.object({ deleted: z.literal(true) });

/** 409 `designation_overlap`: the envelope plus `error.other`, the designation that already holds one of the buildings. */
export const DesignationOverlapErrorSchema = z.object({
  error: z.object({
    code: z.literal("designation_overlap"),
    message: z.string(),
    requestId: z.string(),
    other: z.object({ id: z.uuid(), name: PlannerDesignationNameSchema }),
  }),
});

export type PlannerDesignation = z.infer<typeof PlannerDesignationSchema>;
export type PlannerDesignationMember = z.infer<typeof PlannerDesignationMemberSchema>;
export type PlannerDesignationsResponse = z.infer<typeof PlannerDesignationsResponseSchema>;
export type CreatePlannerDesignationRequest = z.input<typeof CreatePlannerDesignationRequestSchema>;
export type UpdatePlannerDesignationRequest = z.input<typeof UpdatePlannerDesignationRequestSchema>;
