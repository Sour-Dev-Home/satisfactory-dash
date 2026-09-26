import type { ReactNode } from "react";
import { useInfiniteQuery, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { queries } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";
import { useSelectedServer } from "../servers/ServerContext";
import { AlertLogPanel, AlertStatusPanel, DestinationPanel } from "./AlertsPanels";

/**
 * The Alerts page (ADR-0027 PR 9), opened from the header bell. Each part loads and fails on its
 * own, so a broken log never hides what's firing.
 */
export function AlertsView() {
  const server = useSelectedServer();
  const status = useQuery(queries.alertStatus(server.id));
  const destinations = useQuery(queries.alertDestinations(server.id));
  // Only to name the item a production alert is about; the status shows without it.
  const rules = useQuery(queries.alertRules(server.id));
  return (
    <div className="grid gap-5">
      <Loaded query={status} loading="Loading alert status…">
        {(data) => <AlertStatusPanel status={data} rules={rules.data?.rules} />}
      </Loaded>
      <Loaded query={destinations} loading="Loading the Discord setup…">
        {(data) => <DestinationPanel destinations={data} />}
      </Loaded>
      <AlertLog serverId={server.id} />
    </div>
  );
}

function AlertLog({ serverId }: { serverId: string }) {
  const log = useInfiniteQuery(queries.alertEvents(serverId));
  if (log.isPending) return <p role="status">Loading the alert log…</p>;
  if (!log.data) return <Failed error={log.error} retry={() => void log.refetch()} />;
  return (
    <AlertLogPanel
      events={log.data.pages.flatMap((page) => page.events)}
      hasOlder={log.hasNextPage}
      loadingOlder={log.isFetchingNextPage}
      onOlder={() => void log.fetchNextPage()}
    />
  );
}

function Loaded<T>({ query, loading, children }: { query: UseQueryResult<T>; loading: string; children: (data: T) => ReactNode }) {
  if (query.isPending) return <p role="status">{loading}</p>;
  if (!query.data) return <Failed error={query.error} retry={() => void query.refetch()} />;
  return children(query.data);
}

function Failed({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <ErrorNotice
      error={error}
      action={
        <button type="button" onClick={retry}>
          Retry
        </button>
      }
    />
  );
}
