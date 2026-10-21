import { Router } from "express";
import { CreateAgentServerRequestSchema, CreateAgentServerResponseSchema, endpoints } from "@satisfactory-dash/shared";
import { ForbiddenError, RateLimitedError, ServiceUnavailableError } from "../../platform/errorResponse.js";
import { routePath } from "../../platform/routePath.js";
import { sendValidated } from "../../platform/sendValidated.js";
import { UserRateLimiter } from "../../platform/userRateLimiter.js";
import { orUnavailable } from "./serverAccess.js";
import { parseBody, userId } from "./serverManagementRouter.js";
import type { SelfServeConfig } from "./selfServeConfig.js";
import type { SelfServeService } from "./selfServe.js";

/**
 * ADR-0046: POST /api/servers/agent, for any signed-in active account (the session guard refuses a disabled one). Mount
 * BEFORE the servers router, with the other collection routes, or "agent" would be read as a server id.
 *
 * - `SELF_SERVE_ENABLED` off: 403 `forbidden`, before anything else is looked at.
 * - Write-rate-limited per user like the management writes, and C5: at most `createsPerDay` creations per account in 24 h
 *   (in memory, 429). A create that fails (a cap, a bad body, an outage) is refunded, so only servers really created count.
 *   The operator's account is exempt from C5 as from every cap.
 */
export interface SelfServeRouterOptions {
  config: Pick<SelfServeConfig, "enabled" | "createsPerDay">;
  /** False until the database is up and the servers are loaded: answered with a 503. */
  isReady?: () => boolean;
  /** Injectable for tests. */
  writeLimiter?: UserRateLimiter;
  dailyLimiter?: UserRateLimiter;
}

const WRITE_LIMIT = { max: 30, windowMs: 15 * 60 * 1000 };
const DAY_MS = 24 * 60 * 60 * 1000;
const RATE_LIMITED_MESSAGE = "Too many requests. Try again later.";
const DAILY_LIMITED_MESSAGE = "You have added the most servers allowed in one day. Try again tomorrow.";

export function createSelfServeRouter(service: SelfServeService, options: SelfServeRouterOptions): Router {
  const writeLimiter = options.writeLimiter ?? new UserRateLimiter(WRITE_LIMIT);
  const dailyLimiter = options.dailyLimiter ?? new UserRateLimiter({ max: options.config.createsPerDay, windowMs: DAY_MS });
  const { createAgentServer } = endpoints.selfServe;

  const router = Router();
  router.post(routePath(createAgentServer.route), async (req, res) => {
    const actor = userId(res);
    if (!options.config.enabled) throw new ForbiddenError("Adding your own server is not available yet.");
    if (options.isReady && !options.isReady()) throw new ServiceUnavailableError();
    const retryAfter = writeLimiter.hit(actor);
    if (retryAfter > 0) throw new RateLimitedError(retryAfter, RATE_LIMITED_MESSAGE);
    const body = parseBody(CreateAgentServerRequestSchema, req.body);

    const exempt = service.isOperator(actor);
    if (!exempt) {
      // Counted up front (synchronously), so concurrent requests cannot all slip under the limit.
      const dailyRetry = dailyLimiter.hit(actor);
      if (dailyRetry > 0) {
        dailyLimiter.refund(actor); // a refused attempt is not a creation
        throw new RateLimitedError(dailyRetry, DAILY_LIMITED_MESSAGE);
      }
    }
    let server;
    try {
      server = await orUnavailable(() => service.create(actor, body));
    } catch (err) {
      if (!exempt) dailyLimiter.refund(actor);
      throw err;
    }
    res.status(201);
    sendValidated(res, CreateAgentServerResponseSchema, { server });
  });
  return router;
}
