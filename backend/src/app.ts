import express from "express";
import type { Express, RequestHandler, Router } from "express";
import cors from "cors";
import type { Logger } from "pino";
import { assignRequestId, createRequestLogger } from "./routes/requestContext.js";
import { createErrorHandler, RouteNotFoundError } from "./routes/errorResponse.js";
import { createCrossSiteGuard, requireJsonBody } from "./routes/session.js";

export interface AppOptions {
  logger: Logger;
  /** Mounted under /api with no session required (health, auth). */
  routers: Router[];
  /** Mounted under /api behind `sessionGuard` (ADR-0011). */
  protectedRouters?: Router[];
  sessionGuard?: RequestHandler;
  /** Exact origins allowed to call the API with credentials. Empty = no CORS. */
  allowedOrigins?: string[];
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
}: AppOptions): Express {
  if (protectedRouters.length > 0 && !sessionGuard) {
    throw new Error("createApp: protectedRouters require a sessionGuard");
  }
  const app = express();
  app.use(assignRequestId);
  app.use(createRequestLogger(logger));
  // ADR-0011: never a wildcard. Only the listed origins get CORS headers, with
  // credentials so the session cookie is sent. The Vite dev proxy is same-origin.
  app.use(cors({ origin: allowedOrigins.length > 0 ? allowedOrigins : false, credentials: true }));
  app.use("/api", createCrossSiteGuard(allowedOrigins));
  app.use("/api", requireJsonBody);
  app.use(express.json());
  for (const router of routers) {
    app.use("/api", router);
  }
  if (sessionGuard) {
    app.use("/api", sessionGuard);
  }
  for (const router of protectedRouters) {
    app.use("/api", router);
  }
  // Any /api path no router matched gets the not_found envelope rather than Express's
  // HTML 404 page, which the frontend can't parse. Paths outside /api are left alone.
  app.use("/api", (_req, _res, next) => {
    next(new RouteNotFoundError());
  });
  app.use(createErrorHandler(logger));
  return app;
}
