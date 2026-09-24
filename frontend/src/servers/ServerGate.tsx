import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { classifyError } from "../api/errors";
import { queries } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";
import { ServerContext } from "./ServerContext";

/**
 * Server discovery (ADR-0001): auto-selects when there's exactly one server, otherwise
 * shows a picker. The selection lives in memory only; server ids aren't persisted.
 */
export function ServerGate({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const servers = useQuery(queries.servers());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Servers that answered server_not_found. Never auto-selected again, so rediscovery
  // returning the same list shows the picker instead of looping.
  const [lostIds, setLostIds] = useState<ReadonlySet<string>>(() => new Set());

  const list = servers.data?.servers ?? [];
  const current =
    list.find((s) => s.id === selectedId) ?? (list.length === 1 && !lostIds.has(list[0].id) ? list[0] : undefined);
  const currentId = current?.id;

  // Any query scoped to the current server that answers server_not_found (ADR-0003) drops
  // the selection and re-runs discovery. Views don't handle it themselves.
  useEffect(() => {
    if (!currentId) return;
    return client.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "error") return;
      const [root, id] = event.query.queryKey;
      if (root !== "servers" || id !== currentId) return;
      if (classifyError(event.action.error) !== "server_not_found") return;
      setLostIds((prev) => new Set(prev).add(currentId));
      setSelectedId(null);
      void client.invalidateQueries({ queryKey: queries.servers().queryKey, exact: true });
    });
  }, [client, currentId]);

  if (!servers.data) {
    if (servers.isError) {
      return (
        <ErrorNotice
          error={servers.error}
          action={
            <button type="button" onClick={() => void servers.refetch()}>
              Retry
            </button>
          }
        />
      );
    }
    return <p role="status">Finding game servers…</p>;
  }

  if (list.length === 0) return <p>No game servers are configured.</p>;

  // An explicit pick clears the id's lost mark: the operator is retrying it on purpose, and if
  // it's back, the "no longer available" note shouldn't linger for the rest of the page.
  const pick = (id: string) => {
    setSelectedId(id);
    setLostIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  if (!current) {
    return (
      <section aria-labelledby="picker-heading">
        <h2 id="picker-heading">Choose a game server</h2>
        {lostIds.size > 0 && <p role="alert">The selected server is no longer available.</p>}
        <ul>
          {list.map((server) => (
            <li key={server.id}>
              <button type="button" onClick={() => pick(server.id)}>
                {server.displayName}
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <ServerContext value={current}>
      <div className="server-bar">
        <h2>{current.displayName}</h2>
        {list.length > 1 && (
          <button type="button" onClick={() => setSelectedId(null)}>
            Change server
          </button>
        )}
      </div>
      {children}
    </ServerContext>
  );
}
