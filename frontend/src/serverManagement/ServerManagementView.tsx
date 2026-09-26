import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queries } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";
import { ServerForm, type FormMode } from "./ServerForm";
import { ServerRow } from "./ServerRow";

/**
 * ADR-0030: the operator adds, edits and removes game servers. Shown only when the server list
 * says canManageServers; hiding it is UX only (every route is operator-only on the backend).
 */
export function ServerManagementView() {
  const managed = useQuery(queries.managedServers());
  const [editing, setEditing] = useState<FormMode | null>(null);
  const [notice, setNotice] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  // Opening or closing the form replaces what had focus: land on the heading of what's shown.
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    const target = editing ? document.querySelector<HTMLElement>("#server-form-anchor h3") : heading.current;
    target?.setAttribute("tabindex", "-1");
    target?.focus();
  }, [editing]);

  const open = (mode: FormMode) => {
    moved.current = true;
    setNotice("");
    setEditing(mode);
  };
  const close = (message: string) => {
    moved.current = true;
    setNotice(message);
    setEditing(null);
  };

  if (editing) {
    return (
      <div id="server-form-anchor">
        <ServerForm key={editing.kind === "create" ? "create" : `${editing.kind}-${editing.server.id}`} mode={editing} onDone={close} />
      </div>
    );
  }

  const servers = managed.data?.servers;
  return (
    <section aria-labelledby="servers-heading" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="servers-heading" ref={heading} tabIndex={-1} className="mb-0">
          Game servers
        </h3>
        {servers && (
          <button type="button" onClick={() => open({ kind: "create" })} className="border-accent bg-accent text-on-accent">
            Add a server
          </button>
        )}
      </div>
      <p role="status" className="mb-0 empty:hidden">
        {notice}
      </p>
      {!servers ? (
        managed.isError ? (
          <ErrorNotice
            error={managed.error}
            action={
              <button type="button" onClick={() => void managed.refetch()}>
                Retry
              </button>
            }
          />
        ) : (
          <p role="status">Loading servers…</p>
        )
      ) : servers.length === 0 ? (
        <p className="rounded-card border border-line bg-surface p-5 text-muted">
          No game servers yet. Add the first one; for now it has to run on this machine.
        </p>
      ) : (
        <ul aria-label="Game servers" className="divide-y divide-line rounded-card border border-line bg-surface">
          {servers.map((server) => (
            <ServerRow key={server.id} server={server} onEdit={open} onRemoved={close} />
          ))}
        </ul>
      )}
    </section>
  );
}
