import { classifyStartupError, DatabaseSetupError } from "./errors.js";

/**
 * ADR-0025 decision 6, startup: retry only transient errors (the boot race: refused connection,
 * 57P03) with backoff, then give up after a deadline so the Scheduled Task's "restart on failure"
 * takes over; fail fast on everything else. The process is already serving liveness meanwhile.
 */
export interface StartupLogger {
  warn(obj: object, msg: string): void;
}

export interface BackoffOptions {
  logger: StartupLogger;
  initialDelayMs?: number;
  maxDelayMs?: number;
  deadlineMs?: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export const DEFAULT_INITIAL_DELAY_MS = 1_000;
export const DEFAULT_MAX_DELAY_MS = 30_000;
export const DEFAULT_DEADLINE_MS = 5 * 60_000;

/** Runs `attempt` until it succeeds. Throws a DatabaseSetupError (which the composition root
 *  turns into exit 1) on a fatal error or when the deadline passes; the message never quotes the
 *  driver's error, which can contain the connection URL. */
export async function connectWithBackoff<T>(attempt: () => Promise<T>, options: BackoffOptions): Promise<T> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const maxDelay = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const deadline = now() + (options.deadlineMs ?? DEFAULT_DEADLINE_MS);
  let delay = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  for (let attemptNumber = 1; ; attemptNumber++) {
    try {
      return await attempt();
    } catch (err) {
      const verdict = classifyStartupError(err);
      // Reasons may already end with a period (the schema messages do).
      const reason = verdict.reason.replace(/\.$/, "");
      if (verdict.kind === "fatal") {
        throw new DatabaseSetupError(`Cannot start: ${reason}.`);
      }
      if (now() + delay > deadline) {
        throw new DatabaseSetupError(`Cannot start: ${reason}, and it did not come up before the startup deadline.`);
      }
      options.logger.warn({ attempt: attemptNumber, retryInMs: delay }, `database not ready: ${reason}`);
      await sleep(delay);
      delay = Math.min(delay * 2, maxDelay);
    }
  }
}
