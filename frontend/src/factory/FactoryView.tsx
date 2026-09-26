import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queries } from "../api/queries";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { ErrorNotice } from "../components/ErrorNotice";
import { useSelectedServer } from "../servers/ServerContext";
import { ItemHistorySection, SinceYesterdayView, sinceYesterdayQueries } from "./FactoryHistory";
import { FactoryPanel } from "./FactoryPanel";
import { itemLabels } from "./itemLabels";

/**
 * Container: polls factory through the query layer every 30 s (ADR-0005), with what changed since
 * yesterday above the table and the production history below it (ADR-0027). Each history part has
 * its own crash boundary, so a fault there leaves the table working.
 */
export function FactoryView() {
  const server = useSelectedServer();
  const factory = useQuery(queries.factory(server.id));
  // History carries only class names: names and units come from the live factory.
  const buildings = factory.data?.data.buildings;
  const labels = useMemo(() => itemLabels(buildings ?? []), [buildings]);
  // One reveal (ADR-0032): "Since yesterday" sits above the table, so the page waits for its two
  // queries as well. Otherwise each one landing pushes the table down. Same keys, no extra fetch.
  const since = sinceYesterdayQueries(server.id);
  const sinceHistory = useQuery(since.history);
  const sinceTransitions = useQuery(since.transitions);
  // Once shown, the page stays shown for that server. A failed read goes back to pending when
  // "Since yesterday" mounts and retries it, which would otherwise hide the page and loop.
  const [revealedFor, setRevealedFor] = useState<string>();
  const settled = !factory.isPending && !sinceHistory.isPending && !sinceTransitions.isPending;
  if (settled && revealedFor !== server.id) setRevealedFor(server.id);

  if (factory.isPending || (!settled && revealedFor !== server.id)) {
    return <p role="status">Loading factory…</p>;
  }
  return (
    <>
      <ErrorBoundary label="Since yesterday">
        <SinceYesterdayView labels={labels} />
      </ErrorBoundary>
      {factory.isError && <ErrorNotice error={factory.error} />}
      {factory.data && <FactoryPanel snapshot={factory.data} />}
      <ErrorBoundary label="Production history">
        <ItemHistorySection labels={labels} />
      </ErrorBoundary>
    </>
  );
}
