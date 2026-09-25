import { monitorEventLoopDelay } from "node:perf_hooks";
import { ConfigError } from "./errors.js";

/**
 * Diagnostic (architect request): prod showed machine-wide stalls (FRM connect ETIMEDOUT, database
 * probe misses for one to eighty seconds). To tell a Windows-level stall from our own event loop
 * being blocked (the file log stream writes synchronously, so a slow disk would block the loop),
 * this measures the loop's delay with perf_hooks' histogram and, once per window, logs ONE warn when
 * the worst delay crossed a threshold. Numbers only. It changes no response and holds no state
 * beyond the histogram: the timer is unref'd (it never keeps the process alive) and stopped on
 * shutdown.
 *
 * The histogram's values include its own 20 ms timer resolution, so a healthy idle loop reads
 * about 20 ms; the default threshold is far above that.
 */

export const DEFAULT_EVENT_LOOP_STALL_MS = 500;
const MIN_STALL_MS = 50;
const MAX_STALL_MS = 60_000;
export const EVENT_LOOP_WINDOW_MS = 30_000;
const RESOLUTION_MS = 20;
const NS_PER_MS = 1_000_000;

/** EVENT_LOOP_STALL_MS: whole milliseconds, 50-60000; blank or unset means the default. */
export function loadEventLoopStallMs(env: NodeJS.ProcessEnv = process.env): number {
  const text = env.EVENT_LOOP_STALL_MS?.trim();
  if (!text) {
    return DEFAULT_EVENT_LOOP_STALL_MS;
  }
  const value = /^\d{1,6}$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isInteger(value) || value < MIN_STALL_MS || value > MAX_STALL_MS) {
    throw new ConfigError(`EVENT_LOOP_STALL_MS must be a whole number from ${MIN_STALL_MS} to ${MAX_STALL_MS} (or unset for ${DEFAULT_EVENT_LOOP_STALL_MS}).`);
  }
  return value;
}

/** The part of perf_hooks' IntervalHistogram this uses (values in nanoseconds), so tests can fake it. */
export interface DelayHistogram {
  enable(): boolean;
  disable(): boolean;
  reset(): void;
  readonly max: number;
  readonly mean: number;
  percentile(p: number): number;
}

export interface EventLoopMonitorOptions {
  logger: { warn(obj: object, msg: string): void };
  /** Log when a window's worst delay exceeds this many ms. */
  thresholdMs: number;
  windowMs?: number;
  /** Injected for tests. */
  histogram?: DelayHistogram;
}

const toMs = (ns: number) => Math.round((ns / NS_PER_MS) * 10) / 10;

export interface EventLoopMonitor {
  start(): void;
  stop(): Promise<void>;
  /** Reads and resets the current window now (the timer calls this; exposed for tests). */
  check(): void;
}

export function createEventLoopMonitor(options: EventLoopMonitorOptions): EventLoopMonitor {
  const histogram: DelayHistogram = options.histogram ?? monitorEventLoopDelay({ resolution: RESOLUTION_MS });
  let timer: NodeJS.Timeout | undefined;

  const check = () => {
    const maxMs = toMs(histogram.max);
    if (maxMs > options.thresholdMs) {
      options.logger.warn(
        { code: "event_loop_stall", max_ms: maxMs, p99_ms: toMs(histogram.percentile(99)), mean_ms: toMs(histogram.mean) },
        "event loop stalled",
      );
    }
    // Every window starts empty, so one stall is reported once, not again in the next window.
    histogram.reset();
  };

  return {
    check,
    start() {
      if (timer !== undefined) {
        return;
      }
      histogram.enable();
      // A diagnostic must never take the process down: an exception inside a timer callback would
      // be uncaught, so a failing log call is dropped.
      timer = setInterval(() => {
        try {
          check();
        } catch {
          // ignore
        }
      }, options.windowMs ?? EVENT_LOOP_WINDOW_MS);
      timer.unref();
    },
    async stop() {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
        histogram.disable();
      }
    },
  };
}
