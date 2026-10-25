import { useMutation, useQueryClient } from "@tanstack/react-query";
import { endpoints, type PairingApproveRequest } from "@satisfactory-dash/shared";
import { apiSend } from "./client";
import { queries } from "./queries";

/**
 * ADR-0051 section 1 / ADR-0057 D6: the signed-in side of device-code pairing. The code is typed by the person and is
 * no secret on its own, but it is still never kept: `gcTime: 0`, and the page calls `reset()` once it has what it needs.
 * Nothing here touches browser storage.
 */
export function usePairingLookup() {
  return useMutation({
    gcTime: 0,
    mutationFn: (userCode: string) => apiSend(endpoints.pairings.lookup, { userCode }),
  });
}

export function usePairingApprove() {
  const client = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: (body: PairingApproveRequest) => apiSend(endpoints.pairings.approve, body),
    // A new server joins the list (an existing one may now read as enrolled): re-read it before the page links to it.
    onSuccess: () => client.invalidateQueries({ queryKey: queries.servers().queryKey, exact: true }),
  });
}
