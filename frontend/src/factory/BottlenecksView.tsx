import { BOTTLENECKS_DEFAULT_LIMIT } from "@satisfactory-dash/shared";
import { queries } from "../api/queries";
import { useSettledQuery } from "../api/settled";
import { PanelError } from "../components/PanelError";
import { useSelectedServer } from "../servers/ServerContext";
import { Loadable } from "../ui/Skeleton";
import { BottlenecksPanel, BottlenecksSkeleton } from "./BottlenecksPanel";

/**
 * Container for the Factory page's "Bottlenecks" section (ADR-0048, #349): the top 10, polled with the factory. It
 * is not one of the page's primary reads (shell/pageQueries.ts), so the page never waits for it, and a failed or
 * unsupported read (an older backend's 404) shows in this section only.
 */
export function BottlenecksView() {
  const server = useSelectedServer();
  const { query, firstLoad, error } = useSettledQuery(queries.bottlenecks(server.id, BOTTLENECKS_DEFAULT_LIMIT));
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
