import type { Logger } from "pino";
import { formatErrorDetail } from "../../../platform/formatErrorDetail.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { purgeExpired, rollUp, RAW_RETENTION_MS } from "../repositories/historyRepository.js";
import type { BackgroundWorker } from "./powerHistoryPoller.js";

export interface HistoryMaintenanceOptions {
  logger: Logger;
  now?: () => number;
  /** How often the rollup runs. */
  rollUpIntervalMs?: number;
  /** How often retention runs. */
  purgeIntervalMs?: number;
  /** Each rollup re-covers this much recent time, so rows flushed late (the recorder buffers) are still rolled. */
  overlapMs?: number;
}

const DEFAULT_ROLLUP_INTERVAL_MS = 60_000;
const DEFAULT_PURGE_INTERVAL_MS = 10 * 60_000;
const DEFAULT_OVERLAP_MS = 5 * 60_000;

/**
 * ADR-0027 decision 3, once per process (not per server): rolls raw samples into 1-minute and 1-hour buckets every
 * minute and purges expired rows every ~10 minutes. At start it catches up over the whole raw window, so a restart
 * (or a stretch with the process down) leaves no hole in the rollups. Both jobs are idempotent, so a crash or a
 * second backend costs nothing. Start it only after the database is up.
 */
export class HistoryMaintenanceWorker implements BackgroundWorker {
  private readonly now: () => number;
  private readonly rollUpIntervalMs: number;
  private readonly purgeIntervalMs: number;
  private readonly overlapMs: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | undefined;
  private started = false;
  private stopped = false;
  private lastPurgeAt: number | undefined;
  private catchingUp = true;
  private consecutiveFailures = 0;

  constructor(
    private readonly db: Queryable,
    private readonly options: HistoryMaintenanceOptions,
  ) {
    this.now = options.now ?? Date.now;
    this.rollUpIntervalMs = options.rollUpIntervalMs ?? DEFAULT_ROLLUP_INTERVAL_MS;
    this.purgeIntervalMs = options.purgeIntervalMs ?? DEFAULT_PURGE_INTERVAL_MS;
    this.overlapMs = options.overlapMs ?? DEFAULT_OVERLAP_MS;
  }

  start(): void {
    if (this.started || this.stopped) return;
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

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.inFlight = this.tick();
    }, delayMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    try {
      await this.runOnce();
    } finally {
      this.inFlight = undefined;
      this.schedule(this.rollUpIntervalMs);
    }
  }

  /** One rollup (and a purge when due); exposed for tests. Never throws: failures are logged on the first of a run. */
  async runOnce(): Promise<void> {
    const now = this.now();
    try {
      const fromMs = this.catchingUp ? now - RAW_RETENTION_MS : now - this.overlapMs;
      await rollUp(this.db, { fromMs, toMs: now });
      this.catchingUp = false;
      if (this.lastPurgeAt === undefined || now - this.lastPurgeAt >= this.purgeIntervalMs) {
        const purged = await purgeExpired(this.db, now);
        this.lastPurgeAt = now;
        const total = Object.values(purged).reduce((sum, count) => sum + count, 0);
        if (total > 0) {
          this.options.logger.info({ purged }, "expired history purged");
        }
      }
      if (this.consecutiveFailures > 0) {
        this.options.logger.info({ failedRuns: this.consecutiveFailures }, "history maintenance recovered");
        this.consecutiveFailures = 0;
      }
    } catch (err) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures === 1) {
        this.options.logger.warn({ err: formatErrorDetail(err) }, "history maintenance failed; retrying next run");
      }
    }
  }
}
