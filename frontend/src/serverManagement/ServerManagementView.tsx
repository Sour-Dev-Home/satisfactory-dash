import { Loadable, Skeleton, SkeletonStatus } from "../ui/Skeleton";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AgentServer } from "@satisfactory-dash/shared";
import { queries } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";
import { AgentServerRow } from "./AgentServerRow";
import { RenameServerForm } from "./RenameServerForm";

/** The server list while it loads: a couple of rows in the list's own box. */
function ServersSkeleton() {
  return (
    <div className="grid gap-3">
      <SkeletonStatus>Loading servers…</SkeletonStatus>
      <Skeleton className="h-20" />
      <Skeleton className="h-20" />
    </div>
  );
}

/**
 * ADR-0030: the operator renames and removes game servers. Shown only when the server list says canManageServers;
 * hiding it is UX only (every route is operator-only on the backend). ADR-0066: every server connects through the
 * mod, so the list is the managed answer's `agentServers`. Its `servers` (stored direct-poll connections) are ignored
 * even when an older backend still sends some: nothing here can add, edit or test one any more.
 */
export function ServerManagementView() {
  const managed = useQuery(queries.managedServers());
  // Only for the empty state's wording: whether "Add your server" exists on this backend.
  const selfServeEnabled = useQuery(queries.servers()).data?.selfServeEnabled === true;
  const [renaming, setRenaming] = useState<AgentServer | null>(null);
  const [notice, setNotice] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  // Opening or closing the form, or removing a row, replaces what had focus: land on the heading of what's shown. A
  // counter, not the `renaming` change: a removal leaves `renaming` null, so only a counter re-runs the effect.
  const [moves, setMoves] = useState(0);
  useEffect(() => {
    if (moves === 0) return;
    const target = renaming ? document.querySelector<HTMLElement>("#server-form-anchor h3") : heading.current;
    target?.setAttribute("tabindex", "-1");
    target?.focus();
  }, [moves, renaming]);

  const open = (server: AgentServer) => {
    setMoves((n) => n + 1);
    setNotice("");
    setRenaming(server);
  };
  const close = (message: string) => {
    setMoves((n) => n + 1);
    setNotice(message);
    setRenaming(null);
  };

  if (renaming) {
    return (
      <div id="server-form-anchor">
        <RenameServerForm key={renaming.id} server={renaming} onDone={close} />
      </div>
    );
  }

  // Optional in the contract: an older backend doesn't list them (ADR-0007).
  const servers = managed.data ? (managed.data.agentServers ?? []) : undefined;
  return (
    <section aria-labelledby="servers-heading" className="grid gap-4">
      <h3 id="servers-heading" ref={heading} tabIndex={-1} className="mb-0">
        Game servers
      </h3>
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
          <Loadable pending skeleton={<ServersSkeleton />}>
            {null}
          </Loadable>
        )
      ) : servers.length === 0 ? (
        <p className="rounded-card border border-line bg-surface p-5 text-muted">
          {selfServeEnabled
            ? "No game servers yet. Add one with the Add your server button; each connects through the Satis Manager mod."
            : "No game servers yet. Adding servers is turned off on this backend: set SELF_SERVE_ENABLED to true to offer the Add your server button."}
        </p>
      ) : (
        <ul aria-labelledby="servers-heading" className="divide-y divide-line rounded-card border border-line bg-surface">
          {servers.map((server) => (
            <AgentServerRow key={server.id} server={server} onRename={open} onRemoved={close} />
          ))}
        </ul>
      )}
    </section>
  );
}
