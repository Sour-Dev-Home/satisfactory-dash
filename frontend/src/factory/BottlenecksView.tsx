import { BOTTLENECKS_DEFAULT_LIMIT } from "@satisfactory-dash/shared";
import { PanelError } from "../components/PanelError";
import { useHashTarget } from "../lib/useHashTarget";
import { Loadable } from "../ui/Skeleton";
import { BottlenecksPanel, BottlenecksSkeleton } from "./BottlenecksPanel";
import { isBottlenecksAnchor, useBottlenecks } from "./bottlenecksRead";

/**
 * Container for the Factory page's "Bottlenecks" section (ADR-0048, #349): the top 10, polled with the factory. It
 * is not one of the page's primary reads (shell/pageQueries.ts), so the page never waits for it, and a failed or
 * unsupported read (an older backend's 404) shows in this section only. A link to #bottlenecks (the summary's, or
 * the Planner's #bottlenecks-heading) jumps here once the list is on screen.
 */
export function BottlenecksView() {
  const { query, firstLoad, error } = useBottlenecks();
  useHashTarget(isBottlenecksAnchor);
  return (
    <Loadable pending={firstLoad} skeleton={<BottlenecksSkeleton />}>
      {query.data ? (
        <BottlenecksPanel data={query.data.data} limit={BOTTLENECKS_DEFAULT_LIMIT} />
      ) : (
        error != null && <PanelError error={error} title="Bottlenecks" />
      )}
    </Loadable>
  );
}
