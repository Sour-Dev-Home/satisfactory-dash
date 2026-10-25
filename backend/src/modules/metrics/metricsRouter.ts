import { Router } from "express";
import type { RequestHandler } from "express";
import { MetricsOverviewSchema, MetricsQuerySchema, endpoints } from "@satisfactory-dash/shared";
import { BadRequestError, RateLimitedError } from "../../platform/errorResponse.js";
import { routePath } from "../../platform/routePath.js";
import { sendValidated } from "../../platform/sendValidated.js";
import { UserRateLimiter } from "../../platform/userRateLimiter.js";
import { requireOperator, signedInUserId } from "../identity/index.js";
import type { MetricsService } from "./metricsService.js";

export interface MetricsRouterOptions {
  /** True for the seeded operator's user id (ADR-0056 section 3: the same rule as the servers routes). */
  isOperator: (userId: string) => boolean;
  /** Hold the page back until the operator is known (the servers are registered). */
  isReady?: () => boolean;
  limiter?: UserRateLimiter;
}

/** The page loads once and has a refresh button, so a human never gets near this; a script would. */
const READ_LIMIT = { max: 30, windowMs: 60 * 1000 };

/** ADR-0056 section 2 and 3: `GET /api/admin/metrics`, operator only (401 signed out, 403 anyone else). Mount after the session guard. */
export function createMetricsRouter(service: MetricsService, options: MetricsRouterOptions): Router {
  const limiter = options.limiter ?? new UserRateLimiter(READ_LIMIT);
  const gate = requireOperator({
    isOperator: options.isOperator,
    ...(options.isReady && { isReady: options.isReady }),
    forbiddenMessage: "Only the operator can read metrics.",
  });
  // After the gate, so a non-operator cannot use up the operator's window.
  const limited: RequestHandler = (_req, res, next) => {
    const retryAfter = limiter.hit(signedInUserId(res));
    if (retryAfter > 0) throw new RateLimitedError(retryAfter, "Too many requests. Try again later.");
    next();
  };

  const router = Router();
  const { overview } = endpoints.metrics;
  router.get(routePath(overview.route), gate, limited, async (req, res) => {
    const query = MetricsQuerySchema.safeParse(req.query);
    if (!query.success) throw new BadRequestError("Invalid request: window: expected one of 1h, 24h, 7d");
    sendValidated(res, MetricsOverviewSchema, await service.overview(query.data.window));
  });
  return router;
}
