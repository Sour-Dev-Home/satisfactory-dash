import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  endpoints,
  type CreatePlannerDesignationRequest,
  type ReplacePlannerDesignationsRequest,
  type UpdatePlannerDesignationRequest,
} from "@satisfactory-dash/shared";
import { apiSend } from "./client";
import { ApiError } from "./errors";
import { queries } from "./queries";

/** A replace whose `expect` named a designation someone else changed or removed meanwhile (409 `designation_stale`). */
export const isStaleDesignation = (error: unknown): boolean => error instanceof ApiError && error.code === "designation_stale";

/**
 * The Planner designation writes (ADR-0055 PR 10a). The backend is the real control (a viewer's write answers 403, and an
 * overlap or the cap answers 409); none guesses ahead of it. A write changes both the list and the factories the graph
 * derives from it, so each re-reads the two instead of patching either.
 */
export function usePlannerDesignationWrites(serverId: string) {
  const client = useQueryClient();
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: queries.plannerDesignations(serverId).queryKey }),
      client.invalidateQueries({ queryKey: queries.productionGraph(serverId).queryKey }),
    ]);

  const create = useMutation({
    mutationFn: (body: CreatePlannerDesignationRequest) => apiSend(endpoints.plannerDesignations.create, body, serverId),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdatePlannerDesignationRequest }) =>
      apiSend(endpoints.plannerDesignations.update, body, serverId, id),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiSend(endpoints.plannerDesignations.remove, undefined, serverId, id),
    onSuccess: refresh,
  });
  // ADR-0055 Decision 11 (#727): merge, split, pop-out, dissolve and undo. No optimistic patch, like the writes above. A
  // `designation_stale` answer means the page's copy is old, so both reads are fetched again before the caller says so.
  const replace = useMutation({
    mutationFn: (body: ReplacePlannerDesignationsRequest) => apiSend(endpoints.plannerDesignations.replace, body, serverId),
    onSuccess: refresh,
    onError: (error) => (isStaleDesignation(error) ? refresh() : undefined),
  });
  return { create, update, remove, replace };
}

export type PlannerDesignationWrites = ReturnType<typeof usePlannerDesignationWrites>;
