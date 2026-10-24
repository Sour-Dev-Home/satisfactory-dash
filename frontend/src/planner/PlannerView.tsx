import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BOTTLENECKS_DEFAULT_LIMIT } from "@satisfactory-dash/shared";
import { queries } from "../api/queries";
import { useSettledQuery } from "../api/settled";
import { PanelError } from "../components/PanelError";
import { useSelectedServer } from "../servers/ServerContext";
import { Loadable } from "../ui/Skeleton";
import { PlannerPanel, PlannerSkeleton } from "./PlannerPanel";

/**
 * Container for the Planner page (ADR-0050, text form): the production graph, polled with the factory, plus the Factory
 * page's own bottlenecks read (same cache entry, so it is not fetched twice) for the per-site counts. The bottlenecks
 * read is optional: while it has not answered, or failed, the counts are left out and the page still works.
 */
export function PlannerView() {
  const server = useSelectedServer();
  const { query, firstLoad, error } = useSettledQuery(queries.productionGraph(server.id));
  const bottlenecks = useQuery(queries.bottlenecks(server.id, BOTTLENECKS_DEFAULT_LIMIT));
  // A site's key is its position, so it holds across polls; a site that goes away falls back to the overview.
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <Loadable pending={firstLoad} skeleton={<PlannerSkeleton />}>
      {query.data ? (
        <PlannerPanel
          snapshot={query.data}
          findings={bottlenecks.data?.data.findings}
          findingsTruncated={bottlenecks.data?.data.truncated === true}
          refetchFailed={query.isRefetchError}
          selected={selected}
          onSelect={setSelected}
        />
      ) : (
        error != null && <PanelError error={error} title="Production planner" />
      )}
    </Loadable>
  );
}
