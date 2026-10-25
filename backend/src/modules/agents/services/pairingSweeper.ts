import type { Logger } from "pino";
import { formatErrorDetail } from "../../../platform/formatErrorDetail.js";
import { FailureStreak, failuresForWindow } from "../../../platform/failureStreak.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { createBackgroundRecorder } from "../../../platform/metrics/index.js";
import type { MetricsSink } from "../../../platform/metrics/index.js";
import { sweepPairings } from "../repositories/pairingRepository.js";

/**
 * ADR-0051 section 1: deletes pairing rows one hour after they expire, so the session name and agent version an agent
 * reported live at most about 75 minutes (15 minutes open, then one hour; the privacy page says so). Every minute, like the
 * command sweeper's pattern: a failed sweep is logged once per run of failures and tried again; it never throws. The
 * `satis.pairing.events` counter `expired` counts the pairings deleted that were never collected (never approved, or approved
 * and never polled for). Start it once the database is up, with the other database workers.
 */
export const PAIRING_SWEEP_INTERVAL_MS = 60_000;

export class PairingSweeper {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | undefined;
  private started = false;
  private stopped = false;
  private readonly streak: FailureStreak;
  private readonly metrics: ReturnType<typeof createBackgroundRecorder>;

  constructor(
    private readonly db: Queryable,
    private readonly options: { logger: Logger; intervalMs?: number; metrics?: MetricsSink },
  ) {
    this.metrics = createBackgroundRecorder(options.logger, options.metrics);
    this.streak = new FailureStreak({
      logger: options.logger,
      job: "pairing-sweeper",
      escalateAfter: failuresForWindow(options.intervalMs ?? PAIRING_SWEEP_INTERVAL_MS),
      failedMsg: "sweeping agent pairings failed; trying again",
      recoveredMsg: "pairing sweeping recovered",
      countField: "failedSweeps",
    });
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
    }, this.options.intervalMs ?? PAIRING_SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  /** One sweep; exposed for tests. Never throws. */
  async sweep(): Promise<void> {
    try {
      const { deleted, unused } = await sweepPairings(this.db);
      this.streak.success();
      if (unused > 0) this.metrics.counter("satis.pairing.events", { event: "expired" }, unused);
      if (deleted > 0) this.options.logger.info({ deleted }, "expired agent pairings deleted");
    } catch (err) {
      this.streak.failure({ err: formatErrorDetail(err) });
    }
  }

  private async run(): Promise<void> {
    try {
      await this.sweep();
    } finally {
      this.inFlight = undefined;
      this.schedule();
    }
  }
}
