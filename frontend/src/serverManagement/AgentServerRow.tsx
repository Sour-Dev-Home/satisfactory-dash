import { useId } from "react";
import type { AgentServer } from "@satisfactory-dash/shared";
import type { FormMode } from "./ServerForm";

/**
 * A server reached through the game PC's agent (ADR-0031, #266). It has no stored connection, so its
 * only edits are its name and switching back to being read directly (#273). Each button's name
 * starts with its visible text and adds the server's (#309).
 */
export function AgentServerRow({ server, onEdit }: { server: AgentServer; onEdit: (mode: FormMode) => void }) {
  const headingId = useId();
  return (
    <li aria-labelledby={headingId} className="grid gap-3 px-5 py-4">
      <div className="grid gap-0.5">
        <h4 id={headingId} className="mb-0 text-base font-semibold text-fg-strong">
          {server.displayName}
        </h4>
        <p className="mb-0 text-sm text-muted">
          {server.id} · read through the game PC's agent. Its agent's status is on Settings.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => onEdit({ kind: "renameAgent", server })}
          aria-label={`Rename ${server.displayName}`}
        >
          Rename
        </button>
        <button
          type="button"
          onClick={() => onEdit({ kind: "switchToLocal", server })}
          aria-label={`Switch back to local for ${server.displayName}`}
        >
          Switch back to local
        </button>
      </div>
    </li>
  );
}
