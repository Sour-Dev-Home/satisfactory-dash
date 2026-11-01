import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router";
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

/** The query parameter that names the opened factory (or site); repeated, root first, for a path (ADR-0061 Decision 4). */
export const OPEN_PARAM = "open";

/** How a path change reaches the address: `go` (open, Back, a breadcrumb) or `trim` (a bad tail dropped, replacing it). */
export type PathChange = "go" | "trim";

const sameStart = (short: readonly string[], long: readonly string[]) => short.every((k, i) => long[i] === k);

/** The address for a path, keeping the other parameters (dev:mock's scenario) and the fragment, as on the Factory page. */
function openSearch(params: URLSearchParams, path: readonly string[]): string {
  const next = new URLSearchParams(params);
  next.delete(OPEN_PARAM);
  for (const key of path) next.append(OPEN_PARAM, key);
  return next.size > 0 ? `?${next}` : "";
}

/**
 * The opened path, kept in the address (the owner, 2026-10-27: going one level up should be easy; ADR-0061 Decision 4:
 * `?open=a&open=b`, so a #776 link with one `open` is a path of one). Opening one level down is a history entry, so the
 * browser's Back, a mouse's back button, Alt+Left or a phone's back swipe return one level up. Going one level up steps
 * back through that entry when this page made it; a link straight to a factory has none, so it replaces the address
 * instead of leaving the page. A breadcrumb jump further up is a plain entry. A trim replaces the address and marks that
 * entry, so the page says so until the viewer goes somewhere else.
 */
function useOpenPath(): [string[], (next: readonly string[], how?: PathChange) => void, boolean] {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const path = params.getAll(OPEN_PARAM);
  const state = location.state as { plannerOpened?: boolean; plannerTrimmed?: boolean } | null;
  const pushedHere = state?.plannerOpened === true;
  const trimmed = state?.plannerTrimmed === true;
  const go = (next: readonly string[], how: PathChange = "go") => {
    const up = next.length === path.length - 1 && sameStart(next, path);
    const down = next.length === path.length + 1 && sameStart(path, next);
    if (how === "go" && up && pushedHere) {
      void navigate(-1);
      return;
    }
    const to = { search: openSearch(params, next), hash: location.hash };
    if (how === "trim") void navigate(to, { replace: true, state: { plannerTrimmed: true } });
    else if (up) void navigate(to, { replace: true });
    else void navigate(to, down ? { state: { plannerOpened: true } } : undefined);
  };
  return [path, go, trimmed];
}

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
  // A site's key is its position, so it holds across polls; a key that goes away is trimmed off the path, with a note.
  const [path, setPath, trimmed] = useOpenPath();
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
              path={path}
              onPath={setPath}
              trimmed={trimmed}
              // A parent with no machines of its own is known only from the list: no trimming until it has answered.
              pathSettled={!designations.isPending}
            />
          </DesignationChangeContext.Provider>
        </DesignationContext.Provider>
      ) : (
        error != null && <PanelError error={error} title="Production planner" />
      )}
    </Loadable>
  );
}
