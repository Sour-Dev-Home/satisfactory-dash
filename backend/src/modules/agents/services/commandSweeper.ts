import type { Logger } from "pino";
import { formatErrorDetail } from "../../../platform/formatErrorDetail.js";
import { FailureStreak, failuresForWindow } from "../../../platform/failureStreak.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { expireStaleCommands, purgeOldCommands } from "../repositories/commandRepository.js";

/**
 * ADR-0031 PR 5b: keeps the commands table honest. Every 15 seconds an open command past its expiry is written as
 * `expired` (the reads already show it so, this makes the table agree), and about once an hour finished commands older
 * than the retention are purged. A failed sweep is logged once per run of failures and tried again; it never throws.
 * Start it once the database is up, like the other database workers.
 */
export const SWEEP_INTERVAL_MS = 15_000;
const PURGE_EVERY_SWEEPS = 240; // 240 x 15 s = 1 hour

export class CommandSweeper {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | undefined;
  private started = false;
  private stopped = false;
  private sweeps = 0;
  private readonly streak: FailureStreak;

  constructor(
    private readonly db: Queryable,
    private readonly options: { logger: Logger; intervalMs?: number },
  ) {
    // #560: 20 failed sweeps at the default 15 s is five minutes.
    this.streak = new FailureStreak({
      logger: options.logger,
      job: "command-sweeper",
      escalateAfter: failuresForWindow(options.intervalMs ?? SWEEP_INTERVAL_MS),
      failedMsg: "sweeping agent commands failed; trying again",
      recoveredMsg: "command sweeping recovered",
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
    }, this.options.intervalMs ?? SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  /** One sweep; exposed for tests. Never throws. */
  async sweep(): Promise<void> {
    try {
      const expired = await expireStaleCommands(this.db);
      if (this.sweeps++ % PURGE_EVERY_SWEEPS === 0) await purgeOldCommands(this.db);
      this.streak.success();
      if (expired > 0) this.options.logger.info({ expired }, "agent commands expired without a result");
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
