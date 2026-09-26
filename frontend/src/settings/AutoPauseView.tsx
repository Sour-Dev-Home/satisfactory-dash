import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { endpoints, type Command } from "@satisfactory-dash/shared";
import { apiSend } from "../api/client";
import { classifyError } from "../api/errors";
import { isSignedOut, queries } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";
import { useSelectedServer } from "../servers/ServerContext";
import { AutoPausePanel } from "./AutoPausePanel";
import { commandPhase, EXPIRED_TEXT, failureText, msUntilGiveUp, type CommandPhase } from "./command";

/** A change relayed to the game PC: the command the PUT answered with, and whether the page gave up on it. */
interface Relayed {
  command: Command;
  gaveUp: boolean;
}

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

  // ADR-0031 PR 4: a change relayed through the game PC's agent (the PUT answered 202 with a command),
  // followed until it lands. Only the command and "gave up" are kept; where it stands is derived from
  // the latest poll. It stays set after the result, so the result stays on screen until the next change.
  // Kept per server: after switching servers, another server's command is never shown or polled
  // here, and a change on this server never touches another's (Shell also keys this view by server).
  const [sent, setSent] = useState<Record<string, Relayed | undefined>>({});
  const relayed = sent[server.id] ?? null;
  const setRelayed = useCallback(
    (update: (current: Relayed | null) => Relayed | null) =>
      setSent((all) => ({ ...all, [server.id]: update(all[server.id] ?? null) ?? undefined })),
    [server.id],
  );
  const followed = useQuery({
    ...queries.command(server.id, relayed?.command.id ?? ""),
    enabled: relayed !== null && !relayed.gaveUp,
  });
  const answer = followed.data?.command;
  const phase: CommandPhase | null =
    relayed === null
      ? null
      : relayed.gaveUp
        ? "expired"
        : answer !== undefined && answer.id === relayed.command.id
          ? commandPhase(answer.status)
          : "waiting";
  const outcome = phase === "failed" ? failureText(answer?.resultCode ?? null) : phase === "expired" ? EXPIRED_TEXT : null;

  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: queries.settings(server.id).queryKey });
    void client.invalidateQueries({ queryKey: queries.status(server.id).queryKey });
  }, [client, server.id]);

  // Done on the game PC: now the setting has changed, so read it.
  useEffect(() => {
    if (phase === "succeeded") refresh();
  }, [phase, refresh]);

  // No final answer by just after the command's expiry (the backend is down, or a status this build
  // doesn't know): stop waiting, say so, and re-read what the setting really is.
  const waitingFor = phase === "waiting" ? relayed?.command : undefined;
  useEffect(() => {
    if (waitingFor === undefined) return;
    const timer = setTimeout(() => {
      setRelayed((current) => (current?.command.id === waitingFor.id ? { ...current, gaveUp: true } : current));
      refresh();
    }, msUntilGiveUp(waitingFor, Date.now()));
    return () => clearTimeout(timer);
  }, [waitingFor, refresh, setRelayed]);

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
      // ADR-0031: for a server reached through an agent the answer is a 202 with a COMMAND, not the new setting. The
      // setting hasn't changed yet, so nothing goes in the cache: follow the command until it lands (above).
      if ("command" in snapshot) {
        const command = snapshot.command;
        setRelayed(() => ({ command, gaveUp: false }));
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
  // save.isPending only updates on the next render, so a fast double click would send two PUTs. A
  // change still on its way to the game PC holds the toggle too.
  const onChange = (enabled: boolean) => {
    if (client.isMutating({ mutationKey: saveKey }) !== 0 || phase === "waiting") return;
    // Clear the last result, but only when there is one: a state update here, even to the same
    // value, re-renders before the PUT and lets a stale settings read land after it.
    if (relayed !== null) setRelayed(() => null);
    save.mutate(enabled);
  };

  if (settings.isPending) return <p role="status">Loading settings…</p>;
  return (
    <>
      {settings.isError && <ErrorNotice error={settings.error} />}
      {settings.data && (
        <AutoPausePanel snapshot={settings.data} saving={save.isPending || phase === "waiting"} onChange={onChange} />
      )}
      {save.isError && <ErrorNotice error={save.error} />}
      {outcome && <p role="alert">{outcome}</p>}
    </>
  );
}
