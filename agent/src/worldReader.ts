import { createHash } from "node:crypto";
import type { MappedConveyors, MappedRailSegments, MappedResourceNodes } from "@satisfactory-dash/game-adapter";
import { MAP_WORLD_LAYER_MAX_BYTES } from "@satisfactory-dash/shared";
import type { MapWorldLayer, WorldIngestResponse } from "@satisfactory-dash/shared";
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
/** Resource nodes: every 30 min. `getResourceNode` runs on the game thread, so it is read least often. */
export const RESOURCE_NODES_INTERVAL_MS = 1_800_000;
/** ±10%, as the local poller: agents that started together do not read their games in the same tick. */
export const WORLD_JITTER_FRACTION = 0.1;

/** The game-adapter's projections the reader uses: the same `getRails`/`getResourceNodes` the backend's local poller reads. */
export interface WorldPorts {
  getRails(): Promise<MappedRailSegments>;
  getResourceNodes(): Promise<MappedResourceNodes>;
  getConveyors(): Promise<MappedConveyors>;
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
  skip?: string;
}

/** The streak state of one layer: what was last accepted, and which warnings this streak has already logged. */
interface LayerState {
  sentHash: string | undefined;
  readFailing: boolean;
  overCap: boolean;
  skipped: string | undefined;
  refused: boolean;
}

/**
 * The agent's world-layer reader (ADR-0038 M4, build order step 5). Each layer is read on its own slow, jittered schedule and
 * POSTed to `/agent/v1/world/:layer` only when the hash of its projected data changed since the last ACCEPTED send; the
 * first read after start always sends (the hash lives in memory only). Its rules:
 *  - the body is the contract's `{ observedAt, data }`, measured serialized against `MAP_WORLD_LAYER_MAX_BYTES` before it is
 *    sent; an over-cap layer is skipped (the backend keeps its last good copy) with one warning per streak;
 *  - a transient failure (network, timeout, 5xx, 429) retries the SAME body with the snapshot push's backoff, honouring
 *    `Retry-After`, without re-reading the game; a 4xx is not retried, and since its hash is not recorded the layer is tried
 *    again at its next read (an older backend may not know the route yet); a 401 stops the reader;
 *  - logs are codes and counts only, once per streak, never the data.
 */
export class WorldReader {
  private readonly stop = new AbortController();

  constructor(private readonly options: WorldReaderOptions) {}

  async run(signal: AbortSignal): Promise<void> {
    const { ports } = this.options;
    const stopFromOutside = () => this.stop.abort();
    if (signal.aborted) return;
    signal.addEventListener("abort", stopFromOutside, { once: true });
    try {
      await Promise.all([
        this.loop("rails", RAILS_INTERVAL_MS, () => ports.getRails()),
        this.loop("resourceNodes", RESOURCE_NODES_INTERVAL_MS, () => ports.getResourceNodes()),
        this.loop("conveyors", CONVEYORS_INTERVAL_MS, () => ports.getConveyors()),
      ]);
    } finally {
      signal.removeEventListener("abort", stopFromOutside);
    }
  }

  private async loop(layer: MapWorldLayer, intervalMs: number, read: () => Promise<WorldRead>): Promise<void> {
    const sleep = this.options.sleep ?? abortableSleep;
    const state: LayerState = { sentHash: undefined, readFailing: false, overCap: false, skipped: undefined, refused: false };
    const { signal } = this.stop;
    while (!signal.aborted) {
      await this.cycle(layer, state, read);
      if (signal.aborted) return;
      await sleep(jitteredIntervalMs(intervalMs, this.options.random), signal);
    }
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

    // No layer this cycle: send nothing (the backend keeps its last good copy), one warning per streak.
    if (mapped.skip !== undefined) {
      if (state.skipped !== mapped.skip) logger.warn("world_layer_skipped", { layer, reason: mapped.skip });
      state.skipped = mapped.skip;
      return;
    }
    state.skipped = undefined;

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
  private async send(layer: MapWorldLayer, body: { observedAt: string; data: unknown[] }, state: LayerState): Promise<boolean> {
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
