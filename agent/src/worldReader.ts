import { createHash } from "node:crypto";
import type { MappedConveyors, MappedDroneRoutes, MappedMapMarkers, MappedPowerLines, MappedRailSegments, MappedResourceNodes, MappedTrainRoutes } from "@satisfactory-dash/game-adapter";
import { MAP_WORLD_LAYER_MAX_BYTES } from "@satisfactory-dash/shared";
import type { ConveyorsSkipReason, MapWorldLayer, WorldIngestResponse } from "@satisfactory-dash/shared";
import { backoffDelayMs } from "./backoff.js";
import { BackendError } from "./backendClient.js";
import type { WorldIngestBodies } from "./backendClient.js";
import type { AgentLogger } from "./logger.js";
import { abortableSleep } from "./pusher.js";
import type { Sleep } from "./pusher.js";
import { failureCode } from "./sampler.js";

/** Rails: every 10 min (ADR-0038 §1), the same cadence as the backend's local poller (localWorldPoller.ts). */
export const RAILS_INTERVAL_MS = 600_000;
/** Conveyors (ADR-0048 amendment): every 10 min, the same world tier as rails; the graph changes only when the player builds. */
export const CONVEYORS_INTERVAL_MS = 600_000;
/** Train routes (ADR-0055 PR 5): every 10 min, the world tier; stations and timetables change only when the player builds or edits. */
export const TRAIN_ROUTES_INTERVAL_MS = 600_000;
/** Drone routes (ADR-0055 PR 12a): every 10 min, the world tier; a port's pairing changes only when the player edits it. */
export const DRONE_ROUTES_INTERVAL_MS = 600_000;
/** Map markers (ADR-0038 §1, #330): every 10 min, the world tier ADR-0038 D3 puts markers in. getMapMarkers is not a
 *  game-thread endpoint, and markers change only when a player places or edits one, so an unchanged read sends nothing. */
export const MAP_MARKERS_INTERVAL_MS = 600_000;
/** Power lines (ADR-0038 §1, #330): every 10 min, the world tier. getCables is not a game-thread endpoint, and lines
 *  change only when a player builds or removes one, so an unchanged read sends nothing. */
export const POWER_LINES_INTERVAL_MS = 600_000;
/** Resource nodes: every 30 min. `getResourceNode` runs on the game thread, so it is read least often. */
export const RESOURCE_NODES_INTERVAL_MS = 1_800_000;
/** #728 step 6: a changed factory building set reads conveyors at most this often (3 FRM reads, about 0.3 s). */
export const CONVEYORS_NUDGE_MIN_GAP_MS = 60_000;
/** ±10%, as the local poller: agents that started together do not read their games in the same tick. */
export const WORLD_JITTER_FRACTION = 0.1;

/** The game-adapter's projections the reader uses: the same `getRails`/`getResourceNodes` the backend's local poller reads. */
export interface WorldPorts {
  getRails(): Promise<MappedRailSegments>;
  getResourceNodes(): Promise<MappedResourceNodes>;
  getConveyors(): Promise<MappedConveyors>;
  getTrainRoutes(): Promise<MappedTrainRoutes>;
  getDroneRoutes(): Promise<MappedDroneRoutes>;
  getMapMarkers(): Promise<MappedMapMarkers>;
  getPowerLines(): Promise<MappedPowerLines>;
}

export interface WorldClient {
  postWorldLayer<L extends MapWorldLayer>(layer: L, body: WorldIngestBodies[L], signal?: AbortSignal): Promise<WorldIngestResponse>;
}

export interface WorldReaderOptions {
  ports: WorldPorts;
  client: WorldClient;
  logger: AgentLogger;
  /** Called once when the backend rejects the credential (401); the reader stops too. */
  onAuthRejected: () => void;
  now?: () => number;
  sleep?: Sleep;
  /** Injectable for tests: returns a number in [0, 1). Drives both the schedule's jitter and the backoff's. */
  random?: () => number;
}

/** A delay in [1 - WORLD_JITTER_FRACTION, 1 + WORLD_JITTER_FRACTION] of `baseMs`. A random source outside [0, 1) is clamped. */
export function jitteredIntervalMs(baseMs: number, random: () => number = Math.random): number {
  const raw = random();
  const r = Number.isNaN(raw) ? 0.5 : Math.min(1, Math.max(0, raw));
  return Math.round(baseMs * (1 - WORLD_JITTER_FRACTION + r * 2 * WORLD_JITTER_FRACTION));
}

/** What a layer read returns: the projected items, the count the mapper dropped and, for a layer that has none to send this
 *  cycle (conveyors: an FRM without connection fields, or over the edge cap), why. */
interface WorldRead {
  data: unknown[];
  dropped: number;
  skip?: ConveyorsSkipReason;
}

/** The streak state of one layer: what was last accepted, and which warnings this streak has already logged. */
interface LayerState {
  sentHash: string | undefined;
  readFailing: boolean;
  overCap: boolean;
  skipped: ConveyorsSkipReason | undefined;
  /** The skip reason the backend last accepted, so a streak of skipped cycles posts it once (a refusal retries next cycle). */
  skipSent: ConveyorsSkipReason | undefined;
  refused: boolean;
}

/**
 * The agent's world-layer reader (ADR-0038 M4, build order step 5). Each layer is read on its own slow, jittered schedule and
 * POSTed to `/agent/v1/world/:layer` only when the hash of its projected data changed since the last ACCEPTED send; the
 * first read after start always sends (the hash lives in memory only). Its rules:
 *  - the body is the contract's `{ observedAt, data }`, measured serialized against `MAP_WORLD_LAYER_MAX_BYTES` before it is
 *    sent; an over-cap layer is skipped (the backend keeps its last good copy) with one warning per streak; a conveyors
 *    skip is posted as `{ observedAt, skipped }` (#577), once per streak;
 *  - a transient failure (network, timeout, 5xx, 429) retries the SAME body with the snapshot push's backoff, honouring
 *    `Retry-After`, without re-reading the game; a 4xx is not retried, and since its hash is not recorded the layer is tried
 *    again at its next read (an older backend may not know the route yet); a 401 stops the reader;
 *  - logs are codes and counts only, once per streak, never the data.
 */
export class WorldReader {
  private readonly stop = new AbortController();
  /** #728 step 6: the hash of the last factory building id set seen, and the conveyors loop's nudge state. */
  private buildingSetHash: string | undefined;
  private conveyorsNudged = false;
  private conveyorsWake: AbortController | undefined;
  private conveyorsLastReadAt = 0;

  constructor(private readonly options: WorldReaderOptions) {}

  /**
   * #728 cause 11: the factory's building ids from a snapshot the agent read anyway (every 30 s). Conveyor ends name
   * buildings by id and a rebuilt belt or machine gets a new id, so when the set differs from the last one the conveyors
   * layer is read sooner: at once, or CONVEYORS_NUDGE_MIN_GAP_MS after its last read started. The first set is a baseline;
   * an unchanged set changes nothing.
   */
  observeFactoryBuildings(ids: Iterable<string>): void {
    const hash = createHash("sha256").update([...ids].sort().join("\n")).digest("hex");
    const before = this.buildingSetHash;
    this.buildingSetHash = hash;
    if (before === undefined || before === hash) return;
    this.conveyorsNudged = true;
    this.conveyorsWake?.abort();
  }

  async run(signal: AbortSignal): Promise<void> {
    const { ports } = this.options;
    const stopFromOutside = () => this.stop.abort();
    if (signal.aborted) return;
    signal.addEventListener("abort", stopFromOutside, { once: true });
    try {
      await Promise.all([
        this.loop("rails", RAILS_INTERVAL_MS, () => ports.getRails()),
        this.loop("resourceNodes", RESOURCE_NODES_INTERVAL_MS, () => ports.getResourceNodes()),
        this.loop("conveyors", CONVEYORS_INTERVAL_MS, () => ports.getConveyors(), true),
        this.loop("trainRoutes", TRAIN_ROUTES_INTERVAL_MS, () => ports.getTrainRoutes()),
        this.loop("droneRoutes", DRONE_ROUTES_INTERVAL_MS, () => ports.getDroneRoutes()),
        this.loop("mapMarkers", MAP_MARKERS_INTERVAL_MS, () => ports.getMapMarkers()),
        this.loop("powerLines", POWER_LINES_INTERVAL_MS, () => ports.getPowerLines()),
      ]);
    } finally {
      signal.removeEventListener("abort", stopFromOutside);
    }
  }

  private async loop(layer: MapWorldLayer, intervalMs: number, read: () => Promise<WorldRead>, nudgeable = false): Promise<void> {
    const sleep = this.options.sleep ?? abortableSleep;
    const state: LayerState = { sentHash: undefined, readFailing: false, overCap: false, skipped: undefined, skipSent: undefined, refused: false };
    const { signal } = this.stop;
    while (!signal.aborted) {
      if (nudgeable) {
        // A nudge from here on may postdate this read, so it is kept; one from before is answered by it.
        this.conveyorsNudged = false;
        this.conveyorsLastReadAt = (this.options.now ?? Date.now)();
      }
      await this.cycle(layer, state, read);
      if (signal.aborted) return;
      const delayMs = jitteredIntervalMs(intervalMs, this.options.random);
      if (nudgeable) await this.sleepConveyors(delayMs, sleep);
      else await sleep(delayMs, signal);
    }
  }

  /** The conveyors loop's sleep: `delayMs`, cut short by a nudge, which then waits out the minute since the last read began. */
  private async sleepConveyors(delayMs: number, sleep: Sleep): Promise<void> {
    const { signal } = this.stop;
    if (!this.conveyorsNudged) {
      const wake = new AbortController();
      const onStop = () => wake.abort();
      signal.addEventListener("abort", onStop, { once: true });
      this.conveyorsWake = wake;
      try {
        await sleep(delayMs, wake.signal);
      } finally {
        this.conveyorsWake = undefined;
        signal.removeEventListener("abort", onStop);
      }
      if (signal.aborted || !this.conveyorsNudged) return;
    }
    const gapMs = this.conveyorsLastReadAt + CONVEYORS_NUDGE_MIN_GAP_MS - (this.options.now ?? Date.now)();
    if (gapMs > 0) await sleep(gapMs, signal);
  }

  private async cycle(layer: MapWorldLayer, state: LayerState, read: () => Promise<WorldRead>): Promise<void> {
    const { logger } = this.options;
    let mapped: WorldRead;
    try {
      mapped = await read();
    } catch (err) {
      if (!state.readFailing) logger.warn("world_read_failed", { layer, code: failureCode(err) });
      state.readFailing = true;
      return;
    }
    state.readFailing = false;
    if (mapped.dropped > 0) logger.warn("world_layer_items_dropped", { layer, dropped: mapped.dropped });

    // No layer this cycle: report the skip and its reason (#577), once per streak, replacing the backend's older copy. An
    // older backend refuses the body (400, no `data`), which leaves the other layers alone and is retried next cycle.
    if (mapped.skip !== undefined) {
      if (state.skipped !== mapped.skip) logger.warn("world_layer_skipped", { layer, reason: mapped.skip });
      state.skipped = mapped.skip;
      if (state.skipSent !== mapped.skip) {
        const body = { observedAt: new Date((this.options.now ?? Date.now)()).toISOString(), skipped: mapped.skip };
        if (await this.send(layer, body, state)) {
          state.skipSent = mapped.skip;
          // The backend now holds the skip, not the last graph: the next good read must send even if it equals that graph.
          state.sentHash = undefined;
        }
      }
      return;
    }
    state.skipped = undefined;
    state.skipSent = undefined;

    const hash = createHash("sha256").update(JSON.stringify(mapped.data)).digest("hex");
    if (hash === state.sentHash) return;

    const body = { observedAt: new Date((this.options.now ?? Date.now)()).toISOString(), data: mapped.data };
    const bytes = Buffer.byteLength(JSON.stringify(body));
    if (bytes > MAP_WORLD_LAYER_MAX_BYTES) {
      if (!state.overCap) logger.warn("world_layer_over_cap", { layer, bytes, maxBytes: MAP_WORLD_LAYER_MAX_BYTES });
      state.overCap = true;
      return;
    }
    state.overCap = false;

    if (await this.send(layer, body, state)) state.sentHash = hash;
  }

  /** Sends one body until it lands (true), is refused (false) or the reader stops (false). */
  private async send(layer: MapWorldLayer, body: { observedAt: string } & ({ data: unknown[] } | { skipped: ConveyorsSkipReason }), state: LayerState): Promise<boolean> {
    const { client, logger } = this.options;
    const sleep = this.options.sleep ?? abortableSleep;
    const { signal } = this.stop;
    let failures = 0;
    while (!signal.aborted) {
      try {
        // The projection is the contract's shape for this layer (game-adapter's mappers); the cast only names which layer.
        await client.postWorldLayer(layer, body as WorldIngestBodies[typeof layer], signal);
        if (failures > 0) logger.info("world_push_recovered", { layer, attempts: failures });
        state.refused = false;
        return true;
      } catch (err) {
        if (signal.aborted) return false;
        if (err instanceof BackendError && err.kind === "auth_rejected") {
          logger.error("auth_rejected", { status: err.status });
          this.stop.abort();
          this.options.onAuthRejected();
          return false;
        }
        if (err instanceof BackendError && err.kind === "fatal") {
          if (!state.refused) logger.warn("world_layer_refused", { layer, status: err.status, code: err.code });
          state.refused = true;
          return false;
        }
        // Transient, or not from the client at all (a bug): back off and try the same body again.
        const code = err instanceof BackendError ? (err.code ?? "unreachable_or_5xx") : "internal_error";
        if (failures === 0) logger.warn("world_push_failed", { layer, code, status: err instanceof BackendError ? err.status : undefined });
        const delay = Math.max(err instanceof BackendError ? (err.retryAfterMs ?? 0) : 0, backoffDelayMs(failures, { random: this.options.random }));
        failures += 1;
        await sleep(delay, signal);
      }
    }
    return false;
  }
}
