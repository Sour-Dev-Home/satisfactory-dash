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
  const [renaming, setRenaming] = useState<AgentServer | null>(null);
  const [notice, setNotice] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  // Opening or closing the form replaces what had focus: land on the heading of what's shown.
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    const target = renaming ? document.querySelector<HTMLElement>("#server-form-anchor h3") : heading.current;
    target?.setAttribute("tabindex", "-1");
    target?.focus();
  }, [renaming]);

  const open = (server: AgentServer) => {
    moved.current = true;
    setNotice("");
    setRenaming(server);
  };
  const close = (message: string) => {
    moved.current = true;
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
          No game servers yet. Servers added with Add your server show here; each connects through the Satis Manager mod.
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
