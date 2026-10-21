import { useQuery } from "@tanstack/react-query";
import { queries } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";
import { useSelectedServer } from "../servers/ServerContext";
import { Loadable, PanelSkeleton, Skeleton } from "../ui/Skeleton";
import { PowerPanel } from "./PowerPanel";

/** The Power panel while it loads: one circuit's card and the "Updated" line under it. */
function PowerSkeleton() {
  return (
    <PanelSkeleton label="Loading power…" rows={1} rowClass="h-24">
      <Skeleton className="h-lh w-28" />
    </PanelSkeleton>
  );
}

/** Container: polls power through the query layer (ADR-0005) and shows its own load/error. */
export function PowerView() {
  const server = useSelectedServer();
  const power = useQuery(queries.power(server.id));

  return (
    <Loadable pending={power.isPending} skeleton={<PowerSkeleton />} className="grid gap-3">
      {power.isError && <ErrorNotice error={power.error} />}
      {power.data && <PowerPanel snapshot={power.data} refetchFailed={power.isRefetchError} />}
    </Loadable>
  );
}
