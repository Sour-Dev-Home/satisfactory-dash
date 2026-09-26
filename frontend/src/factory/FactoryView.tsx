import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { queries } from "../api/queries";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { ErrorNotice } from "../components/ErrorNotice";
import { useSelectedServer } from "../servers/ServerContext";
import { ItemHistorySection, SinceYesterdayView } from "./FactoryHistory";
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

  if (factory.isPending) return <p role="status">Loading factory…</p>;
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
