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
 * - Write-rate-limited per user like the management writes. C5 (at most `createsPerDay` creations per account in any 24 h,
 *   429 with Retry-After) is the service's: since #526 it counts the server rows the account created, in the create
 *   transaction, so it survives a restart and only servers really created count. The operator is exempt, as from every cap.
 */
export interface SelfServeRouterOptions {
  config: Pick<SelfServeConfig, "enabled">;
  /** False until the database is up and the servers are loaded: answered with a 503. */
  isReady?: () => boolean;
  /** Injectable for tests. */
  writeLimiter?: UserRateLimiter;
}

const WRITE_LIMIT = { max: 30, windowMs: 15 * 60 * 1000 };
const RATE_LIMITED_MESSAGE = "Too many requests. Try again later.";

export function createSelfServeRouter(service: SelfServeService, options: SelfServeRouterOptions): Router {
  const writeLimiter = options.writeLimiter ?? new UserRateLimiter(WRITE_LIMIT);
  const { createAgentServer } = endpoints.selfServe;

  const router = Router();
  router.post(routePath(createAgentServer.route), async (req, res) => {
    const actor = userId(res);
    if (!options.config.enabled) throw new ForbiddenError("Adding your own server is not available yet.");
    if (options.isReady && !options.isReady()) throw new ServiceUnavailableError();
    const retryAfter = writeLimiter.hit(actor);
    if (retryAfter > 0) throw new RateLimitedError(retryAfter, RATE_LIMITED_MESSAGE);
    const body = parseBody(CreateAgentServerRequestSchema, req.body);
    const server = await orUnavailable(() => service.create(actor, body));
    res.status(201);
    sendValidated(res, CreateAgentServerResponseSchema, { server });
  });
  return router;
}
