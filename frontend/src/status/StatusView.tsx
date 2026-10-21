import { useQuery } from "@tanstack/react-query";
import { queries } from "../api/queries";
import { isFirstLoad } from "../api/settled";
import { useSelectedServer } from "../servers/ServerContext";
import { Loadable, Skeleton, SkeletonStatus } from "../ui/Skeleton";
import { StatusPanel } from "./StatusPanel";

/** The status panel while it loads: a panel-sized block (#494). */
function StatusSkeleton() {
  return (
    <>
      <SkeletonStatus>Loading server status…</SkeletonStatus>
      <Skeleton className="h-45 rounded-card" />
    </>
  );
}

/**
 * Container: reads status only through the query layer, so a future push path can fill the
 * same cache key without touching this view. Errors are StatusBanners' job.
 */
export function StatusView() {
  const server = useSelectedServer();
  const status = useQuery(queries.status(server.id));
  return (
    // Nothing at all on an error (empty:hidden): StatusBanners say so, and an empty box would add a gap.
    <Loadable pending={isFirstLoad(status)}skeleton={<StatusSkeleton />} className="empty:hidden">
      {status.data ? <StatusPanel snapshot={status.data} refetchFailed={status.isRefetchError} /> : null}
    </Loadable>
  );
}
