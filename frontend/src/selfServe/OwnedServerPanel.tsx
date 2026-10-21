import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ServerSummary } from "@satisfactory-dash/shared";
import { useOwnedServerWrites } from "../api/selfServeWrites";
import { queries } from "../api/queries";
import { DANGER_BUTTON, DANGER_BUTTON_QUIET } from "../components/dangerButton";
import { ErrorNotice } from "../components/ErrorNotice";
import { useServerSwitch } from "../servers/ServerContext";
import { ServerNameForm } from "./ServerNameForm";
import { DELETE_EXPLANATION, PENDING_NOTICE, isPending, ownerActionErrorText } from "./selfServeText";

type Mode = "idle" | "renaming" | "confirming";

/**
 * The owner's controls for a server they added (ADR-0046): the 24-hour notice while it is unenrolled,
 * rename, and delete behind a typed confirmation that says what goes. Only mounted for the owner of a
 * `self_serve` server (`isSelfServeOwner`); the backend answers 403 to anyone else.
 */
export function OwnedServerPanel({ server }: { server: ServerSummary }) {
  const { change } = useServerSwitch();
  const { rename, remove } = useOwnedServerWrites(server.id, change);
  // The agent status is already read on this page; once it says enrolled the list's `enrolled` may still be catching up.
  const agentEnrolled = useQuery(queries.agentStatus(server.id)).data?.enrolled;
  const [mode, setMode] = useState<Mode>("idle");
  const [typed, setTyped] = useState("");
  // Focus follows the control that replaces the one clicked, and returns to the opener on cancel.
  const focusIn = useCallback((el: HTMLElement | null) => el?.focus(), []);
  const [returnTo, setReturnTo] = useState<"rename" | "delete" | null>(null);

  const close = (from: "rename" | "delete") => {
    setMode("idle");
    setTyped("");
    setReturnTo(from);
  };
  const matches = typed.trim() === server.displayName;
  const deleteError = remove.error == null ? undefined : ownerActionErrorText(remove.error);

  return (
    <div className="grid gap-3">
      <h4 className="mb-0">{server.displayName}</h4>
      {isPending(server, agentEnrolled) && (
        <p role="note" className="mb-0 rounded-card border border-warn bg-warn-soft p-3 text-sm">
          {PENDING_NOTICE}
        </p>
      )}

      {mode === "renaming" ? (
        <ServerNameForm
          label="New server name"
          initialName={server.displayName}
          submitLabel="Save name"
          busyLabel="Saving…"
          busy={rename.isPending}
          error={rename.error}
          errorText={ownerActionErrorText(rename.error)}
          autoFocus
          onSubmit={async (name) => {
            await rename.mutateAsync(name);
            close("rename");
          }}
          onCancel={() => close("rename")}
        />
      ) : mode === "confirming" ? (
        <div role="group" aria-label={`Confirm deleting ${server.displayName}`} className="grid gap-2 text-sm">
          <p ref={focusIn} tabIndex={-1} className="mb-0">
            {DELETE_EXPLANATION}
          </p>
          <label htmlFor="delete-confirm-name">
            Type <strong>{server.displayName}</strong> to confirm
          </label>
          <input
            id="delete-confirm-name"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => close("delete")} disabled={remove.isPending}>
              Cancel
            </button>
            <button
              type="button"
              className={DANGER_BUTTON}
              disabled={!matches || remove.isPending}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? "Deleting…" : "Delete this server"}
            </button>
          </div>
          {remove.error != null &&
            (deleteError ? (
              <p role="alert" className="mb-0 font-medium text-bad">
                {deleteError}
              </p>
            ) : (
              <ErrorNotice error={remove.error} />
            ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <button
            ref={returnTo === "rename" ? focusIn : undefined}
            type="button"
            aria-label={`Rename ${server.displayName}`}
            onClick={() => {
              setMode("renaming");
              setReturnTo(null);
            }}
          >
            Rename
          </button>
          <button
            ref={returnTo === "delete" ? focusIn : undefined}
            type="button"
            aria-label={`Delete ${server.displayName}`}
            className={DANGER_BUTTON_QUIET}
            onClick={() => {
              setMode("confirming");
              setReturnTo(null);
              remove.reset();
            }}
          >
            Delete…
          </button>
        </div>
      )}
    </div>
  );
}
