import type { RequestHandler, Response } from "express";

/**
 * ADR-0032 step 1: how long a request took. The time goes into a `Server-Timing` header (`app;dur=12.3`) and onto the
 * request's log line (`appMs`), which `npm run latency-report` aggregates.
 *
 * ADR-0066 retired direct polling: the backend never calls a game server, so the old `upstream` part (the time the vanilla
 * API and FicsitRemoteMonitoring kept a request waiting) is gone, and `app` is the request's whole wall time.
 *
 * Nothing here is personal data: durations only.
 */
export interface TimingSummary {
  totalMs: number;
}

const FROZEN = Symbol("timing-summary");

const round1 = (ms: number): number => Math.round(ms * 10) / 10;

/** `app;dur=12.3`: milliseconds with one decimal. */
export function serverTimingValue(summary: TimingSummary): string {
  return `app;dur=${round1(summary.totalMs)}`;
}

/** The fields the request logger adds to a request's line. Only durations. */
export function timingLogFields(res: Response): Record<string, number> {
  const summary = frozenSummary(res);
  if (summary === undefined) return {};
  return { appMs: round1(summary.totalMs) };
}

const frozenSummary = (res: Response): TimingSummary | undefined => (res.locals as { [FROZEN]?: TimingSummary })[FROZEN];

/** The frozen summary for a finished response, or undefined if the request never went through
 *  `requestTiming()`. Exported for `platform/metrics/requestMetrics.ts` (ADR-0037): the request
 *  histogram's value is the same total the `Server-Timing` header and the log line already agree on. */
export const timingSummary = frozenSummary;

export interface RequestTimingOptions {
  /** The exact origins allowed to call the API (the frontend's). One of them, echoed back, is the `Timing-Allow-Origin`, so the
   *  browser lets the page read `serverTiming` from the resource timing entry. Empty: the header is never sent. */
  allowedOrigins?: string[];
  now?: () => number;
}

/**
 * Starts the request's timer and, right before the response headers go out, fixes the summary (so the header and the log
 * line agree) and writes `Server-Timing` and `Timing-Allow-Origin`.
 */
export function requestTiming(options: RequestTimingOptions = {}): RequestHandler {
  const now = options.now ?? (() => performance.now());
  const allowed = new Set(options.allowedOrigins ?? []);
  return (req, res, next) => {
    const startMs = now();
    const writeHead = res.writeHead;
    // Headers can only be added before the first byte: Node calls writeHead (explicitly, or through end/json) exactly then.
    res.writeHead = function patched(this: Response, ...args: Parameters<Response["writeHead"]>) {
      if (!this.headersSent && frozenSummary(this) === undefined) {
        const summary: TimingSummary = { totalMs: Math.max(0, now() - startMs) };
        (this.locals as { [FROZEN]?: TimingSummary })[FROZEN] = summary;
        this.setHeader("Server-Timing", serverTimingValue(summary));
        const origin = req.headers.origin;
        if (typeof origin === "string" && allowed.has(origin)) {
          this.setHeader("Timing-Allow-Origin", origin);
          this.vary("Origin");
        }
      }
      return writeHead.apply(this, args as never);
    } as Response["writeHead"];
    next();
  };
}
