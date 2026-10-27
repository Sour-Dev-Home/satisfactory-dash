import { createHash } from "node:crypto";
import type { Logger } from "pino";
import type { ConveyorsSkipReason, MapWorldLayer } from "@satisfactory-dash/shared";
import type {
  FactoryBuilding,
  MappedConveyors,
  MappedDroneRoutes,
  MappedMapMarkers,
  MappedPowerLines,
  MappedRailSegments,
  MappedResourceNodes,
  MappedTrainRoutes,
  MappedTrains,
  MappedTrainStations,
  Player,
  PowerCircuit,
  ServerHealth,
  ServerStatus,
} from "../../gameserver/index.js";
import { formatErrorDetail } from "../../../platform/formatErrorDetail.js";
import type { MapLiveSink } from "./mapLiveStore.js";
import type { WorldIngestPort } from "./worldIngestService.js";

export interface LocalWorldPollerPorts {
  getRails(): Promise<MappedRailSegments>;
  getResourceNodes(): Promise<MappedResourceNodes>;
  getConveyors(): Promise<MappedConveyors>;
  getTrainRoutes(): Promise<MappedTrainRoutes>;
  getDroneRoutes(): Promise<MappedDroneRoutes>;
  getMapMarkers(): Promise<MappedMapMarkers>;
  getPowerLines(): Promise<MappedPowerLines>;
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
  /** Conveyors (ADR-0048 amendment): every 10 min, jittered, the same schedule as rails. */
  conveyorsIntervalSeconds?: number;
  /** Train routes (ADR-0055 PR 5): every 10 min, jittered, the world tier. */
  trainRoutesIntervalSeconds?: number;
  /** Drone routes (ADR-0055 PR 12a): every 10 min, jittered, the world tier. */
  droneRoutesIntervalSeconds?: number;
  /** Map markers (ADR-0038 §1, #330): every 10 min, jittered, the world tier; getMapMarkers is not game-thread. */
  mapMarkersIntervalSeconds?: number;
  /** Power lines (ADR-0038 §1, #330): every 10 min, jittered, the world tier; getCables is not game-thread. */
  powerLinesIntervalSeconds?: number;
  /** mapLive (trains, stations): at the factory cadence (30 s, matching FACTORY_HISTORY_INTERVAL_SECONDS). */
  mapLiveIntervalSeconds?: number;
  /** A read that takes longer than this is abandoned and counted as failed, per cadence. */
  pollTimeoutMs?: number;
  now?: () => number;
  /** Tests only: replaces Math.random()'s jitter with a fixed fraction in [0, 1). */
  jitter?: () => number;
}

const DEFAULT_RAILS_INTERVAL_SECONDS = 600;
const DEFAULT_CONVEYORS_INTERVAL_SECONDS = 600;
const DEFAULT_TRAIN_ROUTES_INTERVAL_SECONDS = 600;
const DEFAULT_DRONE_ROUTES_INTERVAL_SECONDS = 600;
const DEFAULT_MAP_MARKERS_INTERVAL_SECONDS = 600;
const DEFAULT_POWER_LINES_INTERVAL_SECONDS = 600;
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
  private timerDueAt = 0;
  private inFlight: Promise<void> | undefined;
  private running = false;
  private started = false;
  private stopped = false;
  private consecutiveFailures = 0;
  private lastStartedAt: number | undefined;
  /** A nudge's gap that arrived while a read was in flight: that read may predate the change, so another follows it. */
  private nudgeAfterRun: number | undefined;

  constructor(
    private readonly name: string,
    private readonly intervalMs: number,
    private readonly run: (signal: AbortSignal) => Promise<void>,
    private readonly options: { logger: Logger; pollTimeoutMs: number; jitter: () => number; now: () => number },
  ) {}

  start(): void {
    this.started = true;
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

  /**
   * Reads sooner (#728 step 6): once `minGapMs` has passed since the last read started (at once if it has), never later
   * than the read already scheduled. A nudge during a read schedules one more after it, under the same gap. A loop whose
   * last read failed ignores nudges until a scheduled read succeeds.
   */
  nudge(minGapMs: number): void {
    // Only a running loop: a nudge never starts one (ADR-0054 D3: the pollers run on the leader only, but any instance
    // serves the factory reads that nudge).
    if (!this.started || this.stopped) return;
    // A failing read keeps its backed-off schedule (tick's finally): nudges never turn it into a retry every gap.
    if (this.consecutiveFailures > 0) return;
    if (this.running) {
      this.nudgeAfterRun = Math.max(this.nudgeAfterRun ?? 0, minGapMs);
      return;
    }
    const now = this.options.now();
    const delayMs = this.lastStartedAt === undefined ? 0 : Math.max(0, this.lastStartedAt + minGapMs - now);
    if (this.timer !== undefined && this.timerDueAt <= now + delayMs) return;
    clearTimeout(this.timer);
    this.schedule(delayMs);
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timerDueAt = this.options.now() + delayMs;
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
    this.running = true;
    this.lastStartedAt = this.options.now();
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
      this.running = false;
      this.schedule(this.jitteredInterval());
      const pending = this.nudgeAfterRun;
      this.nudgeAfterRun = undefined;
      if (pending !== undefined) this.nudge(pending);
    }
  }
}

/** #728 step 6: a changed building set reads conveyors at most this often (3 FRM reads, about 0.3 s). */
export const CONVEYORS_NUDGE_MIN_GAP_MS = 60_000;

/**
 * Remembers a hash of the factory's building id set (#728 cause 11): conveyor ends name buildings by id, and a rebuilt
 * belt or machine gets a new id. Answers true when the set differs from the one before; the first set is a baseline.
 */
export class BuildingSetWatcher {
  private last: string | undefined;

  changed(ids: Iterable<string>): boolean {
    const hash = createHash("sha256").update([...ids].sort().join("\n")).digest("hex");
    const before = this.last;
    this.last = hash;
    return before !== undefined && before !== hash;
  }
}

/**
 * The game-server reads telemetry makes: telemetry's `TelemetryPorts`, restated here because map never imports telemetry.
 * server.ts hands the decorated ports to `createTelemetryServices`, so a method telemetry adds and this lacks fails the
 * typecheck there.
 */
export interface FactoryReadPorts {
  getServerHealth(): Promise<ServerHealth>;
  getServerStatus(): Promise<ServerStatus>;
  getFactoryBuildings(): Promise<FactoryBuilding[]>;
  getPowerCircuits(): Promise<PowerCircuit[]>;
  getPlayers(): Promise<Player[]>;
}

/**
 * A decorator over the reads telemetry makes (the composition root feeds the local poller's nudge from the factory reads
 * telemetry already makes): `getFactoryBuildings` reports each successful read's building ids to `observe`; every other
 * method calls the original's, on the original. An observer that throws never fails the read.
 */
export function observeFactoryReads(ports: FactoryReadPorts, observe: (ids: string[]) => void): FactoryReadPorts {
  return {
    getServerHealth: () => ports.getServerHealth(),
    getServerStatus: () => ports.getServerStatus(),
    getPowerCircuits: () => ports.getPowerCircuits(),
    getPlayers: () => ports.getPlayers(),
    getFactoryBuildings: async () => {
      const buildings = await ports.getFactoryBuildings();
      try {
        observe(buildings.map((b) => b.id));
      } catch {
        // The nudge is an optimisation; the factory read is what the caller asked for.
      }
      return buildings;
    },
  };
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
  private readonly conveyors: Loop;
  private readonly buildingSet = new BuildingSetWatcher();

  constructor(ports: LocalWorldPollerPorts, options: LocalWorldPollerOptions) {
    const now = options.now ?? Date.now;
    const jitter = options.jitter ?? Math.random;
    const shared = { logger: options.logger, pollTimeoutMs: options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS, jitter, now };
    const { logger, serverPublicId, ingest, mapLive } = options;

    /** The skip reason last warned about per layer, so a streak of skipped cycles warns once, not every 10 minutes. */
    const skipped = new Map<MapWorldLayer, ConveyorsSkipReason>();
    const ingestLayer = async (layer: MapWorldLayer, mapped: { data: unknown[]; dropped: number; skip?: ConveyorsSkipReason }) => {
      if (mapped.dropped > 0) {
        logger.warn({ layer, serverId: serverPublicId, dropped: mapped.dropped }, "map world layer: game-adapter mapper dropped items");
      }
      // No layer this cycle (conveyors: an FRM without connection fields, or over the edge cap): record the skip and its
      // reason (#577), replacing the older layer; one warning per streak, but the ingest is idempotent so it runs every cycle.
      if (mapped.skip !== undefined) {
        if (skipped.get(layer) !== mapped.skip) logger.warn({ layer, serverId: serverPublicId, reason: mapped.skip }, "map world layer: skipped, recording the skip");
        skipped.set(layer, mapped.skip);
        await ingest.ingest(serverPublicId, layer, { observedAt: new Date(now()).toISOString(), skipped: mapped.skip });
        return;
      }
      skipped.delete(layer);
      await ingest.ingest(serverPublicId, layer, { observedAt: new Date(now()).toISOString(), data: mapped.data });
    };

    this.conveyors = new Loop("conveyors", (options.conveyorsIntervalSeconds ?? DEFAULT_CONVEYORS_INTERVAL_SECONDS) * 1000, async () => ingestLayer("conveyors", await ports.getConveyors()), shared);
    this.loops = [
      new Loop("rails", (options.railsIntervalSeconds ?? DEFAULT_RAILS_INTERVAL_SECONDS) * 1000, async () => ingestLayer("rails", await ports.getRails()), shared),
      new Loop(
        "resourceNodes",
        (options.resourceNodesIntervalSeconds ?? DEFAULT_RESOURCE_NODES_INTERVAL_SECONDS) * 1000,
        async () => ingestLayer("resourceNodes", await ports.getResourceNodes()),
        shared,
      ),
      this.conveyors,
      new Loop("trainRoutes", (options.trainRoutesIntervalSeconds ?? DEFAULT_TRAIN_ROUTES_INTERVAL_SECONDS) * 1000, async () => ingestLayer("trainRoutes", await ports.getTrainRoutes()), shared),
      new Loop("droneRoutes", (options.droneRoutesIntervalSeconds ?? DEFAULT_DRONE_ROUTES_INTERVAL_SECONDS) * 1000, async () => ingestLayer("droneRoutes", await ports.getDroneRoutes()), shared),
      new Loop("mapMarkers", (options.mapMarkersIntervalSeconds ?? DEFAULT_MAP_MARKERS_INTERVAL_SECONDS) * 1000, async () => ingestLayer("mapMarkers", await ports.getMapMarkers()), shared),
      new Loop("powerLines", (options.powerLinesIntervalSeconds ?? DEFAULT_POWER_LINES_INTERVAL_SECONDS) * 1000, async () => ingestLayer("powerLines", await ports.getPowerLines()), shared),
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

  /**
   * #728 cause 11: the factory's buildings, from a read the backend made anyway (every 30 s). When the id set changed since
   * the last call, conveyors are read sooner (rate-limited by CONVEYORS_NUDGE_MIN_GAP_MS), so belt ends stop naming
   * buildings the factory read no longer has for up to 10 minutes. An unchanged set changes nothing.
   */
  observeFactoryBuildings(ids: Iterable<string>): void {
    if (this.buildingSet.changed(ids)) this.conveyors.nudge(CONVEYORS_NUDGE_MIN_GAP_MS);
  }

  async stop(): Promise<void> {
    await Promise.all(this.loops.map((loop) => loop.stop()));
  }
}
