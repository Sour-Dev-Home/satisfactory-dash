import { useQuery } from "@tanstack/react-query";
import { queries } from "../api/queries";
import { useSelectedServer } from "../servers/ServerContext";
import { StatusPanel } from "./StatusPanel";

/**
 * Container: reads status only through the query layer, so a future push path can fill the
 * same cache key without touching this view. Loading and errors are StatusBanners' job.
 */
export function StatusView() {
  const server = useSelectedServer();
  const status = useQuery(queries.status(server.id));
  return status.data ? <StatusPanel snapshot={status.data} /> : null;
}
