import { Router } from "express";
import type { Request, Response } from "express";
import {
  CompatResponseSchema,
  PairingApproveRequestSchema,
  PairingApproveResponseSchema,
  PairingLookupRequestSchema,
  PairingLookupResponseSchema,
  endpoints,
} from "@satisfactory-dash/shared";
import { BadRequestError, RateLimitedError, ServiceUnavailableError, UnauthorizedError } from "../../../platform/errorResponse.js";
import { routePath } from "../../../platform/routePath.js";
import { sendValidated } from "../../../platform/sendValidated.js";
import { UserRateLimiter } from "../../../platform/userRateLimiter.js";
import {
  COMPAT_POLICY,
  PAIRING_ENTRY_PER_ACCOUNT_PER_HOUR,
  PAIRING_ENTRY_PER_ACCOUNT_PER_MINUTE,
  PAIRING_ENTRY_PER_NETWORK_PER_MINUTE,
} from "../config.js";
import { rateLimitKey } from "../services/clientKey.js";
import type { PairingService } from "../services/pairingService.js";

export interface PairingUserRouterOptions {
  /** False until the database is up and the servers are loaded: answered with a 503. */
  isReady?: () => boolean;
  /** True for the operator's account (exempt from the hourly entry limit, as from C7). */
  isOperator: (userId: string) => boolean;
  /** Per account, per minute (default 10). */
  minuteLimiter?: UserRateLimiter;
  /** Per account, per hour (default 20). */
  hourlyLimiter?: UserRateLimiter;
  /** Per client network, per minute (default 30). */
  networkLimiter?: UserRateLimiter;
}

const RATE_LIMITED_MESSAGE = "Too many pairing code tries. Wait a moment and try again.";

/**
 * ADR-0051 section 1: the owner's side of device-code pairing (a signed-in session, mounted behind the session guard):
 * `lookup` shows who is asking, `approve` lets them in. The 60-bit code is a guess target for anyone signed in, so every
 * try, hit or miss, spends the entry budgets BEFORE the code is looked at, and every refusal about the code is the same
 * 404 (the service's). Rate limits are per account (10 a minute, 20 an hour, like C7) and per client network.
 */
export function createPairingUserRouter(service: PairingService, options: PairingUserRouterOptions): Router {
  const router = Router();
  const minuteLimiter = options.minuteLimiter ?? new UserRateLimiter({ max: PAIRING_ENTRY_PER_ACCOUNT_PER_MINUTE, windowMs: 60_000 });
  const hourlyLimiter = options.hourlyLimiter ?? new UserRateLimiter({ max: PAIRING_ENTRY_PER_ACCOUNT_PER_HOUR, windowMs: 3_600_000 });
  const networkLimiter = options.networkLimiter ?? new UserRateLimiter({ max: PAIRING_ENTRY_PER_NETWORK_PER_MINUTE, windowMs: 60_000 });
  const { lookup, approve } = endpoints.pairings;

  const actorOf = (res: Response): string => {
    const id: unknown = res.locals.user?.id;
    if (typeof id !== "string") throw new UnauthorizedError("Sign in to continue");
    return id;
  };
  /** Spends one try of the entry budget; throws 429 when over. A refused later budget gives the earlier hits back. */
  const spendEntry = (req: Request, actor: string): void => {
    if (options.isReady && !options.isReady()) throw new ServiceUnavailableError();
    const network = rateLimitKey(req);
    const networkWait = networkLimiter.hit(network);
    if (networkWait > 0) throw new RateLimitedError(networkWait, RATE_LIMITED_MESSAGE);
    const minuteWait = minuteLimiter.hit(actor);
    if (minuteWait > 0) throw new RateLimitedError(minuteWait, RATE_LIMITED_MESSAGE);
    if (!options.isOperator(actor)) {
      const hourWait = hourlyLimiter.hit(actor);
      if (hourWait > 0) {
        minuteLimiter.refund(actor);
        throw new RateLimitedError(hourWait, RATE_LIMITED_MESSAGE);
      }
    }
  };

  router.post(routePath(lookup.route), async (req, res) => {
    const actor = actorOf(res);
    spendEntry(req, actor);
    const body = PairingLookupRequestSchema.safeParse(req.body);
    if (!body.success) throw new BadRequestError("The request body is not valid");
    sendValidated(res, PairingLookupResponseSchema, await service.lookup(body.data.userCode));
  });

  router.post(routePath(approve.route), async (req, res) => {
    const actor = actorOf(res);
    spendEntry(req, actor);
    const body = PairingApproveRequestSchema.safeParse(req.body);
    if (!body.success) throw new BadRequestError("The request body is not valid");
    sendValidated(res, PairingApproveResponseSchema, await service.approve(actor, body.data));
  });

  return router;
}

/** ADR-0057 D6 to D8, GET /api/compat: the version policy (config.ts for now; a table later), for any signed-in account. */
export function createCompatRouter(): Router {
  const router = Router();
  router.get(routePath(endpoints.compat.route), (_req, res) => {
    sendValidated(res, CompatResponseSchema, COMPAT_POLICY);
  });
  return router;
}
