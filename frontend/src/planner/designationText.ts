import { PLANNER_DESIGNATIONS_MAX_PER_SERVER, PlannerDesignationNameSchema } from "@satisfactory-dash/shared";
import { ApiError } from "../api/errors";
import { describeError } from "../components/ErrorNotice";

/** Whether a role may designate factories (ADR-0055 Decision 5: owner and admin; the backend's guard is the real control). */
export function canDesignate(role: string | undefined): boolean {
  return role === "owner" || role === "admin";
}

const machines = (n: number) => `${n} ${n === 1 ? "machine" : "machines"}`;

/** The two designation conflicts in the planner's own words; anything else reads like any other error. */
export function designationErrorText(error: unknown): string {
  if (error instanceof ApiError && error.code === "designation_overlap") {
    return error.other === undefined
      ? "Some of these machines already belong to another designated factory"
      : `Some of these machines already belong to ${error.other.name}`;
  }
  if (error instanceof ApiError && error.code === "designation_cap") {
    return `You can have up to ${PLANNER_DESIGNATIONS_MAX_PER_SERVER} designated factories`;
  }
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
