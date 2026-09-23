import { Router } from "express";
import { LoginRequestSchema, SessionResponseSchema, endpoints } from "@satisfactory-dash/shared";
import type { LoginRateLimiter } from "../services/auth/loginRateLimiter.js";
import { BadRequestError, RateLimitedError, UnauthorizedError } from "./errorResponse.js";
import { clearSessionCookie, currentUser, setSessionCookie } from "./session.js";
import type { SessionDeps } from "./session.js";
import { routePath } from "./serverScope.js";
import { sendValidated } from "./sendValidated.js";

/**
 * ADR-0011's auth endpoints. All three are exempt from the session guard (issue #19),
 * and GET /api/auth/session answers 200 { authenticated: false } when signed out,
 * never 401: it's how the frontend decides whether to show the login screen.
 */
export function createAuthRouter(deps: SessionDeps & { rateLimiter: LoginRateLimiter }): Router {
  const { authenticator, sessionSecret, rateLimiter } = deps;
  const router = Router();

  router.post(routePath(endpoints.auth.login.route), async (req, res) => {
    const ip = req.ip ?? "unknown";
    const retryAfter = rateLimiter.retryAfterSeconds(ip);
    if (retryAfter > 0) {
      req.log.warn({ ip }, "login rate-limited");
      throw new RateLimitedError(retryAfter);
    }
    const parsed = LoginRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Send a username and a password");
    }
    const user = await authenticator.verifyCredentials(parsed.data.username, parsed.data.password);
    if (!user) {
      rateLimiter.recordFailure(ip);
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
