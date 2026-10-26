import { useQuery } from "@tanstack/react-query";
import { useDeployGapPhase } from "../api/deployGap";
import { useBasicData } from "../api/basicData";
import { queries } from "../api/queries";
import { isFirstLoad } from "../api/settled";
import { useSelectedServer } from "../servers/ServerContext";
import { useDismissedWarning } from "./dismissal";
import {
  canDismiss,
  factoryHealth,
  overallHealth,
  powerHealth,
  serverHealth,
  tickState,
  warningKey,
} from "./health";
import { failedOrPending, stateOf } from "./sectionState";
import type { Tick } from "./cards/HealthCard";
import type { PlayersState } from "./cards/PlayersCard";
import { powerTotals, type PowerState } from "./cards/power";
import { Loadable } from "../ui/Skeleton";
import { OverviewPanel, type OverviewSection } from "./OverviewPanel";
import { OverviewSkeleton } from "./OverviewSkeleton";

/**
 * Container: reads the same query keys as the section pages, so the Overview adds no
 * requests the pages wouldn't make, and a future push path (ADR-0014) fills both.
 */
export function OverviewView() {
  const server = useSelectedServer();
  const phase = useDeployGapPhase();
  const status = useQuery(queries.status(server.id));
  // Same rule as the rows: data wins over an error.
  const players: PlayersState = status.data ? { status: status.data.data } : failedOrPending(status, phase);
  // The Health card's tick (the owner's call): the backend's own tickHealth, nothing re-derived.
  const snapshot = status.data?.data;
  const tick: Tick | undefined = snapshot
    ? snapshot.isGameRunning
      ? { rate: snapshot.tickRate, health: snapshot.tickHealth }
      : null
    : undefined;
  const age = status.data ? { observedAt: status.data.observedAt, late: status.data.stale } : undefined;
  // Names are extra: loading, failing, or a backend without the endpoint all leave the counts.
  const roster = useQuery(queries.players(server.id)).data;
  // The Server tile links to the Servers page only for whom the shell shows it (ADR-0030); same cache.
  const canManageServers = useQuery(queries.servers()).data?.canManageServers === true;
  const power = useQuery(queries.power(server.id));
  const factory = useQuery(queries.factory(server.id));
  // A server with only the game's own API data (ADR-0057): the Server row alone, and no Power card.
  const basic = useBasicData();
  const serverSection: OverviewSection = {
    name: "Server",
    station: "server",
    to: canManageServers ? "/app/servers" : undefined,
    state: stateOf(status, phase, serverHealth),
  };
  const sections: OverviewSection[] = basic
    ? [serverSection]
    : [
        serverSection,
        { name: "Power", station: "power", to: "/app/power", state: stateOf(power, phase, powerHealth) },
        { name: "Factory", station: "factory", to: "/app/factory", state: stateOf(factory, phase, factoryHealth) },
      ];
  // Same rule as the rows: data wins over an error.
  const powerState: PowerState = power.data ? powerTotals(power.data.data.circuits) : failedOrPending(power, phase);
  // The tick has no row (it's in the Health card), but a slow one still makes the overall
  // health a warning, and a dismissed warning comes back when it starts. Loading and errors are
  // already counted by the Server row, so the tick only joins once there's a snapshot.
  const inputs = status.data ? [...sections, { name: "Tick", state: tickState(status.data) }] : sections;
  const overall = overallHealth(inputs.map((s) => s.state));
  const dismissible = canDismiss(overall.health);
  const dismissal = useDismissedWarning(server.id, warningKey(inputs), overall.health === "ok");
  return (
    // The cards each have a loading state of their own, none of them the size of the loaded card, so
    // the page holds one skeleton until all three reads are in (#494).
    <Loadable
      pending={isFirstLoad(status) || isFirstLoad(power) || isFirstLoad(factory)}
      skeleton={<OverviewSkeleton />}
    >
      <OverviewPanel
        overall={overall}
        sections={sections}
        players={players}
        tick={tick}
        age={age}
        unreachable={status.data?.unreachableSince !== undefined}
        power={basic ? undefined : powerState}
        basicData={basic}
        roster={roster}
        bannerHidden={dismissible && dismissal.hidden}
        onDismiss={dismissible ? dismissal.dismiss : undefined}
      />
    </Loadable>
  );
}
