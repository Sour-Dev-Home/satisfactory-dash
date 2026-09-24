import type { CookieOptions, Request, RequestHandler, Response } from "express";
import { parse as parseCookies } from "cookie";
import type { Authenticator, AuthenticatedUser } from "./authenticator.js";
import type { SessionDenylist } from "./sessionDenylist.js";
import { SESSION_TTL_SECONDS, createSessionToken, readSessionToken } from "./sessionToken.js";
import type { VerifiedSession } from "./sessionToken.js";
import { UnauthorizedError } from "../../platform/errorResponse.js";

export const SESSION_COOKIE = "sd_session";

/**
 * ADR-0011: httpOnly (no script access), Secure, SameSite=Lax, expiring, and scoped to
 * /api. Browsers accept Secure cookies on http://localhost, so local development
 * behaves like production (with the Vite /api proxy, ADR-0013).
 */
const COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/api",
};

export interface SessionDeps {
  authenticator: Authenticator;
  sessionSecret: string;
  /** Sessions signed out before their token expired (ADR-0019). */
  denylist: SessionDenylist;
}

export function setSessionCookie(res: Response, user: AuthenticatedUser, secret: string): void {
  res.cookie(SESSION_COOKIE, createSessionToken(user.name, secret), {
    ...COOKIE_OPTIONS,
    maxAge: SESSION_TTL_SECONDS * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS);
}

/** The verified, not-signed-out session this request carries, or null. Never throws. */
function requestSession(req: Request, { sessionSecret, denylist }: SessionDeps): VerifiedSession | null {
  try {
    const token = parseCookies(req.headers.cookie ?? "")[SESSION_COOKIE];
    if (!token) {
      return null;
    }
    const session = readSessionToken(token, sessionSecret);
    return session !== null && !denylist.isRevoked(session.jti) ? session : null;
  } catch {
    return null;
  }
}

/** The signed-in user for this request, or null. Never throws. */
export function currentUser(req: Request, deps: SessionDeps): AuthenticatedUser | null {
  const session = requestSession(req, deps);
  return session !== null && deps.authenticator.isActiveUser(session.sub) ? { name: session.sub } : null;
}

/** Signs out the session this request carries, if any: its token stops working even if
 *  someone copied the cookie. A missing, invalid or already-expired token is a no-op. */
export function revokeCurrentSession(req: Request, deps: SessionDeps): void {
  const session = requestSession(req, deps);
  if (session !== null) {
    deps.denylist.revoke(session.jti, session.exp);
  }
}

/** Guards every protected /api route (ADR-0011): no valid session means 401
 *  unauthorized, which the frontend treats as "go to login". */
export function createSessionGuard(deps: SessionDeps): RequestHandler {
  return (req, res, next) => {
    const user = currentUser(req, deps);
    if (!user) {
      next(new UnauthorizedError("Sign in to continue"));
      return;
    }
    res.locals.user = user;
    next();
  };
}
