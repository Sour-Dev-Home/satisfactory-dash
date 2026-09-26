import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { queries } from "../api/queries";
import { useSelectedServer } from "../servers/ServerContext";
import { useDismissedWarning } from "./dismissal";
import {
  canDismiss,
  factoryHealth,
  overallHealth,
  powerHealth,
  serverHealth,
  warningKey,
  type SectionHealth,
  type SectionState,
} from "./health";
import type { Tick } from "./cards/HealthCard";
import type { PlayersState } from "./cards/PlayersCard";
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
  const status = useQuery(queries.status(server.id));
  // Same rule as the rows: data wins over an error.
  const players: PlayersState = status.data ? { status: status.data.data } : status.isError ? "error" : "pending";
  // The Health card's tick (the owner's call): the backend's own tickHealth, nothing re-derived.
  const snapshot = status.data?.data;
  const tick: Tick | undefined = snapshot
    ? snapshot.isGameRunning
      ? { rate: snapshot.tickRate, health: snapshot.tickHealth }
      : null
    : undefined;
  // Names are extra: loading, failing, or a backend without the endpoint all leave the counts.
  const roster = useQuery(queries.players(server.id)).data;
  const sections = [
    { name: "Server", state: stateOf(status, serverHealth) },
    { name: "Power", to: "/app/power", state: stateOf(useQuery(queries.power(server.id)), powerHealth) },
    { name: "Factory", to: "/app/factory", state: stateOf(useQuery(queries.factory(server.id)), factoryHealth) },
  ];
  const overall = overallHealth(sections.map((s) => s.state));
  const dismissible = canDismiss(overall.health);
  const dismissal = useDismissedWarning(server.id, warningKey(sections), overall.health === "ok");
  return (
    <OverviewPanel
      overall={overall}
      sections={sections}
      players={players}
      tick={tick}
      roster={roster}
      bannerHidden={dismissible && dismissal.hidden}
      onDismiss={dismissible ? dismissal.dismiss : undefined}
    />
  );
}
