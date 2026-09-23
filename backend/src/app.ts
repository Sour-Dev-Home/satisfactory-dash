import express from "express";
import type { Express, Router } from "express";
import cors from "cors";
import type { Logger } from "pino";
import { assignRequestId, createRequestLogger } from "./routes/requestContext.js";
import { createErrorHandler } from "./routes/errorResponse.js";

/**
 * The middleware pipeline, with no side effects, so tests build exactly what
 * production runs: request id -> request logging -> routes under /api -> the error
 * envelope. server.ts supplies the real routers and logger.
 */
export function createApp({ logger, routers }: { logger: Logger; routers: Router[] }): Express {
  const app = express();
  app.use(assignRequestId);
  app.use(createRequestLogger(logger));
  app.use(cors());
  app.use(express.json());
  for (const router of routers) {
    app.use("/api", router);
  }
  app.use(createErrorHandler(logger));
  return app;
}
