import { useQuery } from "@tanstack/react-query";
import { queries } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";
import { useSelectedServer } from "../servers/ServerContext";
import { FactoryPanel } from "./FactoryPanel";

/** Container: polls factory through the query layer every 30 s (ADR-0005). */
export function FactoryView() {
  const server = useSelectedServer();
  const factory = useQuery(queries.factory(server.id));

  if (factory.isPending) return <p role="status">Loading factory…</p>;
  return (
    <>
      {factory.isError && <ErrorNotice error={factory.error} />}
      {factory.data && <FactoryPanel snapshot={factory.data} />}
    </>
  );
}
