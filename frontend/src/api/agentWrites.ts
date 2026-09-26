import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { endpoints, type EnrollmentCodeResponseSchema } from "@satisfactory-dash/shared";
import { apiSend } from "./client";
import { queries } from "./queries";

/** A new enrolment code and its expiry. (Shared exports the schema but not this type yet.) */
export type EnrollmentCode = z.infer<typeof EnrollmentCodeResponseSchema>;

/**
 * The agent writes (ADR-0031 PR 7), for the Settings section's owner/admin controls. The backend is
 * the real control: a member's write answers 403, which the caller shows like any error.
 */
export function useAgentWrites(serverId: string) {
  const client = useQueryClient();
  const statusKey = queries.agentStatus(serverId).queryKey;

  // The code is a credential for ten minutes and is shown once. TanStack keeps a mutation's answer in
  // its cache after it settles, so this mutation isn't kept (gcTime 0) and the caller copies the code
  // into its own state and calls `reset()` straight away.
  const createCode = useMutation({
    mutationFn: () => apiSend(endpoints.agent.enrollmentCode, undefined, serverId),
    gcTime: 0,
  });

  // Revoking changes what the status says; re-read it rather than guess.
  const revoke = useMutation({
    mutationFn: () => apiSend(endpoints.agent.revoke, undefined, serverId),
    onSuccess: () => client.invalidateQueries({ queryKey: statusKey }),
  });

  return { createCode, revoke };
}
