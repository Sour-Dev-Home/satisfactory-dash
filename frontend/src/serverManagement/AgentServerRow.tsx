import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { endpoints, type AgentServer } from "@satisfactory-dash/shared";
import { apiSend } from "../api/client";
import { MANAGED_KEY, queries } from "../api/queries";
import { DANGER_BUTTON, DANGER_BUTTON_QUIET } from "../components/dangerButton";
import { ErrorNotice } from "../components/ErrorNotice";
import { ServerUpdateLine } from "../updates/UpdateBanners";

/**
 * A server on the operator's list (ADR-0031, #266; ADR-0066: every server connects through the mod). It has no stored
 * connection, so it can only be renamed or removed. Each button's name starts with its visible text and adds the
 * server's (#309).
 */
export function AgentServerRow({
  server,
  onRename,
  onRemoved,
}: {
  server: AgentServer;
  onRename: (server: AgentServer) => void;
  onRemoved: (message: string) => void;
}) {
  const headingId = useId();
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  // Opening the confirm unmounts Remove, and Keep it unmounts itself: focus goes to Keep it (the safe choice) on open
  // and back to Remove on Keep it, never to the page's top.
  const keepButton = useRef<HTMLButtonElement>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  const toggled = useRef(false);
  useEffect(() => {
    if (!toggled.current) return;
    toggled.current = false;
    (confirming ? keepButton.current : removeButton.current)?.focus();
  }, [confirming]);
  const setConfirm = (next: boolean) => {
    toggled.current = true;
    setConfirming(next);
  };
  const remove = useMutation({
    mutationFn: () => apiSend(endpoints.serverManagement.remove, undefined, server.id),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: MANAGED_KEY }),
        client.invalidateQueries({ queryKey: queries.servers().queryKey, exact: true }),
      ]);
      onRemoved(`Removed ${server.displayName}.`);
    },
  });
  return (
    <li aria-labelledby={headingId} className="grid gap-3 px-5 py-4">
      <div className="grid gap-0.5">
        <h4 id={headingId} className="mb-0 text-base font-semibold text-fg-strong">
          {server.displayName}
        </h4>
        <p className="mb-0 text-sm text-muted">
          {server.id} · read through the Satis Manager mod. The mod&apos;s status is on Settings.
        </p>
        <ServerUpdateLine serverId={server.id} />
      </div>
      {confirming ? (
        <div role="group" aria-label={`Remove ${server.displayName}?`} className="grid gap-3 rounded-card border border-line bg-surface-2 p-4">
          <p className="mb-0 text-sm text-fg-strong">
            {/* What the backend does (softDeleteServer, #193): memberships, the mod's credential and the recorded history go. */}
            Remove {server.displayName}? Everyone loses access to it, the mod&apos;s connection stops working, and its recorded
            history is erased. The game and its saves are never touched. The audit log keeps a record of the removal.
          </p>
          {remove.error && !remove.isPending && <ErrorNotice error={remove.error} />}
          {/* The safe choice first, where a quick tap lands. */}
          <div className="flex flex-wrap gap-3">
            <button ref={keepButton} type="button" disabled={remove.isPending} onClick={() => setConfirm(false)}>
              Keep it
            </button>
            <button type="button" disabled={remove.isPending} onClick={() => remove.mutate()} className={DANGER_BUTTON}>
              {remove.isPending ? "Removing…" : "Remove server"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => onRename(server)} aria-label={`Rename ${server.displayName}`}>
            Rename
          </button>
          <button
            ref={removeButton}
            type="button"
            onClick={() => {
              remove.reset();
              setConfirm(true);
            }}
            className={DANGER_BUTTON_QUIET}
            aria-label={`Remove ${server.displayName}`}
          >
            Remove
          </button>
        </div>
      )}
    </li>
  );
}
