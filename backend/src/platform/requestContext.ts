import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { pinoHttp } from "pino-http";
import { requestLogLevel } from "./logLevel.js";
import type { Logger } from "pino";
import { timingLogFields } from "./requestTiming.js";

/**
 * ADR-0003: every response carries a fresh request id in X-Request-Id, and every log
 * line for the request is bound to it. An inbound X-Request-Id is deliberately
 * ignored: it isn't trustworthy until a proxy we control sets it, and a
 * client-chosen id could be used to muddy or collide with someone else's log trail.
 */
export function assignRequestId(req: Request, res: Response, next: NextFunction): void {
  const id = randomUUID();
  req.id = id;
  res.setHeader("X-Request-Id", id);
  next();
}

/** The route pattern the request matched (mount path plus route path), or undefined for a request no route handled.
 *  Exported for `platform/metrics/requestMetrics.ts` (ADR-0037): the same pattern used for logging is the metric's
 *  "route" label, since it is never the concrete URL a client sent (ids appear as `:paramName`, not their value). */
export function matchedRoute(req: Request): string | undefined {
  const pattern: unknown = req.route?.path;
  return typeof pattern === "string" ? `${req.baseUrl}${pattern}` : undefined;
}

/** pino-http reuses the `req.id` set above (it never generates its own when one
 *  exists), so the id in the header, the error body and the logs always match. */
export function createRequestLogger(logger: Logger): RequestHandler {
  return pinoHttp({
    logger,
    // Data hygiene (2026-10-21): a normal request line carries no client IP (privacy page: IPs are logged only on
    // sign-in and rate-limit events, which log it themselves). The default req serializer's remoteAddress is dropped below.
    // ADR-0032: where the request's time went (appMs, upstreamMs, vanillaMs, frmMs, upstreamCalls) and the route pattern it
    // matched (`/api/servers/:serverId/status`, never the concrete URL), which `npm run latency-report` groups by.
    customProps: (req, res) => ({
      ...timingLogFields(res as Response),
      route: matchedRoute(req as Request),
    }),
    customLogLevel: (req, res, err) => requestLogLevel(res.statusCode, err, (req as Request).originalUrl ?? req.url), // originalUrl: a mounted router strips the prefix from url
    // pino-http wraps this: it receives the standard serialized request (id, method, url, ...).
    serializers: {
      req: (req: { url: string; query?: unknown; remoteAddress?: unknown; remotePort?: unknown }) => {
        const { remoteAddress: _address, remotePort: _port, ...rest } = req;
        return { ...rest, url: logPath(req.url), query: undefined };
      },
    },
  });
}

/** A logged URL is its path only. The query string can hold a one-time code, a state or a search term, and has
 *  little diagnostic value (the Google callback's code and state were the first case, security review of ADR-0025 PR 7). */
const logPath = (url: string): string => url.split("?")[0] ?? url;
