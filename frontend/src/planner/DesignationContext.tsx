import { createContext, useContext } from "react";
import type { PlannerDesignationMember, PlannerDesignationsResponse } from "@satisfactory-dash/shared";
import type { PlannerDesignationWrites } from "../api/plannerWrites";
import type { Place } from "./designationMatch";

/**
 * What the Planner's designation controls need (ADR-0055 Decision 5), from the page that reads them: whether this member
 * may write, the designations with their matches, where the machines stand (the Factory read), and the writes. The default
 * is a read-only page with nothing designated, so a panel rendered without a provider is as it was.
 */
export interface DesignationState {
  canWrite: boolean;
  designations: PlannerDesignationsResponse | undefined;
  /** undefined until the Factory read has answered. */
  places: ReadonlyMap<string, Place> | undefined;
  /** Per designation, its members the live buildings no longer hold; undefined until both reads have answered. */
  missing: ReadonlyMap<string, readonly PlannerDesignationMember[]> | undefined;
  writes: PlannerDesignationWrites | null;
}

const NONE: DesignationState = { canWrite: false, designations: undefined, places: undefined, missing: undefined, writes: null };

export const DesignationContext = createContext<DesignationState>(NONE);
export const useDesignations = (): DesignationState => useContext(DesignationContext);
