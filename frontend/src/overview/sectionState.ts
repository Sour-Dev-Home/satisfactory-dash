import type { UseQueryResult } from "@tanstack/react-query";
import { isUpdatingGap, type DeployGapPhase } from "../api/deployGap";
import { isFirstLoad } from "../api/settled";
import type { SectionHealth, SectionState } from "./health";

/**
 * No data to show: loading (a first load), "updating" while a deploy gap is recent (ADR-0054 D4: calm, not an
 * error), else an error. Only a first load is pending: a failed read stays an error through its next polls (each
 * goes back to pending in TanStack Query), so the cards don't flip every interval.
 */
export function failedOrPending(query: UseQueryResult<unknown>, phase: DeployGapPhase): "error" | "pending" | "updating" {
  if (isFirstLoad(query)) return "pending";
  return isUpdatingGap(query.error, phase) ? "updating" : "error";
}

/** Data wins over an error: a failed background refetch keeps showing the last snapshot. */
export function stateOf<T>(
  query: UseQueryResult<T>,
  phase: DeployGapPhase,
  health: (snapshot: T) => SectionHealth,
): SectionState {
  if (query.data) return health(query.data);
  return failedOrPending(query, phase);
}
