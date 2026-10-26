import { useMutation, useQueryClient } from "@tanstack/react-query";
import { endpoints, type CreatePlannerDesignationRequest, type UpdatePlannerDesignationRequest } from "@satisfactory-dash/shared";
import { apiSend } from "./client";
import { queries } from "./queries";

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
  return { create, update, remove };
}

export type PlannerDesignationWrites = ReturnType<typeof usePlannerDesignationWrites>;
