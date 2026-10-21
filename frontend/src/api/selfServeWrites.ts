import { useMutation, useQueryClient } from "@tanstack/react-query";
import { endpoints, type ServerListResponse } from "@satisfactory-dash/shared";
import { apiSend } from "./client";
import { queries } from "./queries";

/**
 * "Add your server" (ADR-0046): any signed-in user, while the list says `selfServeEnabled`. The answer
 * is the new agent server; the list is re-read so the caller can select it. No secret passes through
 * (the enrolment code is made later, in the agent settings).
 */
export function useAddServer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (displayName: string) => apiSend(endpoints.selfServe.createAgentServer, { displayName }),
    onSuccess: () => client.invalidateQueries({ queryKey: queries.servers().queryKey, exact: true }),
  });
}

/** The owner's rename and delete of a server they added (`selfServeOwner`). The backend is the real control. */
export function useOwnedServerWrites(serverId: string, onRemoved: () => void) {
  const client = useQueryClient();
  const listKey = queries.servers().queryKey;
  const rename = useMutation({
    mutationFn: (displayName: string) => apiSend(endpoints.serverManagement.renameAgent, { displayName }, serverId),
    onSuccess: () => client.invalidateQueries({ queryKey: listKey, exact: true }),
  });
  const remove = useMutation({
    mutationFn: () => apiSend(endpoints.serverManagement.remove, undefined, serverId),
    onSuccess: () => {
      // Leave the server first (so its polled reads stop and none answers server_not_found into the
      // "no longer available" note), then forget its cached reads and re-read the list.
      // The answer says it is gone: drop it from the cached list now, or a list of just this server would re-select it.
      client.setQueryData(listKey, (old: ServerListResponse | undefined) =>
        old && { ...old, servers: old.servers.filter((s) => s.id !== serverId) },
      );
      onRemoved();
      client.removeQueries({ queryKey: ["servers", serverId] });
      return client.invalidateQueries({ queryKey: listKey, exact: true });
    },
  });
  return { rename, remove };
}
