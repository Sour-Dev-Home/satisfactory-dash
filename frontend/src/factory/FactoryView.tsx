import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queries } from "../api/queries";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { ErrorNotice } from "../components/ErrorNotice";
import { useSelectedServer } from "../servers/ServerContext";
import { ItemHistorySection, SinceYesterdayView, sinceYesterdayQueries } from "./FactoryHistory";
import { FactoryPanel } from "./FactoryPanel";
import { itemLabels } from "./itemLabels";

/**
 * How long the page may wait for "Since yesterday", counted from the tab opening or a server
 * switch, so the factory table is never held back longer than this (ADR-0032: at most 300 ms).
 */
export const REVEAL_GRACE_MS = 300;

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
  // One reveal (ADR-0032), but the live table never waits on history: "Since yesterday" reserves
  // its box, so it can fill in later without moving the table. The page shows once the factory has
  // landed and "Since yesterday" has too, or REVEAL_GRACE_MS have passed. Same keys, no extra fetch.
  const since = sinceYesterdayQueries(server.id);
  const sinceHistory = useQuery(since.history);
  const sinceTransitions = useQuery(since.transitions);
  const [graceOverFor, setGraceOverFor] = useState<string>();
  useEffect(() => {
    const timer = setTimeout(() => setGraceOverFor(server.id), REVEAL_GRACE_MS);
    return () => clearTimeout(timer);
  }, [server.id]);
  // The grace is only for a page that had to load the factory anyway. When the factory is already
  // cached (a tab switch), the page shows at once: its box is reserved, and waiting would only
  // turn a still page into a late reveal.
  const [loadedFactoryFor, setLoadedFactoryFor] = useState<string>();
  if (factory.isPending && loadedFactoryFor !== server.id) setLoadedFactoryFor(server.id);
  // Once shown, the page stays shown for that server. A failed read goes back to pending when
  // "Since yesterday" mounts and retries it, which would otherwise hide the page and loop.
  const [revealedFor, setRevealedFor] = useState<string>();
  const sinceSettled = !sinceHistory.isPending && !sinceTransitions.isPending;
  const mayWait = loadedFactoryFor === server.id && graceOverFor !== server.id;
  const ready = !factory.isPending && (sinceSettled || !mayWait);
  if (ready && revealedFor !== server.id) setRevealedFor(server.id);

  if (factory.isPending || (!ready && revealedFor !== server.id)) {
    return <p role="status">Loading factory…</p>;
  }
  return (
    <>
      <ErrorBoundary label="Since yesterday">
        <SinceYesterdayView labels={labels} />
      </ErrorBoundary>
      {factory.isError && <ErrorNotice error={factory.error} />}
      {factory.data && <FactoryPanel snapshot={factory.data} refetchFailed={factory.isRefetchError} />}
      <ErrorBoundary label="Production history">
        <ItemHistorySection labels={labels} />
      </ErrorBoundary>
    </>
  );
}
