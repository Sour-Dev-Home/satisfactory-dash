/**
 * #560 (OWASP A09): a background worker's failure streak, logged so that a worker that keeps failing pages the owner.
 *
 * - The first failure of a streak logs the worker's own `warn` line, once, as every worker did before.
 * - The failure that makes the streak `escalateAfter` long logs ONE `error` line (pino level 50), msg
 *   {@link WORKER_FAILING_MSG} with `code: "WORKER_FAILING"`, `job` and `failures`. The CloudWatch filters in
 *   `infra/aws/alarms.tf` match it: the `backend-errors` filter (level >= 50) counts it, and the `backend-critical`
 *   alarm fires on a single one.
 * - The first success after a streak logs the worker's recovery `info` line with the streak's length.
 * A new streak after a recovery warns and escalates again. Nothing else is logged while a streak goes on, so a long
 * outage costs two lines, not one per tick.
 *
 * `escalateAfter` comes from {@link failuresForWindow}: about five minutes of consecutive failures at the worker's
 * interval, and never fewer than two, so one blip (a dropped connection, a failover) never pages.
 */
export const WORKER_FAILING_CODE = "WORKER_FAILING";
export const WORKER_FAILING_MSG = "background worker keeps failing";
/** How long a worker must keep failing before its streak is logged at error. */
export const FAILURE_ESCALATION_WINDOW_MS = 5 * 60_000;

/** Consecutive failures that span `windowMs` at `intervalMs` per attempt, at least 2. */
export function failuresForWindow(intervalMs: number, windowMs: number = FAILURE_ESCALATION_WINDOW_MS): number {
  const interval = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 1;
  return Math.max(2, Math.ceil(windowMs / interval));
}

export interface StreakLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface FailureStreakOptions {
  logger: StreakLogger;
  /** A stable, PII-free name for the worker, e.g. "alert-evaluator"; the `job` field of the error line. (Not `worker`:
   *  server.ts already binds that on each worker's child logger, and pino would write the key twice.) */
  job: string;
  /** The streak length that logs the error line (from {@link failuresForWindow}). */
  escalateAfter: number;
  /** The worker's own warn line for the first failure of a streak. */
  failedMsg: string;
  /** The worker's own info line when a streak ends. */
  recoveredMsg: string;
  /** The field the recovery line carries the streak length in (default `failures`). */
  countField?: string;
}

export class FailureStreak {
  private count = 0;
  private readonly escalateAfter: number;

  constructor(private readonly options: FailureStreakOptions) {
    this.escalateAfter = Math.max(1, Math.floor(options.escalateAfter));
  }

  /** Consecutive failures in the current streak (0 when healthy). */
  get failures(): number {
    return this.count;
  }

  get failing(): boolean {
    return this.count > 0;
  }

  /** One failed attempt. `fields` go on the warn and error lines (e.g. `{ err }`, a code); never a name or a secret. */
  failure(fields: object = {}): void {
    this.count++;
    if (this.count === this.escalateAfter) {
      // The worker's own code (e.g. ALERT_DELIVERY_TICK_FAILED) is kept as `tickCode`; `code` is the alarm's.
      const { code: tickCode, ...rest } = fields as { code?: unknown };
      this.options.logger.error(
        { ...rest, ...(tickCode === undefined ? {} : { tickCode }), code: WORKER_FAILING_CODE, job: this.options.job, failures: this.count },
        WORKER_FAILING_MSG,
      );
    } else if (this.count === 1) {
      this.options.logger.warn(fields, this.options.failedMsg);
    }
  }

  /** One successful attempt: ends a streak (logging the recovery) or does nothing. */
  success(): void {
    if (this.count === 0) return;
    this.options.logger.info({ [this.options.countField ?? "failures"]: this.count }, this.options.recoveredMsg);
    this.count = 0;
  }
}
