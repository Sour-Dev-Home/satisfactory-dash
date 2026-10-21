import { queries } from "../api/queries";
import { useSettledQuery } from "../api/settled";
import { PanelError } from "../components/PanelError";
import { useSelectedServer } from "../servers/ServerContext";
import { Loadable, PanelSkeleton, Skeleton } from "../ui/Skeleton";
import { PowerPanel } from "./PowerPanel";

/** The Power panel while it loads: one circuit's card and the "Updated" line under it. */
function PowerSkeleton() {
  return (
    <PanelSkeleton label="Loading power…" rows={1} rowClass="h-38 sm:h-25">
      <Skeleton className="h-lh w-28" />
    </PanelSkeleton>
  );
}

/** Container: polls power through the query layer (ADR-0005) and shows its own load/error. */
export function PowerView() {
  const server = useSelectedServer();
  const { query: power, firstLoad, error } = useSettledQuery(queries.power(server.id));

  return (
    <Loadable pending={firstLoad} skeleton={<PowerSkeleton />} className="grid gap-3">
      {error != null && <PanelError error={error} title="Power" hasData={power.data !== undefined} />}
      {power.data && <PowerPanel snapshot={power.data} refetchFailed={power.isRefetchError} />}
    </Loadable>
  );
}
