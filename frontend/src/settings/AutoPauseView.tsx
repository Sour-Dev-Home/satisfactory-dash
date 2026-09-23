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
  const save = useMutation({
    mutationFn: (enabled: boolean) => apiSend(endpoints.settings.setAutoPause, { enabled }, server.id),
    onSuccess: (snapshot) => {
      client.setQueryData(settingsQuery.queryKey, snapshot);
      // DSAutoPause applies immediately (ADR-0012), so gamePaused may already have flipped;
      // refresh status now rather than letting the paused banner lag a full poll behind.
      void client.invalidateQueries({ queryKey: queries.status(server.id).queryKey });
    },
    onError: (error) => {
      // 409 not_editable: our copy of `editable` is out of date, so re-read it.
      if (classifyError(error) === "not_editable") void client.invalidateQueries({ queryKey: settingsQuery.queryKey });
    },
  });

  if (settings.isPending) return <p role="status">Loading settings…</p>;
  return (
    <>
      {settings.isError && <ErrorNotice error={settings.error} />}
      {settings.data && (
        <AutoPausePanel snapshot={settings.data} saving={save.isPending} onChange={(enabled) => save.mutate(enabled)} />
      )}
      {save.isError && <ErrorNotice error={save.error} />}
    </>
  );
}
