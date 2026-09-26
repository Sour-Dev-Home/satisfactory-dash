import type { Logger } from "pino";
import type { PowerCircuit, ServerStatus } from "../../gameserver/index.js";
import { formatErrorDetail } from "../../../platform/formatErrorDetail.js";
import { noopHistoryRecorder, sessionKey, type HistoryRecorder } from "./historyRecorder.js";
import type { PowerHistoryStore, PowerSample } from "./powerHistoryStore.js";
import { POWER_HISTORY_INTERVAL_SECONDS } from "./powerHistoryStore.js";

/** A long-running task the composition root starts once the server is listening and stops
 *  on shutdown (ADR-0022: the backend's first background worker). */
export interface BackgroundWorker {
  start(): void;
  /** Stops scheduling and resolves once any poll in flight has finished. */
  stop(): Promise<void>;
}

/** What the poller reads from one game server: the gameserver adapter satisfies this. */
export interface PowerHistoryPorts {
  getServerStatus(): Promise<ServerStatus>;
  getPowerCircuits(): Promise<PowerCircuit[]>;
}

/** What the read side needs to decide `stale` (ADR-0022: last success older than 3 intervals). */
export interface PollerHealth {
  startedAt(): number | undefined;
  lastSuccessAt(): number | undefined;
}

export interface PowerHistoryPollerOptions {
  logger: Logger;
  intervalSeconds?: number;
  /** A poll that takes longer than this is abandoned and counted as a failed poll. */
  pollTimeoutMs?: number;
  /** Injectable clock, so tests run on fake time. */
  now?: () => number;
  /** Where samples are also recorded for durable history; omitted means none (no database). */
  history?: HistoryRecorder;
}

/** Comfortably above the adapters' own 5 s request timeout, so it only fires on a stall they miss. */
const DEFAULT_POLL_TIMEOUT_MS = 20_000;

/**
 * Samples one game server's power circuits every few seconds into a `PowerHistoryStore`,
 * whether or not anyone is watching (ADR-0022). It is written so it can never take the
 * process down and never pile up:
 *
 * - One poll at a time: the next tick is scheduled only after the current poll settles.
 * - Nominal ticks: each sample is stamped with its scheduled time, so on-time samples are
 *   exactly `interval` apart and only a real failure or a stall leaves a gap. If the
 *   process falls a whole interval behind (a sleeping laptop, a long pause) it skips the
 *   missed ticks instead of firing them back to back.
 * - Failures are logged and leave a gap; the loop keeps going. Only state changes are
 *   logged (first failure, recovery), so a game server that is off doesn't fill the log.
 * - A new game session, or the game clock going backwards, clears the history: circuit ids
 *   are not known to survive a reload, so a series must never span one (ADR-0006).
 */
export class PowerHistoryPoller implements BackgroundWorker, PollerHealth {
  private readonly intervalMs: number;
  private readonly pollTimeoutMs: number;
  private readonly now: () => number;
  private readonly logger: Logger;
  private readonly history: HistoryRecorder;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | undefined;
  private started = false;
  private stopped = false;
  private nextTickAt = 0;
  private startedAtMs: number | undefined;
  private lastSuccessAtMs: number | undefined;
  private consecutiveFailures = 0;
  private consecutiveCrashes = 0;
  private lastSessionName: string | undefined;
  private lastGameDuration: number | undefined;

  constructor(
    private readonly ports: PowerHistoryPorts,
    private readonly store: PowerHistoryStore,
    options: PowerHistoryPollerOptions,
  ) {
    const intervalSeconds = options.intervalSeconds ?? POWER_HISTORY_INTERVAL_SECONDS;
    if (!Number.isInteger(intervalSeconds) || intervalSeconds <= 0) {
      // A fractional interval would stamp non-integer times, which the store rejects.
      throw new Error("intervalSeconds must be a positive integer");
    }
    this.intervalMs = intervalSeconds * 1000;
    this.pollTimeoutMs = options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
    if (!Number.isInteger(this.pollTimeoutMs) || this.pollTimeoutMs <= 0) {
      throw new Error("pollTimeoutMs must be a positive integer");
    }
    this.now = options.now ?? Date.now;
    this.logger = options.logger;
    this.history = options.history ?? noopHistoryRecorder;
  }

  startedAt(): number | undefined {
    return this.startedAtMs;
  }

  lastSuccessAt(): number | undefined {
    return this.lastSuccessAtMs;
  }

  start(): void {
    // A stopped poller stays stopped (not restartable): stop() may run before start() when a
    // shutdown signal races the server's listen callback, and it must not be undone.
    if (this.started || this.stopped) {
      return;
    }
    this.started = true;
    this.startedAtMs = this.now();
    this.nextTickAt = this.startedAtMs;
    this.schedule();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.inFlight;
  }

  private schedule(): void {
    if (this.stopped) {
      return;
    }
    let delay = this.nextTickAt - this.now();
    if (delay > this.intervalMs) {
      // The wall clock moved backwards: don't sleep for the difference, restart the cadence.
      this.nextTickAt = this.now();
      delay = 0;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.inFlight = this.tick();
    }, Math.max(0, delay));
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    const tickAt = this.nextTickAt;
    try {
      await this.poll(tickAt);
      if (this.consecutiveCrashes > 0) {
        this.logger.info({ crashedPolls: this.consecutiveCrashes }, "power history polling recovered from a crash");
        this.consecutiveCrashes = 0;
      }
    } catch (err) {
      // poll() handles its own failures; this is the last line of defense for the loop.
      // Logged on the first crash of a run only (like poll failures), so a store that keeps
      // throwing doesn't write a line every interval, forever.
      this.consecutiveCrashes++;
      if (this.consecutiveCrashes === 1) {
        this.logger.error({ err: formatErrorDetail(err) }, "power history poll crashed unexpectedly");
      }
    } finally {
      this.nextTickAt += this.intervalMs;
      if (this.now() - this.nextTickAt >= this.intervalMs) {
        this.nextTickAt = this.now(); // fell a whole interval behind: skip, don't burst
      }
      this.inFlight = undefined;
      this.schedule();
    }
  }

  private async poll(tickAt: number): Promise<void> {
    let status: ServerStatus;
    let circuits: PowerCircuit[];
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      // A deadline per poll: a game server that accepts the connection and then drips or
      // stalls must not freeze the loop (the next tick is scheduled only after this poll
      // settles) or make stop() wait forever. The abandoned request is left to the
      // adapter's own timeouts; Promise.race keeps its late result from going unhandled.
      const timedOut = new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => reject(new Error(`poll timed out after ${this.pollTimeoutMs} ms`)), this.pollTimeoutMs);
        deadline.unref?.();
      });
      [status, circuits] = await Promise.race([
        Promise.all([this.ports.getServerStatus(), this.ports.getPowerCircuits()]),
        timedOut,
      ]);
    } catch (err) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures === 1) {
        this.logger.warn({ err: formatErrorDetail(err) }, "power history poll failed; leaving a gap");
      }
      return;
    } finally {
      clearTimeout(deadline);
    }
    if (this.stopped) {
      return; // shutting down: don't touch the store
    }

    if (this.consecutiveFailures > 0) {
      this.logger.info({ failedPolls: this.consecutiveFailures }, "power history polling recovered");
      this.consecutiveFailures = 0;
    }
    this.lastSuccessAtMs = this.now();

    if (
      this.lastSessionName !== undefined &&
      (status.sessionName !== this.lastSessionName || status.totalGameDurationSeconds < (this.lastGameDuration ?? 0))
    ) {
      this.logger.info("game session changed or the game clock went backwards; clearing power history");
      this.store.reset();
    }
    this.lastSessionName = status.sessionName;
    this.lastGameDuration = status.totalGameDurationSeconds;

    const sample: PowerSample = {
      t: tickAt,
      gamePaused: status.isPaused,
      circuits: circuits.map((circuit) => ({
        circuitGroupId: circuit.circuitGroupId,
        productionMW: circuit.powerProduction,
        consumptionMW: circuit.powerConsumed,
        capacityMW: circuit.powerCapacity,
        batteryPercent: circuit.batteryPercent,
        fuseTriggered: circuit.fuseTriggered,
      })),
    };
    if (!this.store.append(sample)) {
      // Not newer than the newest sample: the wall clock stepped backwards. Start over.
      this.logger.warn("power history sample was not newer than the last one; clearing history");
      this.store.reset();
      this.store.append(sample);
    }
    // Durable history (ADR-0027): fire-and-forget into a buffer, so the database never slows or fails a poll.
    const session = sessionKey(status.sessionName);
    this.history.recordPower(
      sample.circuits.map((circuit) => ({
        session,
        circuit: circuit.circuitGroupId,
        atMs: sample.t,
        productionMW: circuit.productionMW,
        consumptionMW: circuit.consumptionMW,
        capacityMW: circuit.capacityMW,
        batteryPercent: circuit.batteryPercent,
        fuseTripped: circuit.fuseTriggered,
      })),
    );
  }
}
