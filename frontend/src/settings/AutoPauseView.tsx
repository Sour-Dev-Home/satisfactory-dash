import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { endpoints } from "@satisfactory-dash/shared";
import { apiSend } from "../api/client";
import { classifyError } from "../api/errors";
import { isSignedOut, queries } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";
import { useSelectedServer } from "../servers/ServerContext";
import { AutoPausePanel } from "./AutoPausePanel";

/**
 * Container: reads settings through the query layer and writes only on a user action.
 * No optimistic update: the checkbox shows what the backend returns, never a guess.
 */
export function AutoPauseView() {
  const server = useSelectedServer();
  const client = useQueryClient();
  const settingsQuery = queries.settings(server.id);
  const settings = useQuery(settingsQuery);
  const saveKey = [...settingsQuery.queryKey, "auto-pause"];
  const save = useMutation({
    mutationKey: saveKey,
    mutationFn: (enabled: boolean) => apiSend(endpoints.settings.setAutoPause, { enabled }, server.id),
    // A settings read already in flight (pending poll, invalidation) would otherwise land
    // after the PUT and overwrite its value with the pre-change one.
    onMutate: () => client.cancelQueries({ queryKey: settingsQuery.queryKey }),
    onSuccess: async (snapshot) => {
      // Same for a read that started while the PUT was in flight (focus refetch, pending poll):
      // the server may have answered it before applying the change.
      await client.cancelQueries({ queryKey: settingsQuery.queryKey });
      // Signed out while the PUT was in flight: don't put this session's data back in the cache.
      if (isSignedOut(client)) return;
      // ADR-0031 PR 3: for a server reached through an agent the answer can be a 202 with a COMMAND instead of the new
      // setting. The setting has not changed yet, so it is not put in the cache as if it had: re-read it instead. (The
      // screen that follows the command to its result is ADR-0031 PR 4; the backend still answers 200 until PR 5.)
      if ("command" in snapshot) {
        void client.invalidateQueries({ queryKey: settingsQuery.queryKey });
        return;
      }
      client.setQueryData(settingsQuery.queryKey, snapshot);
      // DSAutoPause applies immediately (ADR-0012), so gamePaused may already have flipped;
      // refresh status now rather than letting the paused banner lag a full poll behind.
      void client.invalidateQueries({ queryKey: queries.status(server.id).queryKey });
    },
    onError: (error) => {
      // 409 not_editable: our copy of `editable` is out of date, so re-read it.
      // server_not_found: re-read too, so the query error reaches ServerGate, which only
      // watches queries, and the lost server is dropped now rather than at the next poll.
      const kind = classifyError(error);
      if (kind === "not_editable" || kind === "server_not_found") {
        void client.invalidateQueries({ queryKey: settingsQuery.queryKey });
      }
    },
  });
  // save.isPending only updates on the next render, so a fast double click would send two PUTs.
  const onChange = (enabled: boolean) => {
    if (client.isMutating({ mutationKey: saveKey }) === 0) save.mutate(enabled);
  };

  if (settings.isPending) return <p role="status">Loading settings…</p>;
  return (
    <>
      {settings.isError && <ErrorNotice error={settings.error} />}
      {settings.data && (
        <AutoPausePanel snapshot={settings.data} saving={save.isPending} onChange={onChange} />
      )}
      {save.isError && <ErrorNotice error={save.error} />}
    </>
  );
}
