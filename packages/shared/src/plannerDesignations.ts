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
 * MATCHING (read time, never stored). Members are found again in the live factory in passes, each over every designation
 * oldest (by `createdAt`) first: pass 1, the game's building id, which counts only when the live building is also of the
 * member's class (an id on another class is stale and the member falls through); pass 2, an exact (class, x, y); pass 3,
 * the nearest building of the same class within PLANNER_DESIGNATION_MATCH_RADIUS_METRES. One-to-one (a building matches
 * at most one member), and the result does not depend on member order. A member whose position match would land on a
 * building already held takes the next free building of the class within the radius; only when there is none is it
 * missing, and then the OLDER designation holding that building keeps it and the newer reports `claimedBy`.
 * (Write overlap: two members with ids overlap only on the same id; class and position decide only when a side has none.)
 *
 * ERRORS reuse the shared envelope (`ApiErrorResponseSchema`): not a member of the server is 404 `server_not_found`;
 * a viewer writing is 403 `forbidden` (the existing member-write guard); an unknown designation is 404 `not_found`; a bad
 * body is 400 `bad_request`; a write whose members overlap another designation is 409 `designation_overlap` with
 * `error.other` = `{ id, name }` naming the other designation (`DesignationOverlapErrorSchema`); a create beyond the
 * per-server cap is 409 `designation_cap`.
 *
 * NAMES are untrusted text shown in the UI: no control, format (bidi, zero-width) or line characters, rendered as text.
 *
 * REPLACE (ADR-0055 amendment 2026-10-27, Decisions 11 and 12, #727): merge, split, pop-out, dissolve and undo are one
 * write, `POST .../planner/designations/replace`: resulting set = existing, minus the `expect` ids, plus the `put` entries,
 * in one transaction. Every `expect` entry must exist at that `revision`, else 409 `designation_stale`. A `put` entry whose
 * `id` is in `expect` updates that designation in place (kept id and `createdAt`, revision + 1); every other `put` entry is
 * inserted, keeping a given `id` (not present anywhere after the removal, else 409 `designation_stale`) and `createdAt` (the route refuses one
 * in the future, 400: a schema cannot know the time). An `expect` entry no `put` names is deleted; an empty `put` is a
 * dissolve. The schema refuses (400 `bad_request`) put entries that share a building (the OVERLAP rule below, a client
 * bug), a repeated id within `expect` or within `put`, and more than PLANNER_DESIGNATIONS_REPLACE_MAX_TOTAL_MEMBERS
 * members across `put`. A building held by a designation OUTSIDE `expect` is the route's 409 `designation_overlap`; a
 * resulting count above PLANNER_DESIGNATIONS_MAX_PER_SERVER is its 409 `designation_cap`. `intent` is an audit hint only.
 * `revision` (on every designation) and `memberBuildingIds` (on every match) are optional: absent = an older backend.
 * A replace response's designations always carry `revision`.
 */

export const PLANNER_DESIGNATIONS_MAX_PER_SERVER = 50;
export const PLANNER_DESIGNATION_MAX_MEMBERS = 1000;
export const PLANNER_DESIGNATION_NAME_MAX = 64;
export const PLANNER_DESIGNATION_MATCH_RADIUS_METRES = 2;
/** Whole metres; the game world is far smaller than this, so it only bounds hostile input. */
export const PLANNER_DESIGNATION_COORD_LIMIT = 1_000_000;
/** ADR-0055 Decision 11: at most this many designations a replace may expect (remove or update), and put (write). */
export const PLANNER_DESIGNATIONS_REPLACE_MAX_EXPECT = 10;
export const PLANNER_DESIGNATIONS_REPLACE_MAX_PUT = 10;
/** Members across every `put` entry of one replace (each entry is still at most PLANNER_DESIGNATION_MAX_MEMBERS). */
export const PLANNER_DESIGNATIONS_REPLACE_MAX_TOTAL_MEMBERS = 2000;
export const PLANNER_DESIGNATIONS_REPLACE_INTENT_MAX = 20;
/** The intents clients send today. A hint for the audit event only: any short lower-case word is accepted. */
export const KNOWN_PLANNER_DESIGNATIONS_REPLACE_INTENTS = ["merge", "split", "pop_out", "dissolve", "undo"] as const;
/** The row's concurrency token is a Postgres integer: positive, at most 2^31 - 1. */
export const PLANNER_DESIGNATION_REVISION_MAX = 2_147_483_647;

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

export const PlannerDesignationRevisionSchema = z.number().int().min(1).max(PLANNER_DESIGNATION_REVISION_MAX);

export const PlannerDesignationSchema = z.object({
  id: z.uuid(),
  name: PlannerDesignationNameSchema,
  mode: PlannerDesignationModeSchema,
  members: z.array(PlannerDesignationMemberSchema).min(1).max(PLANNER_DESIGNATION_MAX_MEMBERS),
  createdAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
  // ADR-0055 Decision 11 (additive, optional): bumped by every write to the row; a replace's `expect` names it.
  revision: PlannerDesignationRevisionSchema.optional().describe("Concurrency token; absent from an older backend"),
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
  // ADR-0055 Decision 12 (additive, optional): the live building each member matched, aligned to `members`.
  memberBuildingIds: z
    .array(z.string().min(1).max(128).nullable())
    .max(PLANNER_DESIGNATION_MAX_MEMBERS)
    .optional()
    .describe("Per member, in member order: the live building id it matched, or null when not found; absent from an older backend"),
}).refine(
  (m) => m.memberBuildingIds === undefined || m.memberBuildingIds.length === m.matched + m.missing,
  "memberBuildingIds has one entry per member (matched + missing)",
);

/** GET: the designations, oldest first, with one match entry per designation. */
export const PlannerDesignationsResponseSchema = z.object({
  designations: z.array(PlannerDesignationSchema).max(PLANNER_DESIGNATIONS_MAX_PER_SERVER),
  matches: z.array(PlannerDesignationMatchSchema).max(PLANNER_DESIGNATIONS_MAX_PER_SERVER),
});

/** DELETE: 200. */
export const DeletePlannerDesignationResponseSchema = z.object({ deleted: z.literal(true) });

/** A replace's precondition: this designation exists at this revision (else 409 `designation_stale`). */
export const PlannerDesignationExpectSchema = z.strictObject({
  id: z.uuid(),
  revision: PlannerDesignationRevisionSchema,
});

/** A replace's write: an update in place when `id` is expected, else an insert (keeping `id` and `createdAt` if given). */
export const PlannerDesignationPutSchema = z.strictObject({
  id: z.uuid().optional(),
  name: PlannerDesignationNameSchema,
  members: MembersSchema,
  createdAt: IsoTimeSchema.optional().describe("Only an undo restoring an original sends it; never in the future"),
});

const memberKey = (m: PlannerDesignationMember): string => `${m.c}\u0000${m.x}\u0000${m.y}`;

/** POST .../replace (ADR-0055 Decision 11). 200 with the written designations and the removed ids. */
export const ReplacePlannerDesignationsRequestSchema = z
  .strictObject({
    expect: z.array(PlannerDesignationExpectSchema).max(PLANNER_DESIGNATIONS_REPLACE_MAX_EXPECT),
    put: z.array(PlannerDesignationPutSchema).max(PLANNER_DESIGNATIONS_REPLACE_MAX_PUT),
    intent: z
      .string()
      .min(1)
      .max(PLANNER_DESIGNATIONS_REPLACE_INTENT_MAX)
      .regex(/^[a-z][a-z_]*$/, "A lower-case word")
      .optional()
      .describe("Audit hint only (merge, split, pop_out, dissolve, undo); behaviour never depends on it"),
  })
  .superRefine((body, ctx) => {
    if (body.expect.length === 0 && body.put.length === 0) {
      ctx.addIssue({ code: "custom", message: "Send expect, put, or both" });
    }
    const expectIds = body.expect.map((e) => e.id);
    if (new Set(expectIds).size !== expectIds.length) {
      ctx.addIssue({ code: "custom", path: ["expect"], message: "A designation is expected once" });
    }
    const putIds = body.put.flatMap((p) => (p.id === undefined ? [] : [p.id]));
    if (new Set(putIds).size !== putIds.length) {
      ctx.addIssue({ code: "custom", path: ["put"], message: "A designation id is put once" });
    }
    const total = body.put.reduce((sum, p) => sum + p.members.length, 0);
    if (total > PLANNER_DESIGNATIONS_REPLACE_MAX_TOTAL_MEMBERS) {
      ctx.addIssue({ code: "custom", path: ["put"], message: `At most ${PLANNER_DESIGNATIONS_REPLACE_MAX_TOTAL_MEMBERS} members in total` });
    }
    // The write-overlap rule between put entries: the same building id, or the same (class, x, y) when a side has no id.
    const ids = new Set<string>();
    const keysWithoutId = new Set<string>();
    const allKeys = new Set<string>();
    body.put.forEach((p, index) => {
      const shared = p.members.some((m) =>
        m.id !== null ? ids.has(m.id) || keysWithoutId.has(memberKey(m)) : allKeys.has(memberKey(m)),
      );
      if (shared) ctx.addIssue({ code: "custom", path: ["put", index, "members"], message: "Put entries must not share a building" });
      for (const m of p.members) {
        if (m.id !== null) ids.add(m.id);
        else keysWithoutId.add(memberKey(m));
        allKeys.add(memberKey(m));
      }
    });
  });

/**
 * A written designation in a replace response: `revision` is REQUIRED here (undo's `expect` needs it, and only a
 * backend that has revisions serves replace). It stays optional on PlannerDesignationSchema everywhere else.
 */
export const ReplacedPlannerDesignationSchema = PlannerDesignationSchema.extend({
  revision: PlannerDesignationRevisionSchema.describe("Concurrency token; always present on a replace's result"),
});

export const ReplacePlannerDesignationsResponseSchema = z.object({
  designations: z.array(ReplacedPlannerDesignationSchema).max(PLANNER_DESIGNATIONS_REPLACE_MAX_PUT).describe("The written ones, with revision"),
  removedIds: z.array(z.uuid()).max(PLANNER_DESIGNATIONS_REPLACE_MAX_EXPECT),
});

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
export type PlannerDesignationMatch = z.infer<typeof PlannerDesignationMatchSchema>;
export type ReplacePlannerDesignationsRequest = z.input<typeof ReplacePlannerDesignationsRequestSchema>;
export type ReplacePlannerDesignationsResponse = z.infer<typeof ReplacePlannerDesignationsResponseSchema>;
