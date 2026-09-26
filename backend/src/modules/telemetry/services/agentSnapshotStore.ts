import type { Cadence, Factory, Power, ServerPlayersResponse, Status } from "@satisfactory-dash/shared";
import { ApiFailure } from "../../../platform/errorResponse.js";
import { observed } from "../../../platform/snapshot.js";
import { STALE_AFTER_INTERVALS } from "./powerHistoryService.js";

/**
 * ADR-0031 PR 5a: what an edge agent last told the backend about ONE game server, kept in memory. The live routes of a
 * server reached through an agent read this instead of calling the game server. Each part (status, power, factory,
 * players) is kept with its own time, because the agent samples them at different cadences and a snapshot carries only
 * the parts that were due; the envelope's `observedAt` is that part's, and it is `stale` when older than three of its
 * own cadence intervals (the same rule as the power history, ADR-0022). After a restart the store is empty and every
 * read is "unavailable" until the agent reports again.
 */
export interface StoredParts {
  status?: { data: Status; observedAtMs: number };
  power?: { data: Power; observedAtMs: number };
  factory?: { data: Factory; observedAtMs: number };
  players?: { data: ServerPlayersResponse; observedAtMs: number };
}

export type SnapshotPart = keyof StoredParts;

/** What one accepted snapshot carries, with the time the backend settled on for it. */
export interface RecordedSnapshot {
  reachable: boolean;
  observedAtMs: number;
  receivedAtMs: number;
  status?: Status;
  power?: Power;
  factory?: Factory;
  players?: ServerPlayersResponse;
  /** The game's auto-pause setting, read in this snapshot (never present on an unreachable one). */
  autoPause?: boolean;
}

/** The last auto-pause value an agent reported, with when it was read and whether that is older than its cadence allows. */
export interface AutoPauseReading {
  autoPause: boolean;
  observedAtMs: number;
  stale: boolean;
}

const CADENCE_KEY: Record<SnapshotPart, keyof Cadence> = {
  status: "statusSeconds",
  power: "powerSeconds",
  factory: "factorySeconds",
  players: "statusSeconds",
};

export class LatestSnapshotStore {
  private parts: StoredParts = {};
  private reachable: boolean | undefined;
  private lastReceivedAtMs: number | undefined;
  private lastPowerAtMs: number | undefined;
  private autoPauseReading: { autoPause: boolean; observedAtMs: number } | undefined;

  constructor(
    private readonly cadence: () => Cadence,
    private readonly now: () => number = Date.now,
  ) {}

  record(snapshot: RecordedSnapshot): void {
    this.reachable = snapshot.reachable;
    this.lastReceivedAtMs = snapshot.receivedAtMs;
    if (!snapshot.reachable) return; // the parts stay as they were; reads say "unreachable" until a reachable snapshot arrives
    for (const part of ["status", "power", "factory", "players"] as const) {
      const data = snapshot[part];
      // A late or retried snapshot must not put an older reading over a newer one.
      if (data !== undefined && snapshot.observedAtMs >= (this.parts[part]?.observedAtMs ?? -Infinity)) {
        (this.parts as Record<SnapshotPart, unknown>)[part] = { data, observedAtMs: snapshot.observedAtMs };
      }
    }
    if (snapshot.power !== undefined) this.lastPowerAtMs = snapshot.receivedAtMs;
    if (snapshot.autoPause !== undefined && snapshot.observedAtMs >= (this.autoPauseReading?.observedAtMs ?? -Infinity)) {
      this.autoPauseReading = { autoPause: snapshot.autoPause, observedAtMs: snapshot.observedAtMs };
    }
  }

  /**
   * The last auto-pause value an agent reported, or undefined when none did (an older agent, or none yet). It is kept
   * while the game is unreachable, marked stale by its age (three status intervals, like the status part it is read with).
   */
  autoPause(): AutoPauseReading | undefined {
    const reading = this.autoPauseReading;
    if (reading === undefined) return undefined;
    return { ...reading, stale: this.now() - reading.observedAtMs > STALE_AFTER_INTERVALS * this.cadence().statusSeconds * 1000 };
  }

  /** When the last snapshot of any kind arrived (the agent's liveness), or undefined before the first. */
  lastReceivedAt(): number | undefined {
    return this.lastReceivedAtMs;
  }

  /** When the last snapshot that carried power arrived, for the power history's staleness. */
  lastPowerAt(): number | undefined {
    return this.lastPowerAtMs;
  }

  /** The loaded save's name at the last status reading, or undefined. */
  session(): string | undefined {
    return this.parts.status?.data.sessionName;
  }

  /**
   * One part, wrapped with its own observation time and staleness. Throws upstream_unreachable when there is nothing to
   * serve: the agent has not reported yet, or its last snapshot said the game could not be reached (a request-through
   * server answers the same when its game is down). `fallback` is served when the agent is fine but never sent the part.
   */
  read<K extends SnapshotPart>(part: K, fallback?: NonNullable<StoredParts[K]>["data"]): NonNullable<StoredParts[K]>["data"] {
    if (this.reachable === undefined) {
      throw new ApiFailure("upstream_unreachable", "This server's agent has not reported yet");
    }
    if (!this.reachable) {
      throw new ApiFailure("upstream_unreachable", "The game server could not be reached by its agent");
    }
    const stored = this.parts[part] as { data: NonNullable<StoredParts[K]>["data"]; observedAtMs: number } | undefined;
    if (stored === undefined) {
      if (fallback !== undefined) {
        return observed(fallback as object, { observedAt: new Date(this.lastReceivedAtMs ?? this.now()).toISOString(), stale: false }) as NonNullable<StoredParts[K]>["data"];
      }
      throw new ApiFailure("upstream_unreachable", "This server's agent has not reported that yet");
    }
    const staleAfterMs = STALE_AFTER_INTERVALS * this.cadence()[CADENCE_KEY[part]] * 1000;
    return observed(stored.data as object, {
      observedAt: new Date(stored.observedAtMs).toISOString(),
      stale: this.now() - stored.observedAtMs > staleAfterMs,
    }) as NonNullable<StoredParts[K]>["data"];
  }
}
