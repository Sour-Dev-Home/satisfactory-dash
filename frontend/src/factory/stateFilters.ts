import { isBackedUpState, type FactoryBuilding } from "@satisfactory-dash/shared";
import { FACTORY_STATE_FILTERS, type FactoryStateFilter } from "../lib/deepLinks";
import type { StalledKind } from "../planner/plannerText";

/**
 * The machine table's state filters (ADR-0062 F.3): toggles, kept in the URL as `?state=` (`lib/deepLinks.ts`). None on is
 * "All"; with several on, a machine shows when it matches any of them, so each toggle widens the list.
 */
export interface StateFilterView {
  label: string;
  match: (b: FactoryBuilding) => boolean;
  /** The Planner's mark for it; "No recipe" is not a state and has none. */
  mark?: StalledKind;
}

/** Each filter's label and test, in `FACTORY_STATE_FILTERS` order. */
export const STATE_FILTERS = new Map<FactoryStateFilter, StateFilterView>([
  ["backedUp", { label: "Backed up", match: isBackedUpState, mark: "backedUp" }],
  ["paused", { label: "Paused", match: (b) => b.isPaused, mark: "paused" }],
  ["noRecipe", { label: "No recipe", match: (b) => b.recipe === null }],
]);

/** Whether a machine passes the filters that are on (all of them pass when none is). */
export function matchesStates(b: FactoryBuilding, states: readonly FactoryStateFilter[]): boolean {
  return states.length === 0 || states.some((state) => STATE_FILTERS.get(state)?.match(b) === true);
}

/** `states` with `state` turned on or off, in the filters' order. */
export function toggleState(states: readonly FactoryStateFilter[], state: FactoryStateFilter): FactoryStateFilter[] {
  const on = !states.includes(state);
  return FACTORY_STATE_FILTERS.filter((s) => (s === state ? on : states.includes(s)));
}
