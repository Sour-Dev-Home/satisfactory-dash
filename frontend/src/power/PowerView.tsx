import { useQuery } from "@tanstack/react-query";
import { queries } from "../api/queries";
import { ErrorNotice } from "../components/ErrorNotice";
import { useSelectedServer } from "../servers/ServerContext";
import { PowerPanel } from "./PowerPanel";

/** Container: polls power through the query layer (ADR-0005) and shows its own load/error. */
export function PowerView() {
  const server = useSelectedServer();
  const power = useQuery(queries.power(server.id));

  if (power.isPending) return <p role="status">Loading power…</p>;
  return (
    <>
      {power.isError && <ErrorNotice error={power.error} />}
      {power.data && <PowerPanel snapshot={power.data} refetchFailed={power.isRefetchError} />}
    </>
  );
}
