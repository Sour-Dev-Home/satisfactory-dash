import { useMutation, useQueryClient } from "@tanstack/react-query";
import { endpoints, type ServerListResponse, type SessionResponse } from "@satisfactory-dash/shared";
import { apiSend } from "./client";
import { queries, SESSION_KEY, signOutLocally } from "./queries";
import { setSignedOutNotice } from "./signedOutNotice";

/** What the sign-in screen says after an account deletion (the app itself is gone by then). */
export const ACCOUNT_DELETED_NOTICE = "Your account was deleted. Your game and its saves were not touched.";

const DELETE_ACCOUNT_KEY = ["account", "remove"] as const;

/**
 * ADR-0047: delete the signed-in account. No body, nothing secret. On success the backend has already ended the session
 * and cleared the cookie, so this signs out locally the way sign-out does (every cached read goes), keeping the sign-in
 * methods the session last named so the sign-in screen still offers Google, and leaves a short note for that screen.
 * The refusals (reauth_required, would_orphan, forbidden) are the caller's to word.
 */
export function useDeleteAccount() {
  const client = useQueryClient();
  return useMutation({
    mutationKey: DELETE_ACCOUNT_KEY,
    mutationFn: () => apiSend(endpoints.account.remove, undefined),
    onSuccess: () => {
      const session = client.getQueryData<SessionResponse>(SESSION_KEY);
      setSignedOutNotice(ACCOUNT_DELETED_NOTICE);
      signOutLocally(client, { authenticated: false, signInMethods: session?.signInMethods });
    },
  });
}

/** Whether a deletion is already on its way: `isPending` lags a double click in the same tick. */
export function isDeletingAccount(client: ReturnType<typeof useQueryClient>): boolean {
  return client.isMutating({ mutationKey: DELETE_ACCOUNT_KEY }) > 0;
}

/**
 * ADR-0047: leave a server (any member but its owner). On success the server is dropped from the cached list at once
 * (a list of just the remaining one would otherwise re-select the server just left), the selection is dropped through
 * ServerGate (`onLeft`) before its cached reads go, so no poll answers server_not_found into the "no longer available"
 * note, and the list is read again.
 */
export function useLeaveServer(serverId: string, onLeft: () => void) {
  const client = useQueryClient();
  const listKey = queries.servers().queryKey;
  return useMutation({
    mutationFn: () => apiSend(endpoints.members.leave, undefined, serverId),
    onSuccess: () => {
      client.setQueryData(listKey, (old: ServerListResponse | undefined) =>
        old && { ...old, servers: old.servers.filter((s) => s.id !== serverId) },
      );
      onLeft();
      client.removeQueries({ queryKey: ["servers", serverId] });
      return client.invalidateQueries({ queryKey: listKey, exact: true });
    },
  });
}
