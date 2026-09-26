/**
 * ADR-0027 decision 4 (alerts): what the pollers last saw, kept in memory per server so the alert evaluator can
 * read it without calling the game server or the database. Each reading carries its own `observedAt`; a reading older
 * than twice its poller's interval is stale, and the evaluator treats a stale reading as UNKNOWN (it holds each
 * subject's last condition, never a guess). After a restart the board is empty, and everything holds until fresh data
 * arrives. One process only: a second backend instance would need a leader lock (pg advisory) first.
 */

export interface PowerCircuitObservation {
  circuit: number;
  /** The dashboard's own status for the circuit (classifyPowerCircuit), so alerts and dashboard agree. */
  status: "ok" | "at_risk" | "outage";
  fuseTripped: boolean;
}

export interface MachineObservation {
  id: string;
  className: string;
  /** What the machine makes: its recipe name, or null when none is set. */
  recipe: string | null;
  /** The backend-derived state (classifyBuilding), undefined when the data to decide is missing. */
  state: string | undefined;
  /** The best averaged output percent (the classifier's own input), undefined when there is none. */
  outputPercent: number | undefined;
  /** For an `underfed` machine: the ingredient it consumes least (classifyBuilding's `missingInput`), a class name. */
  missingInput?: string;
}

export interface ObservationSnapshot {
  /** The game session's name at the last successful status poll. */
  session: string | undefined;
  status: { observedAt: number; intervalMs: number; paused: boolean } | undefined;
  power: { observedAt: number; intervalMs: number; circuits: PowerCircuitObservation[] } | undefined;
  factory:
    | {
        observedAt: number;
        intervalMs: number;
        /** true = the FIRST snapshot after a pause: FRM values may still be frozen, so it counts as unknown. */
        afterResume: boolean;
        machines: MachineObservation[];
      }
    | undefined;
  /** Health of the status/power poll: how the server looks from here. */
  polls: { consecutiveFailures: number; firstFailureAt: number | undefined; lastSuccessAt: number | undefined };
}

/** What the pollers write to; a no-op when there is no database (alerts need one). */
export interface ObservationSink {
  publishStatus(input: { observedAt: number; intervalMs: number; paused: boolean; session: string }): void;
  publishPower(input: { observedAt: number; intervalMs: number; circuits: PowerCircuitObservation[] }): void;
  publishFactory(input: { observedAt: number; intervalMs: number; afterResume: boolean; machines: MachineObservation[] }): void;
  recordPollFailure(at: number): void;
  recordPollSuccess(at: number): void;
}

export class ObservationBoard implements ObservationSink {
  private session: string | undefined;
  private status: ObservationSnapshot["status"];
  private power: ObservationSnapshot["power"];
  private factory: ObservationSnapshot["factory"];
  private consecutiveFailures = 0;
  private firstFailureAt: number | undefined;
  private lastSuccessAt: number | undefined;

  publishStatus(input: { observedAt: number; intervalMs: number; paused: boolean; session: string }): void {
    this.session = input.session;
    this.status = { observedAt: input.observedAt, intervalMs: input.intervalMs, paused: input.paused };
  }

  publishPower(input: { observedAt: number; intervalMs: number; circuits: PowerCircuitObservation[] }): void {
    this.power = { observedAt: input.observedAt, intervalMs: input.intervalMs, circuits: input.circuits };
  }

  publishFactory(input: { observedAt: number; intervalMs: number; afterResume: boolean; machines: MachineObservation[] }): void {
    this.factory = {
      observedAt: input.observedAt,
      intervalMs: input.intervalMs,
      afterResume: input.afterResume,
      machines: input.machines,
    };
  }

  recordPollFailure(at: number): void {
    this.consecutiveFailures++;
    this.firstFailureAt ??= at;
  }

  recordPollSuccess(at: number): void {
    this.consecutiveFailures = 0;
    this.firstFailureAt = undefined;
    this.lastSuccessAt = at;
  }

  /** The current readings. The arrays are shared, not copied: pollers replace them whole and never mutate them. */
  snapshot(): ObservationSnapshot {
    return {
      session: this.session,
      status: this.status,
      power: this.power,
      factory: this.factory,
      polls: {
        consecutiveFailures: this.consecutiveFailures,
        firstFailureAt: this.firstFailureAt,
        lastSuccessAt: this.lastSuccessAt,
      },
    };
  }
}

export const noopObservationSink: ObservationSink = {
  publishStatus() {},
  publishPower() {},
  publishFactory() {},
  recordPollFailure() {},
  recordPollSuccess() {},
};
