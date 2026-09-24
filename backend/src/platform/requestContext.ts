import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { pinoHttp } from "pino-http";
import { requestLogLevel } from "./logLevel.js";
import type { Logger } from "pino";
import { clientIp } from "./clientIp.js";

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

/** pino-http reuses the `req.id` set above (it never generates its own when one
 *  exists), so the id in the header, the error body and the logs always match. */
export function createRequestLogger(logger: Logger): RequestHandler {
  return pinoHttp({
    logger,
    // Behind the tunnel the raw socket address (req.remoteAddress) is 127.0.0.1 for
    // everyone, so each line also names the resolved caller. Keeping both makes a
    // spoofed CF-Connecting-IP visible as a mismatch (architect request, go-live).
    customProps: (req) => ({ clientIp: clientIp(req) }),
    customLogLevel: (_req, res, err) => requestLogLevel(res.statusCode, err),
    // pino-http wraps this: it receives the standard serialized request (id, method, url, ...).
    serializers: {
      req: (req: { url: string; query?: unknown }) =>
        isGoogleCallback(req.url) ? { ...req, url: GOOGLE_CALLBACK_PATH, query: undefined } : req,
    },
  });
}

/** The Google sign-in callback's query holds a one-time authorization code and the state: the log
 *  keeps the path only (security review of ADR-0025 PR 7). */
const GOOGLE_CALLBACK_PATH = "/api/auth/google/callback";
const isGoogleCallback = (url: string): boolean => url.startsWith(GOOGLE_CALLBACK_PATH);
