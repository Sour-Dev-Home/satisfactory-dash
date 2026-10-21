import { queries } from "../api/queries";
import { useSettledQuery } from "../api/settled";
import { PanelError } from "../components/PanelError";
import { useSelectedServer } from "../servers/ServerContext";
import { Loadable, PanelSkeleton, Skeleton } from "../ui/Skeleton";
import { MapCanvasSkeleton, MapPanel } from "./MapPanel";

/** The map panel while the factory loads: its heading, its layer row and the canvas's own box. */
function MapSkeleton() {
  return (
    <PanelSkeleton label="Loading the map…" rows={1} rowClass="h-touch">
      <MapCanvasSkeleton announce={false} />
      {/* The legends, notes and tables under the map: about this tall once they arrive. */}
      <Skeleton className="h-48" />
    </PanelSkeleton>
  );
}

/** Container: the buildings reuse the factory query (ADR-0023 decision 1); MapPanel reads the world layers (ADR-0038) while they're on. */
export function MapView() {
  const server = useSelectedServer();
  const { query: factory, firstLoad, error } = useSettledQuery(queries.factory(server.id));

  return (
    <Loadable pending={firstLoad} skeleton={<MapSkeleton />} className="grid gap-3">
      {error != null && <PanelError error={error} title="Factory map" hasData={factory.data !== undefined} />}
      {factory.data && <MapPanel snapshot={factory.data} serverId={server.id} />}
    </Loadable>
  );
}
