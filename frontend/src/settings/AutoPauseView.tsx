import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { endpoints } from "@satisfactory-dash/shared";
import { apiSend } from "../api/client";
import { classifyError } from "../api/errors";
import { queries } from "../api/queries";
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
    onSuccess: (snapshot) => {
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
