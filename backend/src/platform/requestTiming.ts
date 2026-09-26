import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestHandler, Response } from "express";

/**
 * ADR-0032 step 1: where a request's time went. Two numbers matter to someone reading a slow request: how long the
 * game server (the "upstream": the vanilla API and FicsitRemoteMonitoring) kept it waiting, and how long this app took
 * itself ("app": everything else, queueing and the database included).
 *
 * Every request gets a timer (AsyncLocalStorage, so the game-server clients, which do not know about Express, report into
 * the right request). The adapter tells `recordUpstreamCall` when each call to the game server ran; the upstream time of
 * a request is the UNION of those intervals, not their sum: two calls made in parallel that each take 200 ms kept the
 * request waiting 200 ms, not 400. `app` is the rest of the request's wall time. The result goes into a `Server-Timing`
 * header (`app;dur=12.3, upstream;dur=45.6`) and onto the request's log line (appMs, upstreamMs, vanillaMs, frmMs,
 * upstreamCalls), which `npm run latency-report` aggregates.
 *
 * Nothing here is personal data: durations and counts only.
 */
export type UpstreamName = "vanilla" | "frm";

export interface UpstreamInterval {
  upstream: UpstreamName;
  /** performance.now() milliseconds. */
  startMs: number;
  endMs: number;
}

export interface RequestTiming {
  startMs: number;
  calls: UpstreamInterval[];
  /** How many calls were reported, including ones past the stored maximum. */
  callCount: number;
}

export interface TimingSummary {
  totalMs: number;
  /** Union of every upstream call's interval. */
  upstreamMs: number;
  /** totalMs - upstreamMs. */
  appMs: number;
  /** Union of the vanilla API's intervals / FRM's intervals. */
  vanillaMs: number;
  frmMs: number;
  upstreamCalls: number;
}

/** One request cannot grow the list without bound (a page that polls in a loop would). Calls past this count still count. */
export const MAX_STORED_CALLS = 200;

const store = new AsyncLocalStorage<RequestTiming>();
const FROZEN = Symbol("timing-summary");

/** Reports one call to the game server. A no-op outside a request (the pollers, startup), so it is safe to hand to the adapter. */
export function recordUpstreamCall(call: UpstreamInterval): void {
  const timing = store.getStore();
  if (timing === undefined) return;
  timing.callCount++;
  if (timing.calls.length < MAX_STORED_CALLS) timing.calls.push(call);
}

/** The total length covered by a set of intervals, clipped to [from, to] and merged where they overlap. */
export function unionMs(intervals: { startMs: number; endMs: number }[], from: number, to: number): number {
  const clipped = intervals
    .map(({ startMs, endMs }) => ({ startMs: Math.max(startMs, from), endMs: Math.min(endMs, to) }))
    .filter(({ startMs, endMs }) => endMs > startMs)
    .sort((a, b) => a.startMs - b.startMs);
  let covered = 0;
  let runStart = 0;
  let runEnd = -Infinity;
  for (const { startMs, endMs } of clipped) {
    if (startMs > runEnd) {
      covered += runEnd - runStart > 0 ? runEnd - runStart : 0;
      runStart = startMs;
      runEnd = endMs;
    } else if (endMs > runEnd) {
      runEnd = endMs;
    }
  }
  return covered + (runEnd - runStart > 0 ? runEnd - runStart : 0);
}

export function summarize(timing: RequestTiming, nowMs: number): TimingSummary {
  const totalMs = Math.max(0, nowMs - timing.startMs);
  const upstreamMs = unionMs(timing.calls, timing.startMs, nowMs);
  return {
    totalMs,
    upstreamMs,
    appMs: Math.max(0, totalMs - upstreamMs),
    vanillaMs: unionMs(timing.calls.filter((c) => c.upstream === "vanilla"), timing.startMs, nowMs),
    frmMs: unionMs(timing.calls.filter((c) => c.upstream === "frm"), timing.startMs, nowMs),
    upstreamCalls: timing.callCount,
  };
}

const round1 = (ms: number): number => Math.round(ms * 10) / 10;

/** `app;dur=12.3, upstream;dur=45.6`: milliseconds with one decimal, always both metrics (upstream is 0 when the game was not called). */
export function serverTimingValue(summary: TimingSummary): string {
  return `app;dur=${round1(summary.appMs)}, upstream;dur=${round1(summary.upstreamMs)}`;
}

/** The fields the request logger adds to a request's line. Only durations and counts. */
export function timingLogFields(res: Response): Record<string, number> {
  const summary = frozenSummary(res);
  if (summary === undefined) return {};
  return {
    appMs: round1(summary.appMs),
    upstreamMs: round1(summary.upstreamMs),
    vanillaMs: round1(summary.vanillaMs),
    frmMs: round1(summary.frmMs),
    upstreamCalls: summary.upstreamCalls,
  };
}

const frozenSummary = (res: Response): TimingSummary | undefined => (res.locals as { [FROZEN]?: TimingSummary })[FROZEN];

export interface RequestTimingOptions {
  /** The exact origins allowed to call the API (the frontend's). One of them, echoed back, is the `Timing-Allow-Origin`, so the
   *  browser lets the page read `serverTiming` from the resource timing entry. Empty: the header is never sent. */
  allowedOrigins?: string[];
  now?: () => number;
}

/**
 * Starts the request's timer, runs the rest of the request inside it, and, right before the response headers go out,
 * fixes the summary (so the header and the log line agree) and writes `Server-Timing` and `Timing-Allow-Origin`.
 */
export function requestTiming(options: RequestTimingOptions = {}): RequestHandler {
  const now = options.now ?? (() => performance.now());
  const allowed = new Set(options.allowedOrigins ?? []);
  return (req, res, next) => {
    const timing: RequestTiming = { startMs: now(), calls: [], callCount: 0 };
    const writeHead = res.writeHead;
    // Headers can only be added before the first byte: Node calls writeHead (explicitly, or through end/json) exactly then.
    res.writeHead = function patched(this: Response, ...args: Parameters<Response["writeHead"]>) {
      if (!this.headersSent && frozenSummary(this) === undefined) {
        const summary = summarize(timing, now());
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
    store.run(timing, next);
  };
}
