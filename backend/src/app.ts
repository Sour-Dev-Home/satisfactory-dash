import express from "express";
import type { Express, RequestHandler, Router } from "express";
import cors from "cors";
import type { Logger } from "pino";
import { assignRequestId, createRequestLogger } from "./platform/requestContext.js";
import { createErrorHandler, RouteNotFoundError } from "./platform/errorResponse.js";
import { requestTiming } from "./platform/requestTiming.js";
import { createCrossSiteGuard, requireJsonBody, securityHeaders } from "./platform/httpPolicy.js";

export interface AppOptions {
  logger: Logger;
  /** Mounted under /api with no session required (health, auth). */
  routers: Router[];
  /** Mounted under /api behind `sessionGuard` (ADR-0011). */
  protectedRouters?: Router[];
  sessionGuard?: RequestHandler;
  /** Exact origins allowed to call the API with credentials. Empty = no CORS. */
  allowedOrigins?: string[];
  /** ADR-0031 PR 5a: the edge agent's API, mounted at /agent/v1. No session guard, no cross-site guard and no
   *  JSON-body policy of /api (an agent is not a browser); each route authenticates its own way and parses its own body. */
  agentRouters?: Router[];
}

/**
 * The middleware pipeline, with no side effects, so tests build exactly what
 * production runs: request id -> request logging -> CORS allowlist -> JSON-only
 * mutations -> public routes -> session guard -> protected routes -> a /api catch-all
 * -> the error envelope. server.ts supplies the real routers, guard and logger.
 *
 * The guard sits BEFORE the catch-all, so a signed-out client gets 401 for any other
 * /api path and can't probe which routes exist.
 */
export function createApp({
  logger,
  routers,
  protectedRouters = [],
  sessionGuard,
  allowedOrigins = [],
  agentRouters = [],
}: AppOptions): Express {
  if (protectedRouters.length > 0 && !sessionGuard) {
    throw new Error("createApp: protectedRouters require a sessionGuard");
  }
  const app = express();
  app.disable("x-powered-by");
  app.use(assignRequestId);
  // ADR-0032: the request's timer (app time vs game-server time): the Server-Timing header and the log line's fields.
  app.use(requestTiming({ allowedOrigins }));
  // Before CORS so a preflight answer carries them too (ADR-0019).
  app.use("/api", securityHeaders);
  // The agent API's responses (an enrolment answer holds the credential) are never cached either.
  app.use("/agent", securityHeaders);
  app.use(createRequestLogger(logger));
  // ADR-0011: never a wildcard. Only the listed origins get CORS headers, with
  // credentials so the session cookie is sent. The Vite dev proxy is same-origin.
  app.use(cors({ origin: allowedOrigins.length > 0 ? allowedOrigins : false, credentials: true }));
  app.use("/api", createCrossSiteGuard(allowedOrigins));
  app.use("/api", requireJsonBody);
  // /api only: the agent API parses its own bodies (a snapshot is far larger than any /api body).
  app.use("/api", express.json());
  for (const router of routers) {
    app.use("/api", router);
  }
  if (sessionGuard) {
    app.use("/api", sessionGuard);
  }
  for (const router of protectedRouters) {
    app.use("/api", router);
  }
  // ADR-0031 PR 5a: the agent API, with its own catch-all so an unknown /agent path gets the same envelope.
  for (const router of agentRouters) {
    app.use("/agent/v1", router);
  }
  app.use("/agent", (_req, _res, next) => {
    next(new RouteNotFoundError());
  });
  // Any /api path no router matched gets the not_found envelope rather than Express's
  // HTML 404 page, which the frontend can't parse. Paths outside /api are left alone.
  app.use("/api", (_req, _res, next) => {
    next(new RouteNotFoundError());
  });
  app.use(createErrorHandler(logger));
  return app;
}
