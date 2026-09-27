import type { Logger } from "pino";
import type { Request, RequestHandler, Response } from "express";
import { matchedRoute } from "../requestContext.js";
import { timingSummary } from "../requestTiming.js";
import { formatErrorDetail } from "../formatErrorDetail.js";
import type { MetricsAggregator } from "./aggregator.js";

/** "2xx".."5xx"; anything outside 1xx-5xx (never happens over HTTP) clamps to the nearest end
 *  rather than producing a label value the registry would refuse. */
function statusClass(status: number): string {
  const hundreds = Math.min(Math.max(Math.floor(status / 100), 1), 5);
  return `${hundreds}xx`;
}

/**
 * ADR-0037 §1/§2, `http.server.request.duration`: records the request's total time (the same
 * number the `Server-Timing` header and the request log line already show) with the route pattern
 * it matched and its status class. Mounted after `requestTiming()` (app.ts), so the summary this
 * reads is already frozen by the time `finish` fires.
 *
 * An unmatched request (404, or one that never reached routing) has no route pattern — never one of
 * the closed label set the registry expects — so it is skipped rather than forced into a label like
 * "unmatched", which would let every distinct 404'd path spam a metric with an unbounded label. A
 * recording failure is caught and logged, never left to reach an unhandled 'error' inside a
 * `res.on("finish")` listener, which would crash the process over a metrics bug.
 */
export function requestMetrics(aggregator: MetricsAggregator, logger: Logger): RequestHandler {
  return (req: Request, res: Response, next) => {
    res.on("finish", () => {
      try {
        const route = matchedRoute(req);
        if (route === undefined) return;
        const summary = timingSummary(res);
        if (summary === undefined) return;
        aggregator.recordHistogram("http.server.request.duration", { route, status_class: statusClass(res.statusCode) }, summary.totalMs);
      } catch (err) {
        logger.warn({ err: formatErrorDetail(err) }, "failed to record http.server.request.duration");
      }
    });
    next();
  };
}
