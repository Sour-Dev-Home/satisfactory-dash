import { Router } from "express";
import type { Request } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import type { ClientRateLimitInfo } from "express-rate-limit";
import { LoginRequestSchema, SessionResponseSchema, endpoints } from "@satisfactory-dash/shared";
import type { LoginRateLimiter } from "../services/auth/loginRateLimiter.js";
import { BadRequestError, RateLimitedError, UnauthorizedError } from "./errorResponse.js";
import { clearSessionCookie, currentUser, setSessionCookie } from "./session.js";
import type { SessionDeps } from "./session.js";
import { routePath } from "./serverScope.js";
import { sendValidated } from "./sendValidated.js";
import { clientIp } from "./clientIp.js";

/** Outer cap on every login request per IP, whatever its outcome (see below). */
export const LOGIN_REQUESTS_PER_WINDOW = 20;
const LOGIN_REQUEST_WINDOW_MS = 15 * 60 * 1000;

/**
 * ADR-0011's auth endpoints. All three are exempt from the session guard (issue #19),
 * and GET /api/auth/session answers 200 { authenticated: false } when signed out,
 * never 401: it's how the frontend decides whether to show the login screen.
 */
export function createAuthRouter(deps: SessionDeps & { rateLimiter: LoginRateLimiter }): Router {
  const { authenticator, sessionSecret, rateLimiter } = deps;
  const router = Router();

  // Two layers. The LoginRateLimiter below blocks an IP after repeated FAILED logins,
  // which is what stops password guessing. This outer cap limits ALL login requests
  // per IP (malformed ones, rate-limited retries, repeated successes), so no request
  // pattern is unbounded. Added after CodeQL (js/missing-rate-limiting) flagged the
  // route on PR #24. One instance per router, so each app gets its own counters.
  const loginRequestCap = rateLimit({
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
    handler: (req, _res, next) => {
      // express-rate-limit sets req.rateLimit, but its type augmentation doesn't reach
      // Express 5's Request type.
      const info = (req as Request & { rateLimit?: ClientRateLimitInfo }).rateLimit;
      const resetTime = info?.resetTime?.getTime() ?? Date.now() + LOGIN_REQUEST_WINDOW_MS;
      req.log.warn({ ip: clientIp(req) }, "login request cap reached");
      next(new RateLimitedError(Math.max(1, Math.ceil((resetTime - Date.now()) / 1000))));
    },
  });

  router.post(routePath(endpoints.auth.login.route), loginRequestCap, async (req, res) => {
    const ip = clientIp(req);
    const retryAfter = rateLimiter.retryAfterSeconds(ip);
    if (retryAfter > 0) {
      req.log.warn({ ip }, "login rate-limited");
      throw new RateLimitedError(retryAfter);
    }
    const parsed = LoginRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Send a username and a password");
    }
    // Count the attempt BEFORE the slow password check and clear it on success.
    // Counting only after a failure let parallel guesses all get through before any
    // was recorded (found by PR #24's fresh-eyes review).
    rateLimiter.recordFailure(ip);
    const user = await authenticator.verifyCredentials(parsed.data.username, parsed.data.password);
    if (!user) {
      // Never log the submitted password.
      req.log.warn({ ip, username: parsed.data.username }, "login failed");
      throw new UnauthorizedError("Invalid username or password");
    }
    rateLimiter.recordSuccess(ip);
    setSessionCookie(res, user, sessionSecret);
    req.log.info({ ip, username: user.name }, "login succeeded");
    sendValidated(res, SessionResponseSchema, { authenticated: true, user });
  });

  // Works with or without a session, and with no request body (the frontend sends
  // none), so signing out is always possible.
  router.post(routePath(endpoints.auth.logout.route), (_req, res) => {
    clearSessionCookie(res);
    sendValidated(res, SessionResponseSchema, { authenticated: false });
  });

  router.get(routePath(endpoints.auth.session.route), (req, res) => {
    const user = currentUser(req, { authenticator, sessionSecret });
    sendValidated(res, SessionResponseSchema, user ? { authenticated: true, user } : { authenticated: false });
  });

  return router;
}
