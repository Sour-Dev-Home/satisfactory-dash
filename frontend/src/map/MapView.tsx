import { useQuery } from "@tanstack/react-query";
import { queries } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";
import { useSelectedServer } from "../servers/ServerContext";
import { MapPanel } from "./MapPanel";

/** Container: the map reuses the factory query (ADR-0023 decision 1: no new endpoint). */
export function MapView() {
  const server = useSelectedServer();
  const factory = useQuery(queries.factory(server.id));

  if (factory.isPending) return <p role="status">Loading the map…</p>;
  return (
    <>
      {factory.isError && <ErrorNotice error={factory.error} />}
      {factory.data && <MapPanel snapshot={factory.data} />}
    </>
  );
}
