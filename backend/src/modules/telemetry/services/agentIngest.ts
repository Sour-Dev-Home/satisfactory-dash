import type { Cadence, Factory, SnapshotRequest } from "@satisfactory-dash/shared";
import { diffDecidedStates, sumItemRates } from "./factoryHistoryPoller.js";
import { sessionKey, type HistoryRecorder } from "./historyRecorder.js";
import type { MachineObservation, ObservationSink } from "./observationBoard.js";
import type { PowerHistoryStore, PowerSampleCircuit } from "./powerHistoryStore.js";
import type { LatestSnapshotStore } from "./agentSnapshotStore.js";

/**
 * ADR-0031 PR 5a: what the backend does with one snapshot from an edge agent, so a server reached through an agent feeds
 * exactly what a polled server feeds: the alert engine's observation board, the durable history, the power chart's
 * memory and the live reads' latest-snapshot store. The agent has already classified what it read (a snapshot carries
 * the shared Status, Power and Factory shapes, with each building's `state`), so nothing here calls a game server.
 *
 * Trust: the agent is the server's own, but its clock is not. `observedAt` is used only when it is within a minute of
 * the time the snapshot arrived; otherwise the arrival time stands, so a wrong clock cannot back-date history or make old
 * data look fresh. Bodies are never logged (player names, ADR-0029).
 */
export interface AgentSnapshotSink {
  ingest(snapshot: SnapshotRequest, receivedAtMs: number): void;
}

/** How far an agent's own clock may differ from the backend's before its `observedAt` is ignored. */
export const AGENT_CLOCK_TOLERANCE_MS = 60_000;

export interface AgentIngestDeps {
  store: LatestSnapshotStore;
  cadence: () => Cadence;
  observations: ObservationSink;
  history: HistoryRecorder;
  powerStore: PowerHistoryStore;
}

/** The highest finite percent across a machine's outputs (the classifier's own rule), or undefined. */
function bestPercent(building: Factory["buildings"][number]): number | undefined {
  const percents = building.production.map((rate) => rate.percent).filter(Number.isFinite);
  return percents.length === 0 ? undefined : Math.max(...percents);
}

/** For an underfed machine: the ingredient it consumes least (lowest percent), by class name; undefined without data. */
function lowestIngredient(building: Factory["buildings"][number]): string | undefined {
  const usable = (building.ingredients ?? []).filter((rate) => Number.isFinite(rate.percent));
  if (usable.length === 0) return undefined;
  return usable.reduce((lowest, rate) => (rate.percent < lowest.percent ? rate : lowest)).className;
}

export class AgentIngest implements AgentSnapshotSink {
  private readonly knownStates = new Map<string, string>();
  /** A paused snapshot was seen since the last factory reading: the next running one is the first after a resume. */
  private wasPaused = false;
  private lastSession: string | undefined;
  private lastGameDuration: number | undefined;

  constructor(private readonly deps: AgentIngestDeps) {}

  ingest(snapshot: SnapshotRequest, receivedAtMs: number): void {
    const { store, observations, history, powerStore } = this.deps;
    const cadence = this.deps.cadence();
    const agentMs = Date.parse(snapshot.observedAt);
    const observedAtMs = Number.isFinite(agentMs) && Math.abs(agentMs - receivedAtMs) <= AGENT_CLOCK_TOLERANCE_MS ? agentMs : receivedAtMs;

    if (!snapshot.reachable) {
      observations.recordPollFailure(receivedAtMs); // the alert engine's "server unreachable" reads this
      store.record({ reachable: false, observedAtMs, receivedAtMs });
      return;
    }
    store.record({
      reachable: true,
      observedAtMs,
      receivedAtMs,
      status: snapshot.status,
      power: snapshot.power,
      factory: snapshot.factory,
      players: snapshot.players,
    });
    observations.recordPollSuccess(receivedAtMs);

    // Unknown (null, and no status to say) is never treated as running: nothing is recorded, as for a poll that cannot read the pause state.
    const paused = snapshot.paused ?? snapshot.status?.gamePaused ?? null;
    if (paused === true) this.wasPaused = true;

    const { status, power, factory } = snapshot;
    if (status !== undefined) {
      observations.publishStatus({ observedAt: observedAtMs, intervalMs: cadence.statusSeconds * 1000, paused: paused ?? status.gamePaused, session: status.sessionName });
      if (
        this.lastSession !== undefined &&
        (status.sessionName !== this.lastSession || status.totalGameDurationSeconds < (this.lastGameDuration ?? 0))
      ) {
        powerStore.reset(); // a series must never span a new session or the game clock going backwards (ADR-0006)
      }
      this.lastSession = status.sessionName;
      this.lastGameDuration = status.totalGameDurationSeconds;
    }
    if (power !== undefined) {
      observations.publishPower({
        observedAt: observedAtMs,
        intervalMs: cadence.powerSeconds * 1000,
        circuits: power.circuits.map((circuit) => ({ circuit: circuit.circuitGroupId, status: circuit.status, fuseTripped: circuit.fuseTriggered })),
      });
      const intervalMs = cadence.powerSeconds * 1000;
      const circuits: PowerSampleCircuit[] = power.circuits.map((circuit) => ({
        circuitGroupId: circuit.circuitGroupId,
        productionMW: circuit.productionMW,
        consumptionMW: circuit.consumptionMW,
        capacityMW: circuit.capacityMW,
        batteryPercent: circuit.batteryPercent,
        fuseTriggered: circuit.fuseTriggered,
      }));
      // One slot per interval: a second snapshot in the same slot is not newer and is ignored by the store.
      powerStore.append({ t: Math.floor(observedAtMs / intervalMs) * intervalMs, gamePaused: paused === true, circuits });
      if (paused === false && this.lastSession !== undefined) {
        const session = sessionKey(this.lastSession);
        history.recordPower(
          circuits.map((circuit) => ({
            session,
            circuit: circuit.circuitGroupId,
            atMs: observedAtMs,
            productionMW: circuit.productionMW,
            consumptionMW: circuit.consumptionMW,
            capacityMW: circuit.capacityMW,
            batteryPercent: circuit.batteryPercent,
            fuseTripped: circuit.fuseTriggered,
          })),
        );
      }
    }
    if (factory !== undefined && paused === false) {
      const itemRows = sumItemRates(factory.buildings, observedAtMs);
      const machines: MachineObservation[] = factory.buildings.map((building) => {
        const missingInput = building.state === "underfed" ? lowestIngredient(building) : undefined;
        return {
          id: building.id,
          className: building.className,
          recipe: building.recipe,
          state: building.state,
          outputPercent: bestPercent(building),
          ...(missingInput !== undefined ? { missingInput } : {}),
        };
      });
      observations.publishFactory({
        observedAt: observedAtMs,
        intervalMs: cadence.factorySeconds * 1000,
        afterResume: this.wasPaused,
        itemRates: new Map(itemRows.map((row) => [row.item, row.currentPerMinute])),
        machines,
      });
      this.wasPaused = false;
      history.recordItems(itemRows);
      const decided = new Map<string, { state: string; className: string }>();
      for (const building of factory.buildings) {
        if (building.state !== undefined) decided.set(building.id, { state: building.state, className: building.className });
      }
      history.recordTransitions(diffDecidedStates(this.knownStates, decided, new Set(factory.buildings.map((building) => building.id)), observedAtMs));
    }
  }
}
