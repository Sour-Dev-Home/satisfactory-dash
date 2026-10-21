import { useCallback, useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { ServerSummary } from "@satisfactory-dash/shared";
import { useOwnedServerWrites } from "../api/selfServeWrites";
import { queries } from "../api/queries";
import { DANGER_BUTTON, DANGER_BUTTON_QUIET } from "../components/dangerButton";
import { ErrorNotice } from "../components/ErrorNotice";
import { useServerSwitch } from "../servers/ServerContext";
import { ServerNameForm } from "./ServerNameForm";
import {
  DELETE_CLOSING,
  DELETE_GOES,
  DELETE_LEAD,
  PENDING_ACTION,
  PENDING_ACTION_REST,
  isPending,
  ownerActionErrorText,
} from "./selfServeText";

type Mode = "idle" | "renaming" | "confirming";

/**
 * The owner's controls for a server they added (ADR-0046): its name and status, the note about the 24-hour
 * removal while it is unenrolled, rename, and delete behind a typed confirmation that says what goes. Only
 * mounted for the owner of a `self_serve` server (`isSelfServeOwner`); the backend answers 403 to anyone else.
 * It renders a fragment so its `dl` is a direct child of the section's `.panel` and takes the agent panel's style.
 */
export function OwnedServerPanel({ server }: { server: ServerSummary }) {
  const { change } = useServerSwitch();
  const { rename, remove } = useOwnedServerWrites(server.id, change);
  // The agent status is already read on this page; once it says enrolled the list's `enrolled` may still be catching up.
  const agent = useQuery(queries.agentStatus(server.id));
  const pending = isPending(server, agent.data?.enrolled);
  const [mode, setMode] = useState<Mode>("idle");
  const [typed, setTyped] = useState("");
  // Focus follows the control that replaces the one clicked, and returns to the opener on cancel.
  const focusIn = useCallback((el: HTMLElement | null) => el?.focus(), []);
  const [returnTo, setReturnTo] = useState<"rename" | "delete" | null>(null);
  const explainId = useId();

  const close = (from: "rename" | "delete") => {
    setMode("idle");
    setTyped("");
    setReturnTo(from);
  };
  const matches = typed.trim() === server.displayName;
  const deleteError = remove.error == null ? undefined : ownerActionErrorText(remove.error);

  const confirmDelete = (event: FormEvent) => {
    event.preventDefault();
    if (matches && !remove.isPending) remove.mutate();
  };
  const escapeCancels = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !remove.isPending) {
      event.stopPropagation();
      close("delete");
    }
  };

  return (
    <>
      {/* Not before the agent's status is known: it would pop in (and out, once enrolled) under the reveal. */}
      {pending && agent.data !== undefined && (
        <p role="note" className="mb-0 rounded-card border border-warn bg-warn-soft p-3 text-sm">
          <Link to={{ hash: "#agent" }} className="underline">
            {PENDING_ACTION}
          </Link>
          {PENDING_ACTION_REST}
        </p>
      )}
      <dl className="mb-0">
        <dt>Name</dt>
        <dd>{server.displayName}</dd>
        <dt>Status</dt>
        <dd>{pending ? "Waiting for first connection" : "Connected"}</dd>
      </dl>

      {mode === "renaming" ? (
        <div className="animate-reveal">
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
        </div>
      ) : mode === "confirming" ? (
        <form
          onSubmit={confirmDelete}
          onKeyDown={escapeCancels}
          aria-label={`Confirm deleting ${server.displayName}`}
          className="grid animate-reveal gap-2 text-sm"
        >
          <div id={explainId} ref={focusIn} tabIndex={-1} className="grid gap-1">
            <p className="mb-0">{DELETE_LEAD}</p>
            <ul className="mb-0 list-disc pl-5">
              {DELETE_GOES.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="mb-0">{DELETE_CLOSING}</p>
          </div>
          <label htmlFor={`${explainId}-name`}>
            Type <strong>{server.displayName}</strong> to confirm
          </label>
          <input
            id={`${explainId}-name`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`${explainId} ${explainId}-exact`}
          />
          <span id={`${explainId}-exact`} className="text-muted">
            The name must match exactly, capital letters included.
          </span>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => close("delete")} disabled={remove.isPending}>
              Cancel
            </button>
            <button type="submit" className={DANGER_BUTTON} disabled={!matches || remove.isPending}>
              {remove.isPending ? "Deleting…" : "Delete this server"}
            </button>
          </div>
          {remove.error != null &&
            (deleteError ? (
              <p role="alert" className="mb-0 font-medium text-bad-on-soft">
                {deleteError}
              </p>
            ) : (
              <ErrorNotice error={remove.error} />
            ))}
        </form>
      ) : (
        <div className="flex flex-wrap gap-3">
          <button
            ref={returnTo === "rename" ? focusIn : undefined}
            type="button"
            aria-label={`Rename ${server.displayName}`}
            onClick={() => {
              setMode("renaming");
              rename.reset(); // a refusal from an earlier attempt must not greet the reopened form
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
    </>
  );
}
