import { useQuery } from "@tanstack/react-query";
import { queries } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";
import { useSelectedServer } from "../servers/ServerContext";
import { Loadable, PanelSkeleton } from "../ui/Skeleton";
import { MapCanvasSkeleton, MapPanel } from "./MapPanel";

/** The map panel while the factory loads: its heading, its layer row and the canvas's own box. */
function MapSkeleton() {
  return (
    <PanelSkeleton label="Loading the map…" rows={1} rowClass="h-touch">
      <MapCanvasSkeleton announce={false} />
    </PanelSkeleton>
  );
}

/** Container: the buildings reuse the factory query (ADR-0023 decision 1); MapPanel reads the world layers (ADR-0038) while they're on. */
export function MapView() {
  const server = useSelectedServer();
  const factory = useQuery(queries.factory(server.id));

  return (
    <Loadable pending={factory.isPending} skeleton={<MapSkeleton />} className="grid gap-3">
      {factory.isError && <ErrorNotice error={factory.error} />}
      {factory.data && <MapPanel snapshot={factory.data} serverId={server.id} />}
    </Loadable>
  );
}
