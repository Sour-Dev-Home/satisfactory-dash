import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { endpoints, type ServerConnection } from "@satisfactory-dash/shared";
import { apiSend } from "../api/client";
import { MANAGED_KEY, queries } from "../api/queries";
import type { FormMode } from "./ServerForm";
import { LanWarning } from "./LanWarning";
import { ManagementError } from "./ManagementError";
import { TestResult } from "./TestResult";

const STATE_NOTE: Record<ServerConnection["state"], string | undefined> = {
  ok: undefined,
  unreadable: "The saved tokens can't be read by this backend. Re-enter both tokens to use this server again.",
  refused: "This server's saved address isn't allowed. Edit the host or remove it.",
};

function tokens(server: ServerConnection): string {
  const api = server.apiTokenLast4 ? `API token ends in ${server.apiTokenLast4}` : "API token set";
  const frm = !server.frmTokenSet ? "no FRM token" : server.frmTokenLast4 ? `FRM token ends in ${server.frmTokenLast4}` : "FRM token set";
  return `${api} · ${frm}`;
}

/** One stored connection: what's saved (never a token, only its last 4) and what can be done with it. */
export function ServerRow({
  server,
  onEdit,
  onRemoved,
}: {
  server: ServerConnection;
  onEdit: (mode: FormMode) => void;
  onRemoved: (message: string) => void;
}) {
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const test = useMutation({
    mutationFn: () => apiSend(endpoints.serverManagement.testSaved, undefined, server.id),
  });
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
  const note = STATE_NOTE[server.state];
  const headingId = `server-${server.id}`;

  return (
    <li aria-labelledby={headingId} className="grid gap-3 px-5 py-4">
      <div className="grid gap-0.5">
        <h4 id={headingId} className="mb-0 text-base font-semibold text-fg-strong">
          {server.displayName}
        </h4>
        <p className="mb-0 text-sm text-muted">
          {server.id} · {server.host}, game API port {server.apiPort}, FRM port {server.frmPort}
        </p>
        {server.state !== "unreadable" && <p className="mb-0 text-sm text-muted">{tokens(server)}</p>}
      </div>
      {note && <p className="mb-0 text-sm font-medium text-warn">{note}</p>}
      {server.plainHttpOverLan && <LanWarning />}
      {test.data && !test.isPending && <TestResult result={test.data} />}
      {test.error && !test.isPending && <ManagementError error={test.error} />}

      {confirming ? (
        <div role="group" aria-label={`Remove ${server.displayName}?`} className="grid gap-3 rounded-lg border border-line bg-surface-2 p-4">
          <p className="mb-0 text-sm text-fg-strong">
            Remove {server.displayName}? The dashboard stops connecting to it, everyone loses access to it, and its saved
            tokens are deleted. The audit log keeps a record of the removal.
          </p>
          {remove.error && !remove.isPending && <ManagementError error={remove.error} />}
          {/* The safe choice first, where a quick tap lands. */}
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={remove.isPending} onClick={() => setConfirming(false)}>
              Keep it
            </button>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
              className="border-bad-solid bg-bad-solid text-white"
            >
              {remove.isPending ? "Removing…" : "Remove server"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          {server.state === "ok" && (
            <button type="button" disabled={test.isPending} onClick={() => test.mutate()}>
              {test.isPending ? "Testing…" : "Test connection"}
            </button>
          )}
          {server.state === "unreadable" ? (
            <>
              <button type="button" onClick={() => onEdit({ kind: "repair", server })}>
                Re-enter both tokens
              </button>
              <button type="button" onClick={() => onEdit({ kind: "rename", server })}>
                Rename
              </button>
            </>
          ) : (
            <button type="button" onClick={() => onEdit({ kind: "edit", server })}>
              {server.state === "refused" ? "Edit host" : "Edit"}
            </button>
          )}
          <button type="button" onClick={() => setConfirming(true)}>
            Remove
          </button>
        </div>
      )}
    </li>
  );
}
