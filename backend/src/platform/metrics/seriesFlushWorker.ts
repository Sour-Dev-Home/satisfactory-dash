import type { Logger } from "pino";
import { formatErrorDetail } from "../formatErrorDetail.js";
import type { Queryable } from "../db/schemaVersion.js";
import type { MetricsAggregator } from "./aggregator.js";
import { addSeriesDeltas, purgeExpiredSeries } from "./seriesHourlyRepository.js";

export const FLUSH_INTERVAL_MS = 60_000;
const PURGE_EVERY_FLUSHES = 60; // 60 x 60 s = about once an hour, same cadence family as commandSweeper's.

export interface SeriesFlushOptions {
  logger: Logger;
  now?: () => number;
  flushIntervalMs?: number;
}

/**
 * ADR-0037 §2: every 60 s, drains whatever the in-process `MetricsAggregator` accumulated since the
 * last flush and adds it into `metrics.series_hourly`; about once an hour it also purges rows past
 * the 90-day retention. Idempotent by construction: `aggregator.drain()` empties itself, so a flush
 * with nothing new since the last one writes nothing (see `aggregator.ts`'s `drain` doc). A failed
 * write drops that interval's deltas rather than retrying them (metrics are best-effort operational
 * data, not the append-only history/audit trails, so losing one 60 s window on a database hiccup is
 * an acceptable trade against the complexity of re-queuing). Never throws; logs once per run of
 * failures, like `CommandSweeper` and `HistoryMaintenanceWorker`.
 */
export class SeriesFlushWorker {
  private readonly now: () => number;
  private readonly flushIntervalMs: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | undefined;
  private started = false;
  private stopped = false;
  private failing = false;
  private flushes = 0;

  constructor(
    private readonly db: Queryable,
    private readonly aggregator: MetricsAggregator,
    private readonly options: SeriesFlushOptions,
  ) {
    this.now = options.now ?? Date.now;
    this.flushIntervalMs = options.flushIntervalMs ?? FLUSH_INTERVAL_MS;
  }

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.schedule();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.inFlight = this.run();
    }, this.flushIntervalMs);
    this.timer.unref?.();
  }

  /** One flush (and a purge when due); exposed for tests. Never throws. */
  async flushOnce(): Promise<void> {
    const deltas = this.aggregator.drain();
    try {
      if (deltas.length > 0) {
        await addSeriesDeltas(this.db, deltas);
      }
      if (this.flushes++ % PURGE_EVERY_FLUSHES === 0) {
        const purged = await purgeExpiredSeries(this.db, this.now());
        if (purged > 0) this.options.logger.info({ purged }, "expired metrics series purged");
      }
      if (this.failing) {
        this.options.logger.info("metrics flush recovered");
        this.failing = false;
      }
    } catch (err) {
      if (!this.failing) {
        this.failing = true;
        this.options.logger.warn({ err: formatErrorDetail(err) }, "metrics flush failed; the drained interval's data is lost, trying again next run");
      }
    }
  }

  private async run(): Promise<void> {
    try {
      await this.flushOnce();
    } finally {
      this.inFlight = undefined;
      this.schedule();
    }
  }
}
