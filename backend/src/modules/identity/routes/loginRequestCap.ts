import type { Request, RequestHandler, Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import type { ClientRateLimitInfo } from "express-rate-limit";
import { RateLimitedError } from "../../../platform/errorResponse.js";
import { clientIp } from "../../../platform/clientIp.js";

/** Outer cap on every login request per IP, whatever its outcome. */
export const LOGIN_REQUESTS_PER_WINDOW = 20;
const LOGIN_REQUEST_WINDOW_MS = 15 * 60 * 1000;

/**
 * Limits ALL requests of the routes it guards per IP (malformed ones, rate-limited retries,
 * repeated successes), so no request pattern is unbounded. Added after CodeQL
 * (js/missing-rate-limiting) flagged the login route on PR #24. One instance per call, so each
 * router gets its own counters.
 */
export function createLoginRequestCap(what = "login", onLimited?: (req: Request, res: Response) => void): RequestHandler {
  return rateLimit({
    windowMs: LOGIN_REQUEST_WINDOW_MS,
    limit: LOGIN_REQUESTS_PER_WINDOW,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    // The real client IP, trusting CF-Connecting-IP only from the local tunnel
    // (clientIp.ts); IPv6 grouped by /56 like the failure limiter.
    keyGenerator: (req) => ipKeyGenerator(clientIp(req), 56),
    // Cloudflare adds X-Forwarded-For while Express's `trust proxy` stays off on
    // purpose; client IP resolution is handled by clientIp, so skip that self-check.
    validate: { xForwardedForHeader: false },
    handler: (req, res, next) => {
      // express-rate-limit sets req.rateLimit, but its type augmentation doesn't reach
      // Express 5's Request type.
      const info = (req as Request & { rateLimit?: ClientRateLimitInfo }).rateLimit;
      const resetTime = info?.resetTime?.getTime() ?? Date.now() + LOGIN_REQUEST_WINDOW_MS;
      req.log.warn({ ip: clientIp(req), code: "rate_limited" }, `${what} request cap reached`);
      if (onLimited) {
        // A top-level browser navigation (the Google sign-in routes): never a JSON page at the API host.
        onLimited(req, res);
        return;
      }
      next(new RateLimitedError(Math.max(1, Math.ceil((resetTime - Date.now()) / 1000))));
    },
  });
}
