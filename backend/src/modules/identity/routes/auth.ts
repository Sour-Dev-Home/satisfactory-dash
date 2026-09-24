import { Router } from "express";
import { createLoginRequestCap } from "./loginRequestCap.js";
import { LoginRequestSchema, SessionResponseSchema, endpoints } from "@satisfactory-dash/shared";
import type { LoginRateLimiter } from "../loginRateLimiter.js";
import { BadRequestError, RateLimitedError, UnauthorizedError } from "../../../platform/errorResponse.js";
import { clearSessionCookie, currentUser, readSessionCookie, revokeCurrentSession, setSessionCookie } from "../session.js";
import type { SessionDeps } from "../session.js";
import type { Authenticator } from "../authenticator.js";
import type { SessionUser } from "../sessionStore.js";
import { routePath } from "../../../platform/routePath.js";
import { sendValidated } from "../../../platform/sendValidated.js";
import { clientIp } from "../../../platform/clientIp.js";

/** The account as the contract's SessionResponse names it: never the internal id. */
function publicUser(user: SessionUser): { name: string; email?: string; authMethods?: string[] } {
  return {
    name: user.name,
    ...(user.email ? { email: user.email } : {}),
    ...(user.authMethods ? { authMethods: user.authMethods } : {}),
  };
}

export { LOGIN_REQUESTS_PER_WINDOW } from "./loginRequestCap.js";

/**
 * ADR-0011's auth endpoints. All three are exempt from the session guard (issue #19),
 * and GET /api/auth/session answers 200 { authenticated: false } when signed out,
 * never 401: it's how the frontend decides whether to show the login screen.
 */
export function createAuthRouter(
  deps: SessionDeps & {
    authenticator: Authenticator;
    rateLimiter: LoginRateLimiter;
    /** What the login screen may offer (SessionResponse.signInMethods). Password is always there until ADR-0025 PR 9. */
    signInMethods?: string[];
  },
): Router {
  const { authenticator, store, rateLimiter } = deps;
  const signInMethods = deps.signInMethods ?? ["password"];
  const router = Router();

  // Two layers. The LoginRateLimiter below blocks an IP after repeated FAILED logins,
  // which is what stops password guessing. The outer cap limits ALL login requests per IP.
  const loginRequestCap = createLoginRequestCap();

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
    const principal = await authenticator.verifyCredentials(parsed.data.username, parsed.data.password);
    if (!principal) {
      // Never log the submitted password -- nor the submitted username, since people
      // type their password into that field (found by the security review of PR #24).
      // Whether it named the real account is enough to investigate.
      req.log.warn({ ip, usernameMatched: authenticator.isActiveUser(parsed.data.username) }, "login failed");
      throw new UnauthorizedError("Invalid username or password");
    }
    // A database outage here is a 503 (ServiceUnavailableError), not a failed login.
    const session = await store.create(principal, readSessionCookie(req));
    // Only a completed sign-in clears the failure count: a correct password that ends in a 401
    // (disabled account) or a 503 must not reset it.
    rateLimiter.recordSuccess(ip);
    setSessionCookie(res, session.cookieValue, session.maxAgeSeconds);
    // The account id, never the username (privacy policy: sign-in logs carry ids).
    req.log.info({ ip, userId: session.user.id }, "login succeeded");
    sendValidated(res, SessionResponseSchema, { authenticated: true, signInMethods, user: publicUser(session.user) });
  });

  // Works with or without a session, and with no request body (the frontend sends
  // none), so signing out is always possible.
  router.post(routePath(endpoints.auth.logout.route), async (req, res) => {
    await revokeCurrentSession(req, deps);
    clearSessionCookie(res);
    sendValidated(res, SessionResponseSchema, { authenticated: false, signInMethods });
  });

  // "Sign out everywhere" (ADR-0025 decision 4): ends every session of the signed-in user, this
  // one included. With no valid session there is nothing to end; the answer is the same.
  router.post(routePath(endpoints.auth.logoutAll.route), async (req, res) => {
    const user = await currentUser(req, res, deps);
    if (user) {
      const ended = await store.revokeAllFor(user);
      req.log.info({ userId: user.id, ended }, "signed out everywhere");
    }
    await revokeCurrentSession(req, deps);
    clearSessionCookie(res);
    sendValidated(res, SessionResponseSchema, { authenticated: false, signInMethods });
  });

  router.get(routePath(endpoints.auth.session.route), async (req, res) => {
    const user = await currentUser(req, res, deps);
    sendValidated(
      res,
      SessionResponseSchema,
      user ? { authenticated: true, signInMethods, user: publicUser(user) } : { authenticated: false, signInMethods },
    );
  });

  return router;
}
