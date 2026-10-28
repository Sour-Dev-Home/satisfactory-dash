import type { Cadence, Factory, Power, PowerGenerator, ServerPlayersResponse, Status } from "@satisfactory-dash/shared";
import { ownValue } from "@satisfactory-dash/shared";
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
  /** S4-B: the generators read in this snapshot (`[]` = read, none found); absent = no read, the kept list stays. */
  generators?: PowerGenerator[];
  /** The game's auto-pause setting, read in this snapshot (never present on an unreachable one). */
  autoPause?: boolean;
  /** The agent's `settings.pending`: the auto-pause change waits to be applied by the game (absent = not pending). */
  autoPausePending?: boolean;
}

/** The last auto-pause value an agent reported, with when it was read and whether that is older than its cadence allows. */
export interface AutoPauseReading {
  autoPause: boolean;
  /** The agent said the change waits to be applied; false when it did not say. */
  pending: boolean;
  observedAtMs: number;
  stale: boolean;
}

const CADENCE_KEY: Record<SnapshotPart, keyof Cadence> = {
  status: "statusSeconds",
  power: "powerSeconds",
  factory: "factorySeconds",
  players: "statusSeconds",
};

/** ADR-0052 2.3: the persisted slice of the store (never players). */
export interface PersistedState {
  reachable: boolean;
  unreachableSinceMs: number | undefined;
  lastReceivedAtMs: number;
  status: StoredParts["status"];
  power: StoredParts["power"];
  factory: StoredParts["factory"];
  autoPause: { autoPause: boolean; pending: boolean; observedAtMs: number } | undefined;
}

export class LatestSnapshotStore {
  private parts: StoredParts = {};
  /** Parts loaded from the database: served stale, whatever their age, until a fresh snapshot replaces them. */
  private readonly restored = new Set<SnapshotPart>();
  private reachabilityListener: (() => void) | undefined;
  private reachable: boolean | undefined;
  private unreachableSinceMs: number | undefined;
  private stateObservedAtMs: number | undefined;
  private lastReceivedAtMs: number | undefined;
  private lastPowerAtMs: number | undefined;
  private autoPauseReading: { autoPause: boolean; pending: boolean; observedAtMs: number } | undefined;
  /**
   * S4-B (ADR-0058 "generators once per read"): the last generator read, held apart from `parts.power` because each power
   * part replaces that part whole and most carry no generators. Never persisted (ADR-0052): absent after a restart.
   */
  private generatorsRead: { list: PowerGenerator[]; readAtMs: number } | undefined;
  /** After a drop (new session), a read older than this belongs to the old session and is not taken. */
  private generatorsFloorMs: number | undefined;

  constructor(
    private readonly cadence: () => Cadence,
    private readonly now: () => number = Date.now,
  ) {}

  record(snapshot: RecordedSnapshot): void {
    // ADR-0052: the outage starts at the first unreachable snapshot of a run; a reachable snapshot ends it.
    // A late or retried snapshot observed before the one that set the current state must not flip it.
    const reachableBefore = this.reachable;
    if (snapshot.observedAtMs >= (this.stateObservedAtMs ?? -Infinity)) {
      if (!snapshot.reachable) {
        if (this.reachable !== false) this.unreachableSinceMs = snapshot.observedAtMs;
      } else {
        this.unreachableSinceMs = undefined;
      }
      this.reachable = snapshot.reachable;
      this.stateObservedAtMs = snapshot.observedAtMs;
    }
    this.lastReceivedAtMs = snapshot.receivedAtMs;
    if (!snapshot.reachable) {
      // the parts stay as they were, and reads serve them stale (ADR-0052)
      this.notifyIfReachabilityChanged(reachableBefore);
      return;
    }
    for (const part of ["status", "power", "factory", "players"] as const) {
      const data = snapshot[part];
      // A late or retried snapshot must not put an older reading over a newer one.
      if (data !== undefined && snapshot.observedAtMs >= (this.parts[part]?.observedAtMs ?? -Infinity)) {
        (this.parts as Record<SnapshotPart, unknown>)[part] = { data, observedAtMs: snapshot.observedAtMs };
        this.restored.delete(part);
      }
    }
    // S4-B: a read replaces the kept list only when it is newer, so a late or retried snapshot cannot put an older list back.
    const generators = snapshot.generators;
    if (generators !== undefined) {
      const kept = this.generatorsRead;
      const newer = kept !== undefined ? snapshot.observedAtMs > kept.readAtMs : snapshot.observedAtMs >= (this.generatorsFloorMs ?? -Infinity);
      if (newer) this.generatorsRead = { list: generators, readAtMs: snapshot.observedAtMs };
    }
    this.notifyIfReachabilityChanged(reachableBefore);
    if (snapshot.power !== undefined) this.lastPowerAtMs = snapshot.receivedAtMs;
    if (snapshot.autoPause !== undefined && snapshot.observedAtMs >= (this.autoPauseReading?.observedAtMs ?? -Infinity)) {
      this.autoPauseReading = { autoPause: snapshot.autoPause, pending: snapshot.autoPausePending === true, observedAtMs: snapshot.observedAtMs };
    }
  }

  /** Called after a snapshot that changed whether the game is reachable (including the first one). One listener. */
  onReachabilityChange(listener: () => void): void {
    this.reachabilityListener = listener;
  }

  private notifyIfReachabilityChanged(before: boolean | undefined): void {
    if (this.reachable !== before) this.reachabilityListener?.();
  }

  /**
   * ADR-0052 2.4: put a row loaded at startup under whatever has arrived since. Only parts that are absent or older
   * are taken, and each is served stale until a fresh snapshot replaces it; the reachability state is taken only when
   * no snapshot has set one yet. Players are never restored.
   */
  restore(state: PersistedState): void {
    for (const part of ["status", "power", "factory"] as const) {
      const loaded = state[part];
      if (loaded !== undefined && loaded.observedAtMs > (this.parts[part]?.observedAtMs ?? -Infinity)) {
        (this.parts as Record<SnapshotPart, unknown>)[part] = loaded;
        this.restored.add(part);
      }
    }
    if (this.reachable === undefined) {
      this.reachable = state.reachable;
      this.unreachableSinceMs = state.reachable ? undefined : state.unreachableSinceMs;
      const times = [state.status, state.power, state.factory].map((p) => p?.observedAtMs ?? -Infinity);
      this.stateObservedAtMs = Math.max(...times, state.unreachableSinceMs ?? -Infinity);
      if (this.stateObservedAtMs === -Infinity) this.stateObservedAtMs = undefined;
    }
    this.lastReceivedAtMs = Math.max(this.lastReceivedAtMs ?? -Infinity, state.lastReceivedAtMs);
    if (state.autoPause !== undefined && state.autoPause.observedAtMs > (this.autoPauseReading?.observedAtMs ?? -Infinity)) {
      this.autoPauseReading = state.autoPause;
    }
  }

  /** The state to persist, or undefined before any snapshot arrived (or restored): nothing to write. */
  persistedState(): PersistedState | undefined {
    if (this.reachable === undefined || this.lastReceivedAtMs === undefined) return undefined;
    return {
      reachable: this.reachable,
      unreachableSinceMs: this.unreachableSinceMs,
      lastReceivedAtMs: this.lastReceivedAtMs,
      status: this.parts.status,
      power: this.parts.power,
      factory: this.parts.factory,
      autoPause: this.autoPauseReading,
    };
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

  /**
   * S4-B: forget the kept generator list (a new session or power reset). `atMs` is the observation time of the snapshot
   * that showed the change: a later read (that snapshot's own included) is taken, an older one (the old session) is not.
   */
  dropGenerators(atMs: number): void {
    this.generatorsRead = undefined;
    this.generatorsFloorMs = Math.max(this.generatorsFloorMs ?? -Infinity, atMs);
  }

  /** The power part as served: the kept generator list and its read time, both or neither, while the read is at most
   *  three factory intervals old (ADR-0058 S4-B, the same three-interval rule as a stale part). */
  private withGenerators(power: Power): Power {
    const kept = this.generatorsRead;
    if (kept === undefined || this.now() - kept.readAtMs > STALE_AFTER_INTERVALS * this.cadence().factorySeconds * 1000) return power;
    return { ...power, generators: kept.list, generatorsReadAt: new Date(kept.readAtMs).toISOString() };
  }

  /** The latest power reading unless it is stale (older than three power intervals) or none arrived: what a machine's
   *  fuse is joined from when a factory reading is classified. Unknown is undefined, never assumed healthy. */
  freshPower(): Power | undefined {
    const stored = this.parts.power;
    // Not gated on `reachable`: this runs BEFORE the arriving snapshot is recorded, so `reachable` still reflects the
    // previous snapshot; age alone decides whether the reading may be joined.
    if (stored === undefined) return undefined;
    return this.now() - stored.observedAtMs > STALE_AFTER_INTERVALS * this.cadence().powerSeconds * 1000 ? undefined : stored.data;
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
   * One part, wrapped with its own observation time and staleness. While the game is unreachable the last stored part
   * is still served, always stale and with `unreachableSince` (ADR-0052). Throws upstream_unreachable when there is
   * nothing to serve: the agent has not reported yet, or the game is unreachable and the part was never stored (a
   * request-through server answers the same when its game is down and nothing was read). `fallback` is served when the
   * agent is fine but never sent the part.
   */
  read<K extends SnapshotPart>(part: K, fallback?: NonNullable<StoredParts[K]>["data"]): NonNullable<StoredParts[K]>["data"] {
    if (this.reachable === undefined) {
      throw new ApiFailure("upstream_unreachable", "This server's agent has not reported yet");
    }
    const kept = this.parts[part] as { data: NonNullable<StoredParts[K]>["data"]; observedAtMs: number } | undefined;
    // S4-B: the power part is served with the kept generator list, which is held apart from it (see generatorsRead).
    const stored = kept !== undefined && part === "power" ? { ...kept, data: this.withGenerators(kept.data as Power) as NonNullable<StoredParts[K]>["data"] } : kept;
    if (!this.reachable) {
      if (stored === undefined) {
        throw new ApiFailure("upstream_unreachable", "The game server could not be reached by its agent");
      }
      return observed(stored.data as object, {
        observedAt: new Date(stored.observedAtMs).toISOString(),
        stale: true,
        ...(this.unreachableSinceMs !== undefined ? { unreachableSince: new Date(this.unreachableSinceMs).toISOString() } : {}),
      }) as NonNullable<StoredParts[K]>["data"];
    }
    if (stored === undefined) {
      if (fallback !== undefined) {
        return observed(fallback as object, { observedAt: new Date(this.lastReceivedAtMs ?? this.now()).toISOString(), stale: false }) as NonNullable<StoredParts[K]>["data"];
      }
      throw new ApiFailure("upstream_unreachable", "This server's agent has not reported that yet");
    }
    const cadenceKey = ownValue(CADENCE_KEY, part);
    if (cadenceKey === undefined) {
      throw new Error(`no cadence for snapshot part ${String(part)}`);
    }
    const staleAfterMs = STALE_AFTER_INTERVALS * this.cadence()[cadenceKey] * 1000;
    return observed(stored.data as object, {
      observedAt: new Date(stored.observedAtMs).toISOString(),
      stale: this.restored.has(part) || this.now() - stored.observedAtMs > staleAfterMs,
    }) as NonNullable<StoredParts[K]>["data"];
  }
}
