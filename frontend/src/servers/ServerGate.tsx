import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { classifyError } from "../api/errors";
import { queries } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";
import { DeleteAccountPanel } from "../account/DeleteAccountPanel";
import { AccountMenu } from "../auth/AccountMenu";
import { AddServer } from "../selfServe/AddServer";
import { ServerManagementView } from "../serverManagement/ServerManagementView";
import { LeftStatus } from "./LeftStatus";
import { ServerContext, ServerSwitchContext } from "./ServerContext";

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

  // "Change server" lives in the shell, which the picker replaces, so focus would fall to
  // <body>. Move it to the picker's heading instead.
  const changeRequested = useRef(false);
  const pickerHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!changeRequested.current) return;
    changeRequested.current = false;
    // Landed on a server anyway (one left after leaving, ADR-0047): LeftStatus in the shell takes focus instead.
    if (!currentId) pickerHeading.current?.focus();
  }, [currentId]);
  // The server just left (ADR-0047), for "You left {name}." wherever the gate lands next.
  const [leftName, setLeftName] = useState<string | null>(null);
  const clearLeft = useCallback(() => setLeftName(null), []);

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

  // An explicit pick clears the id's lost mark: the operator is retrying it on purpose, and if
  // it's back, the "no longer available" note shouldn't linger for the rest of the page.
  const pick = (id: string) => {
    setSelectedId(id);
    setLeftName(null);
    setLostIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  if (list.length === 0) {
    // The operator can add the first one here (ADR-0030). Stored servers the backend can't serve
    // (unreadable, refused) aren't in this list, so the management list is where they show.
    if (servers.data.canManageServers) {
      return (
        <div className="mx-auto mt-6 grid w-full max-w-3xl gap-4">
          <h2 className="mb-0">Set up a game server</h2>
          <ServerManagementView />
        </div>
      );
    }
    // ADR-0046: a player with no server yet can add their own while self-serve is on.
    if (servers.data.selfServeEnabled) {
      return (
        <div className="mx-auto mt-6 grid w-full max-w-md gap-4">
          {/* No shell (and so no top bar) here: a signed-in player can always sign out. */}
          <div className="flex justify-end">
            <AccountMenu />
          </div>
          {leftName !== null && <LeftStatus name={leftName} focus />}
          <section className="grid gap-4 rounded-card border border-line bg-surface p-6">
            <AddServer first onCreated={pick} />
          </section>
          {/* ADR-0047: Settings needs a server, so someone who has left (or never had) one deletes their account here. */}
          <DeleteAccountPanel />
        </div>
      );
    }
    return (
      <div className="mx-auto mt-6 grid w-full max-w-md gap-4">
        <div className="flex justify-end">
          <AccountMenu />
        </div>
        {leftName !== null && <LeftStatus name={leftName} focus />}
        <p>No game servers are configured.</p>
        <DeleteAccountPanel />
      </div>
    );
  }

  if (!current) {
    return (
      <section
        aria-labelledby="picker-heading"
        className="mx-auto mt-6 grid w-full max-w-md gap-4 rounded-card border border-line bg-surface p-6"
      >
        <h2 id="picker-heading" ref={pickerHeading} tabIndex={-1}>
          Choose a game server
        </h2>
        {lostIds.size > 0 && <p role="alert">The selected server is no longer available.</p>}
        {/* The heading takes focus here (the picker replaced the page); the status is still read out. */}
        {leftName !== null && <LeftStatus name={leftName} />}
        <ul className="grid gap-2 [&_button]:w-full [&_button]:text-left">
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
      {/* The name and "Change server" render in the shell's top bar (ServerSwitcher). */}
      <ServerSwitchContext
        value={{
          serverCount: list.length,
          select: pick,
          change: () => {
            changeRequested.current = true;
            setSelectedId(null);
            setLeftName(null);
          },
          left: (serverName) => {
            changeRequested.current = true;
            setSelectedId(null);
            setLeftName(serverName);
          },
          leftName,
          clearLeft,
        }}
      >
        {children}
      </ServerSwitchContext>
    </ServerContext>
  );
}
