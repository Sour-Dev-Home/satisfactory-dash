import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { queries } from "../api/queries";
import { useSelectedServer } from "../servers/ServerContext";
import { factoryHealth, overallHealth, powerHealth, serverHealth, type SectionHealth, type SectionState } from "./health";
import { OverviewPanel } from "./OverviewPanel";

/** Data wins over an error: a failed background refetch keeps showing the last snapshot. */
function stateOf<T>(query: UseQueryResult<T>, health: (snapshot: T) => SectionHealth): SectionState {
  if (query.data) return health(query.data);
  return query.isError ? "error" : "pending";
}

/**
 * Container: reads the same query keys as the section pages, so the Overview adds no
 * requests the pages wouldn't make, and a future push path (ADR-0014) fills both.
 */
export function OverviewView() {
  const server = useSelectedServer();
  const sections = [
    { name: "Server", state: stateOf(useQuery(queries.status(server.id)), serverHealth) },
    { name: "Power", to: "/app/power", state: stateOf(useQuery(queries.power(server.id)), powerHealth) },
    { name: "Factory", to: "/app/factory", state: stateOf(useQuery(queries.factory(server.id)), factoryHealth) },
  ];
  return <OverviewPanel overall={overallHealth(sections.map((s) => s.state))} sections={sections} />;
}
