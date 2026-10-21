import type { Logger } from "pino";
import { formatErrorDetail } from "../../../platform/formatErrorDetail.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { createBackgroundRecorder, type MetricsRecorder, type MetricsSink } from "../../../platform/metrics/index.js";
import {
  insertItemSamples,
  insertPowerSamples,
  insertTransitions,
  type ItemSampleRow,
  type PowerSampleRow,
  type TransitionRow,
} from "../repositories/historyRepository.js";
import type { BackgroundWorker } from "./powerHistoryPoller.js";
import { isCatalogedItem } from "../itemForms.js";
import { capItemSample, capPowerSample, type Capped } from "./historyQuota.js";

/** What the pollers write to: fire-and-forget, so a slow or absent database never slows a poll. */
export interface HistoryRecorder {
  recordPower(rows: PowerSampleRow[]): void;
  recordItems(rows: ItemSampleRow[]): void;
  recordTransitions(rows: TransitionRow[]): void;
}

/** Used when there is no database: every write is dropped. */
export const noopHistoryRecorder: HistoryRecorder = {
  recordPower() {},
  recordItems() {},
  recordTransitions() {},
};

export interface BufferedHistoryRecorderOptions {
  logger: Logger;
  flushIntervalMs?: number;
  /** Per kind. When a database outage fills a buffer, the OLDEST rows are dropped so memory stays bounded. */
  maxBuffered?: number;
  /** Tests only: where the metrics go (default the process-wide background aggregator). */
  metrics?: MetricsSink;
  /** #515: whether an item class name is in the item catalog (default the committed catalog). */
  isCatalogedItem?: (className: string) => boolean;
  now?: () => number;
}

const DEFAULT_FLUSH_INTERVAL_MS = 15_000;
const DEFAULT_MAX_BUFFERED = 20_000;
/** #515: rows over a per-sample cap are logged at most this often per server (the counter counts every one). */
export const QUOTA_WARNING_INTERVAL_MS = 60 * 60_000;

/** 32-bit hash of a game session's name (FNV-1a): a power series never spans a session change. */
export function sessionKey(sessionName: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < sessionName.length; i++) {
    hash ^= sessionName.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

/**
 * Buffers one server's history rows and writes them in batches every few seconds. It never throws into a
 * poller: a failed flush keeps the rows (up to the bound) for the next attempt and logs only the first
 * failure of a run, so a database that is down does not fill the log.
 */
export class BufferedHistoryRecorder implements HistoryRecorder, BackgroundWorker {
  private power: PowerSampleRow[] = [];
  private items: ItemSampleRow[] = [];
  private transitions: TransitionRow[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private flushing: Promise<void> | undefined;
  private consecutiveFailures = 0;
  private stopped = false;
  private readonly flushIntervalMs: number;
  private readonly maxBuffered: number;
  private readonly logger: Logger;
  private readonly metrics: MetricsRecorder;
  private readonly isCataloged: (className: string) => boolean;
  private readonly now: () => number;
  private lastQuotaWarningAt: number | undefined;

  constructor(
    private readonly db: Queryable,
    private readonly serverPublicId: string,
    options: BufferedHistoryRecorderOptions,
  ) {
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.maxBuffered = options.maxBuffered ?? DEFAULT_MAX_BUFFERED;
    this.logger = options.logger;
    this.metrics = createBackgroundRecorder(options.logger, options.metrics);
    this.isCataloged = options.isCatalogedItem ?? ((className) => isCatalogedItem(className));
    this.now = options.now ?? Date.now;
  }

  /** One power sample. #515: at most MAX_POWER_SAMPLE_CIRCUITS circuits of it are recorded. */
  recordPower(rows: PowerSampleRow[]): void {
    this.power = this.bounded(this.power, this.withinQuota("power_samples", capPowerSample(rows)));
  }

  /** One item sample. #515: every catalog item, and at most MAX_UNCATALOGED_ITEMS_PER_SAMPLE others, are recorded. */
  recordItems(rows: ItemSampleRow[]): void {
    this.items = this.bounded(this.items, this.withinQuota("item_samples", capItemSample(rows, this.isCataloged)));
  }

  /** Counts what a cap dropped, and says so in the log at most once an hour for this server. */
  private withinQuota<T>(table: "power_samples" | "item_samples", capped: Capped<T>): T[] {
    if (capped.dropped > 0 && !this.stopped) {
      this.metrics.counter("satis.history.rows_dropped", { server: this.serverPublicId, table }, capped.dropped);
      const now = this.now();
      if (this.lastQuotaWarningAt === undefined || now - this.lastQuotaWarningAt >= QUOTA_WARNING_INTERVAL_MS) {
        this.lastQuotaWarningAt = now;
        // Counts only: never a class name, which comes from the agent.
        this.logger.warn({ table, dropped: capped.dropped, kept: capped.kept.length, code: "HISTORY_QUOTA_EXCEEDED" }, "a history sample is over its per-server cap; the excess is not recorded");
      }
    }
    return capped.kept;
  }

  recordTransitions(rows: TransitionRow[]): void {
    this.transitions = this.bounded(this.transitions, rows);
  }

  private bounded<T>(buffer: T[], rows: T[]): T[] {
    if (this.stopped || rows.length === 0) {
      return buffer;
    }
    const merged = buffer.concat(rows);
    return merged.length > this.maxBuffered ? merged.slice(merged.length - this.maxBuffered) : merged;
  }

  start(): void {
    if (this.timer || this.stopped) {
      return;
    }
    this.timer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    // One last write of what is buffered. A timer flush may already be in flight: it started before the newest rows
    // (or its own failed rows, requeued when it ends) were buffered, so a second flush picks those up.
    await this.flush();
    await this.flush();
    this.stopped = true;
  }

  /** Writes what is buffered. One flush at a time; resolves (never rejects) when it is done. */
  flush(): Promise<void> {
    if (!this.flushing) {
      this.flushing = this.flushOnce().finally(() => {
        this.flushing = undefined;
      });
    }
    return this.flushing;
  }

  private async flushOnce(): Promise<void> {
    const power = this.power;
    const items = this.items;
    const transitions = this.transitions;
    this.power = [];
    this.items = [];
    this.transitions = [];
    let failed = false;
    // Each kind is written on its own, so a failing table does not lose the others' rows.
    const attempt = async (table: string, rows: unknown[], write: () => Promise<void>, requeue: () => void): Promise<void> => {
      if (rows.length === 0) {
        return;
      }
      try {
        await write();
      } catch (err) {
        failed = true;
        requeue();
        if (this.consecutiveFailures === 0) {
          this.logger.warn({ err: formatErrorDetail(err) }, "history write failed; buffering and retrying");
        }
        return;
      }
      // ADR-0037: the rows that landed (a requeued batch counts when it is finally written).
      this.metrics.counter("satis.history.rows_written", { table }, rows.length);
    };
    await attempt("power_samples", power, () => insertPowerSamples(this.db, this.serverPublicId, power), () => {
      this.power = this.bounded(power, this.power);
    });
    await attempt("item_samples", items, () => insertItemSamples(this.db, this.serverPublicId, items), () => {
      this.items = this.bounded(items, this.items);
    });
    await attempt("building_transitions", transitions, () => insertTransitions(this.db, this.serverPublicId, transitions), () => {
      this.transitions = this.bounded(transitions, this.transitions);
    });
    if (failed) {
      this.consecutiveFailures++;
    } else if (this.consecutiveFailures > 0) {
      this.logger.info({ failedFlushes: this.consecutiveFailures }, "history writes recovered");
      this.consecutiveFailures = 0;
    }
  }
}
