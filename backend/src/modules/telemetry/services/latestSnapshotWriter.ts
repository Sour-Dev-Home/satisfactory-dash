import type { Logger } from "pino";
import { FactorySchema, PowerSchema, StatusSchema } from "@satisfactory-dash/shared";
import type { LatestSnapshotRepository, LatestSnapshotRow, LatestSnapshotWrite } from "../repositories/latestSnapshotRepository.js";
import type { BackgroundWorker } from "./powerHistoryPoller.js";
import type { LatestSnapshotStore, PersistedState } from "./agentSnapshotStore.js";

/**
 * ADR-0052 PR 2: keeps ONE row per agent server (`telemetry.latest_snapshots`) so the last snapshot survives a backend
 * restart. It writes
 *   - at most every `intervalMs` (5 minutes), and only when a part's reading or the reachability moved since the last
 *     write, so an offline server costs no writes;
 *   - at once when reachability changes (the store tells it);
 *   - once on `stop()` (graceful shutdown), best effort, bounded at `shutdownTimeoutMs`.
 * A write failure logs a warning and is retried at the next tick; it never touches ingest. Players are never written.
 * The factory part is stored only up to `LATEST_FACTORY_MAX_BYTES` of JSON: over it the row carries no factory (never a
 * truncated one) and one warning is logged per crossing.
 */
export const LATEST_SNAPSHOT_WRITE_INTERVAL_MS = 5 * 60 * 1000;
export const LATEST_SNAPSHOT_LOAD_TIMEOUT_MS = 2000;
export const LATEST_SNAPSHOT_SHUTDOWN_TIMEOUT_MS = 2000;
/** The same figure as MAP_WORLD_LAYER_MAX_BYTES (about 4,500 buildings at the measured 440 bytes each). */
export const LATEST_FACTORY_MAX_BYTES = 2_000_000;

export interface LatestSnapshotWriterOptions {
  logger: Logger;
  intervalMs?: number;
  shutdownTimeoutMs?: number;
  /** Resolves once the startup load has settled, with the change key of the state it restored (if nothing had arrived before); nothing is written before, so a partial state never replaces the row. */
  ready?: Promise<string | undefined>;
}

/** A row from the database, as a store state; a part that no longer fits its schema is dropped, not served. */
export function stateFromRow(row: LatestSnapshotRow): PersistedState {
  const parsePart = <T>(part: { data: unknown; observedAtMs: number } | undefined, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }) => {
    if (part === undefined) return undefined;
    const result = schema.safeParse(part.data);
    return result.success ? { data: result.data, observedAtMs: part.observedAtMs } : undefined;
  };
  return {
    reachable: row.reachable,
    unreachableSinceMs: row.unreachableSinceMs,
    lastReceivedAtMs: row.lastReceivedAtMs,
    status: parsePart(row.status, StatusSchema),
    power: parsePart(row.power, PowerSchema),
    factory: parsePart(row.factory, FactorySchema),
    autoPause: row.autoPause,
  };
}

/** Loads the row once, bounded: resolves when the state is restored, the load failed, or the timeout passed. */
export function loadLatestSnapshot(
  store: LatestSnapshotStore,
  repo: LatestSnapshotRepository,
  serverPublicId: string,
  logger: Logger,
  timeoutMs = LATEST_SNAPSHOT_LOAD_TIMEOUT_MS,
): Promise<string | undefined> {
  const load = repo
    .load(serverPublicId)
    .then((row): string | undefined => {
      if (row === undefined) return undefined;
      const untouched = store.persistedState() === undefined;
      store.restore(stateFromRow(row));
      const state = store.persistedState();
      return untouched && state !== undefined ? changeKey(state) : undefined;
    })
    .catch((err: unknown): undefined => {
      logger.warn({ err }, "latest snapshot could not be loaded; serving nothing until the agent reports");
      return undefined;
    });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
  });
  return Promise.race([load, timeout]).finally(() => clearTimeout(timer));
}

function changeKey(state: PersistedState): string {
  return [
    state.reachable,
    state.unreachableSinceMs ?? "",
    state.status?.observedAtMs ?? "",
    state.power?.observedAtMs ?? "",
    state.factory?.observedAtMs ?? "",
    state.autoPause?.observedAtMs ?? "",
  ].join("|");
}

export class LatestSnapshotWriter implements BackgroundWorker {
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;
  private writtenKey: string | undefined;
  private inFlight: Promise<void> | undefined;
  private rerun = false;
  private overCap = false;
  private readonly intervalMs: number;
  private readonly shutdownTimeoutMs: number;
  private readonly ready: Promise<string | undefined>;

  constructor(
    private readonly store: LatestSnapshotStore,
    private readonly repo: LatestSnapshotRepository,
    private readonly serverPublicId: string,
    private readonly options: LatestSnapshotWriterOptions,
  ) {
    this.intervalMs = options.intervalMs ?? LATEST_SNAPSHOT_WRITE_INTERVAL_MS;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? LATEST_SNAPSHOT_SHUTDOWN_TIMEOUT_MS;
    this.ready = options.ready ?? Promise.resolve(undefined);
  }

  start(): void {
    this.stopped = false;
    // What the load restored is already in the database: the first write waits for something to change.
    void this.ready.then((key) => {
      if (this.writtenKey === undefined) this.writtenKey = key;
    });
    this.store.onReachabilityChange(() => {
      if (!this.stopped) void this.flush();
    });
    this.timer = setInterval(() => void this.flush(), this.intervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    let timeout: NodeJS.Timeout | undefined;
    const bound = new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, this.shutdownTimeoutMs);
    });
    try {
      await Promise.race([this.finalFlush(), bound]);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async finalFlush(): Promise<void> {
    await this.inFlight;
    await this.write();
  }

  /** Writes now if something changed; calls during a write are folded into one more write after it. */
  private flush(): Promise<void> {
    if (this.inFlight !== undefined) {
      this.rerun = true;
      return this.inFlight;
    }
    const run = (async () => {
      try {
        await this.ready;
        await this.write();
        while (this.rerun && !this.stopped) {
          this.rerun = false;
          await this.write();
        }
      } finally {
        this.inFlight = undefined;
        this.rerun = false;
      }
    })();
    this.inFlight = run;
    return run;
  }

  private async write(): Promise<void> {
    try {
      const state = this.store.persistedState();
      if (state === undefined) return;
      const key = changeKey(state);
      if (key === this.writtenKey) return;
      const write = this.toWrite(state);
      await this.repo.upsert(this.serverPublicId, write);
      this.writtenKey = key;
    } catch (err) {
      this.options.logger.warn({ err }, "latest snapshot write failed; retrying at the next tick");
    }
  }

  private toWrite(state: PersistedState): LatestSnapshotWrite {
    const status = state.status;
    const power = state.power;
    let factoryJson: string | null = null;
    let factoryObservedAtMs: number | undefined;
    if (state.factory !== undefined) {
      const json = JSON.stringify(state.factory.data);
      const bytes = Buffer.byteLength(json);
      if (bytes > LATEST_FACTORY_MAX_BYTES) {
        if (!this.overCap) {
          this.overCap = true;
          this.options.logger.warn({ bytes, max: LATEST_FACTORY_MAX_BYTES }, "factory part is over the cap; the saved snapshot carries no factory");
        }
      } else {
        this.overCap = false;
        factoryJson = json;
        factoryObservedAtMs = state.factory.observedAtMs;
      }
    } else {
      this.overCap = false;
    }
    return {
      reachable: state.reachable,
      unreachableSinceMs: state.unreachableSinceMs,
      lastReceivedAtMs: state.lastReceivedAtMs,
      statusJson: status === undefined ? null : JSON.stringify(status.data),
      statusObservedAtMs: status?.observedAtMs,
      powerJson: power === undefined ? null : JSON.stringify(power.data),
      powerObservedAtMs: power?.observedAtMs,
      factoryJson,
      factoryObservedAtMs,
      autoPause: state.autoPause,
    };
  }
}
