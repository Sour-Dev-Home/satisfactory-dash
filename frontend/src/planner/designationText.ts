import { PLANNER_DESIGNATION_MAX_DEPTH, PLANNER_DESIGNATIONS_MAX_PER_SERVER, PlannerDesignationNameSchema } from "@satisfactory-dash/shared";
import { ApiError } from "../api/errors";
import { isStaleDesignation } from "../api/plannerWrites";
import { describeError } from "../components/ErrorNotice";

/** ADR-0055 Decision 11: a replace found one of the designations changed meanwhile; the page re-reads and drops the selection. */
export const STALE_TEXT = "Changed by someone else; select again.";
/** ADR-0061 Decision 6: the tree's 409s (`designation_depth`, `_cycle`, `_shape`), also said before sending when the page can tell. */
export const DEPTH_TEXT = `Factories nest at most ${PLANNER_DESIGNATION_MAX_DEPTH} levels.`;
export const CYCLE_TEXT = "A factory cannot go inside itself or a factory inside it.";
export const SHAPE_TEXT = "That would leave a factory with no machines and no factories in it.";
/** ADR-0055 Decision 12: Merge stays disabled for a selection that is not one connected piece. */
export const NOT_CONNECTED_TEXT = "These factories are not connected by any belt, pipe or transport";

/** Whether a role may designate factories (ADR-0055 Decision 5: owner and admin; the backend's guard is the real control). */
export function canDesignate(role: string | undefined): boolean {
  return role === "owner" || role === "admin";
}

const machines = (n: number) => `${n} ${n === 1 ? "machine" : "machines"}`;

/** The designation conflicts in the planner's own words; anything else reads like any other error. */
export function designationErrorText(error: unknown): string {
  if (error instanceof ApiError && error.code === "designation_depth") return DEPTH_TEXT;
  if (error instanceof ApiError && error.code === "designation_cycle") return CYCLE_TEXT;
  if (error instanceof ApiError && error.code === "designation_shape") return SHAPE_TEXT;
  if (error instanceof ApiError && error.code === "designation_overlap") {
    return error.other === undefined
      ? "Some of these machines already belong to another designated factory"
      : `Some of these machines already belong to ${error.other.name}`;
  }
  if (error instanceof ApiError && error.code === "designation_cap") {
    return `You can have up to ${PLANNER_DESIGNATIONS_MAX_PER_SERVER} designated factories`;
  }
  if (isStaleDesignation(error)) return STALE_TEXT;
  if (error instanceof ApiError && error.status === 400) return "The server refused this change as invalid. Reload the page and try again.";
  return describeError(error);
}

/** The name field's problem, or null when it will do. Names are text; the backend also refuses control characters. */
export function nameProblem(name: string): string | null {
  return PlannerDesignationNameSchema.safeParse(name).success ? null : "Enter a name of 1 to 64 characters, without control or invisible characters.";
}

export const claimedText = (count: number, by: string): string => `${machines(count)} claimed by ${by}`;
export const missingText = (count: number): string => `${machines(count)} no longer found`;
export const ALL_MISSING_TEXT = "All machines missing: not found in the factory. It is kept, not deleted.";

/** A problem with what the player picked, found before anything is sent; its message is shown as it is. */
export class PlanProblem extends Error {}
