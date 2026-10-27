import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BOTTLENECKS_DEFAULT_LIMIT } from "@satisfactory-dash/shared";
import { usePlannerDesignationWrites } from "../api/plannerWrites";
import { queries } from "../api/queries";
import { useSettledQuery } from "../api/settled";
import { PanelError } from "../components/PanelError";
import { useSelectedServer } from "../servers/ServerContext";
import { Loadable } from "../ui/Skeleton";
import { DesignationChangeContext, useDesignationChangeRunner } from "./designationChanges";
import { DesignationContext, type DesignationState } from "./DesignationContext";
import { missingMembers, placesOf } from "./designationMatch";
import { canDesignate } from "./designationText";
import { PlannerPanel, PlannerSkeleton } from "./PlannerPanel";

/**
 * Container for the Planner page (ADR-0050, text form): the production graph, polled with the factory, plus the Factory
 * page's own bottlenecks read (same cache entry, so it is not fetched twice) for the per-site counts. The bottlenecks
 * read is optional: while it has not answered, or failed, the counts are left out and the page still works.
 *
 * ADR-0055 Decision 5: the designations (every member reads them), the Factory read for where the machines stand, and the
 * designation writes for an owner or admin (the server's `role` is a UX hint; the backend's guard is the control). Each
 * read is optional: without one, the matching parts of the page are left out and the rest works.
 */
export function PlannerView() {
  const server = useSelectedServer();
  const { query, firstLoad, error } = useSettledQuery(queries.productionGraph(server.id));
  const bottlenecks = useQuery(queries.bottlenecks(server.id, BOTTLENECKS_DEFAULT_LIMIT));
  const designations = useQuery(queries.plannerDesignations(server.id));
  const factory = useQuery(queries.factory(server.id));
  const writes = usePlannerDesignationWrites(server.id);
  const buildings = factory.data?.data.buildings;
  const places = useMemo(() => (buildings === undefined ? undefined : placesOf(buildings)), [buildings]);
  const list = designations.data?.designations;
  const missing = useMemo(() => (list === undefined || places === undefined ? undefined : missingMembers(list, places)), [list, places]);
  const state = useMemo<DesignationState>(
    () => ({ canWrite: canDesignate(server.role), designations: designations.data, places, missing, writes }),
    [server.role, designations.data, places, missing, writes],
  );
  // ADR-0055 Decision 12: merge, split, pop-out, dissolve and their undo, for the roles that may write.
  const changes = useDesignationChangeRunner(canDesignate(server.role) ? writes.replace.mutateAsync : null);
  // A site's key is its position, so it holds across polls; a site that goes away falls back to the overview.
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <Loadable pending={firstLoad} skeleton={<PlannerSkeleton />}>
      {query.data ? (
        <DesignationContext.Provider value={state}>
          <DesignationChangeContext.Provider value={changes}>
            <PlannerPanel
              snapshot={query.data}
              findings={bottlenecks.data?.data.findings}
              findingsTruncated={bottlenecks.data?.data.truncated === true}
              refetchFailed={query.isRefetchError}
              selected={selected}
              onSelect={setSelected}
            />
          </DesignationChangeContext.Provider>
        </DesignationContext.Provider>
      ) : (
        error != null && <PanelError error={error} title="Production planner" />
      )}
    </Loadable>
  );
}
