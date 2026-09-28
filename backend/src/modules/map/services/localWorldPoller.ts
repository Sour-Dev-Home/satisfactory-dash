import type { Logger } from "pino";
import type { MapWorldLayer } from "@satisfactory-dash/shared";
import type { MappedRailSegments, MappedResourceNodes, MappedTrains, MappedTrainStations } from "../../gameserver/index.js";
import { formatErrorDetail } from "../../../platform/formatErrorDetail.js";
import type { MapLiveSink } from "./mapLiveStore.js";
import type { WorldIngestPort } from "./worldIngestService.js";

export interface LocalWorldPollerPorts {
  getRails(): Promise<MappedRailSegments>;
  getResourceNodes(): Promise<MappedResourceNodes>;
  getTrains(): Promise<MappedTrains>;
  getTrainStations(): Promise<MappedTrainStations>;
}

export interface LocalWorldPollerOptions {
  logger: Logger;
  serverPublicId: string;
  ingest: WorldIngestPort;
  mapLive: MapLiveSink;
  /** Rails: every 10 min, jittered (ADR-0038 M3). */
  railsIntervalSeconds?: number;
  /** Resource nodes: every 30 min — this endpoint runs on the game thread. */
  resourceNodesIntervalSeconds?: number;
  /** mapLive (trains, stations): at the factory cadence (30 s, matching FACTORY_HISTORY_INTERVAL_SECONDS). */
  mapLiveIntervalSeconds?: number;
  /** A read that takes longer than this is abandoned and counted as failed, per cadence. */
  pollTimeoutMs?: number;
  now?: () => number;
  /** Tests only: replaces Math.random()'s jitter with a fixed fraction in [0, 1). */
  jitter?: () => number;
}

const DEFAULT_RAILS_INTERVAL_SECONDS = 600;
const DEFAULT_RESOURCE_NODES_INTERVAL_SECONDS = 1800;
const DEFAULT_MAP_LIVE_INTERVAL_SECONDS = 30;
const DEFAULT_POLL_TIMEOUT_MS = 30_000;
/** ±10%: staggers many servers' pollers so they don't all hit the game thread in the same tick. */
const JITTER_FRACTION = 0.1;

/** One independently-scheduled read: its own timer, in-flight guard and consecutive-failure count,
 *  so a slow or failing rails read never blocks resourceNodes or mapLive. Mirrors
 *  telemetry/services/factoryHistoryPoller.ts's single-schedule discipline, three times over. */
class Loop {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | undefined;
  private stopped = false;
  private consecutiveFailures = 0;

  constructor(
    private readonly name: string,
    private readonly intervalMs: number,
    private readonly run: (signal: AbortSignal) => Promise<void>,
    private readonly options: { logger: Logger; pollTimeoutMs: number; jitter: () => number },
  ) {}

  start(): void {
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.inFlight;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.inFlight = this.tick();
    }, delayMs);
    this.timer.unref?.();
  }

  private jitteredInterval(): number {
    // In [1 - JITTER_FRACTION, 1 + JITTER_FRACTION) of the base interval.
    return Math.round(this.intervalMs * (1 - JITTER_FRACTION + this.options.jitter() * 2 * JITTER_FRACTION));
  }

  private async tick(): Promise<void> {
    const controller = new AbortController();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const timedOut = new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => {
          controller.abort();
          reject(new Error(`${this.name} read timed out after ${this.options.pollTimeoutMs} ms`));
        }, this.options.pollTimeoutMs);
        deadline.unref?.();
      });
      await Promise.race([this.run(controller.signal), timedOut]);
      if (this.consecutiveFailures > 0) {
        this.options.logger.info({ loop: this.name, failedReads: this.consecutiveFailures }, "map world poller recovered");
        this.consecutiveFailures = 0;
      }
    } catch (err) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures === 1) {
        this.options.logger.warn({ loop: this.name, err: formatErrorDetail(err) }, "map world poller read failed; leaving a gap");
      }
    } finally {
      clearTimeout(deadline);
      this.schedule(this.jitteredInterval());
    }
  }
}

/**
 * ADR-0038 M3 (#353): for a LOCAL (polled, non-agent) server, the backend reads its own world
 * layers and mapLive directly from the game server, at three independent cadences, instead of
 * waiting on an edge agent. Each read logs the game-adapter mapper's own `dropped` count at warn
 * (architect's explicit ask) — separate from `WorldIngestService`'s own defense-in-depth drop
 * count, which fires downstream of this for the SAME reason a bad item can reach either layer.
 *
 * Implements the same plain `{start, stop}` shape server.ts's worker arrays already use
 * (telemetry/services/powerHistoryPoller.ts's `BackgroundWorker`) structurally, without importing
 * telemetry (no such module edge exists for `map`).
 */
export class LocalWorldPoller {
  private readonly loops: Loop[];

  constructor(ports: LocalWorldPollerPorts, options: LocalWorldPollerOptions) {
    const now = options.now ?? Date.now;
    const jitter = options.jitter ?? Math.random;
    const shared = { logger: options.logger, pollTimeoutMs: options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS, jitter };
    const { logger, serverPublicId, ingest, mapLive } = options;

    const ingestLayer = async (layer: MapWorldLayer, mapped: { data: unknown[]; dropped: number }) => {
      if (mapped.dropped > 0) {
        logger.warn({ layer, serverId: serverPublicId, dropped: mapped.dropped }, "map world layer: game-adapter mapper dropped items");
      }
      await ingest.ingest(serverPublicId, layer, { observedAt: new Date(now()).toISOString(), data: mapped.data });
    };

    this.loops = [
      new Loop("rails", (options.railsIntervalSeconds ?? DEFAULT_RAILS_INTERVAL_SECONDS) * 1000, async () => ingestLayer("rails", await ports.getRails()), shared),
      new Loop(
        "resourceNodes",
        (options.resourceNodesIntervalSeconds ?? DEFAULT_RESOURCE_NODES_INTERVAL_SECONDS) * 1000,
        async () => ingestLayer("resourceNodes", await ports.getResourceNodes()),
        shared,
      ),
      new Loop(
        "mapLive",
        (options.mapLiveIntervalSeconds ?? DEFAULT_MAP_LIVE_INTERVAL_SECONDS) * 1000,
        async () => {
          const [trains, stations] = await Promise.all([ports.getTrains(), ports.getTrainStations()]);
          if (trains.dropped > 0) logger.warn({ layer: "trains", serverId: serverPublicId, dropped: trains.dropped }, "map world layer: game-adapter mapper dropped items");
          if (stations.dropped > 0) logger.warn({ layer: "stations", serverId: serverPublicId, dropped: stations.dropped }, "map world layer: game-adapter mapper dropped items");
          mapLive.record({ trains: trains.data, stations: stations.data }, now());
        },
        shared,
      ),
    ];
  }

  start(): void {
    for (const loop of this.loops) loop.start();
  }

  async stop(): Promise<void> {
    await Promise.all(this.loops.map((loop) => loop.stop()));
  }
}
