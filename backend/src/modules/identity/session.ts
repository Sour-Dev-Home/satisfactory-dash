import type { CookieOptions, Request, RequestHandler, Response } from "express";
import { parse as parseCookies } from "cookie";
import type { Authenticator, AuthenticatedUser } from "./authenticator.js";
import { SESSION_TTL_SECONDS, createSessionToken, verifySessionToken } from "./sessionToken.js";
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

/** The signed-in user for this request, or null. Never throws. */
export function currentUser(req: Request, { authenticator, sessionSecret }: SessionDeps): AuthenticatedUser | null {
  try {
    const token = parseCookies(req.headers.cookie ?? "")[SESSION_COOKIE];
    if (!token) {
      return null;
    }
    const name = verifySessionToken(token, sessionSecret);
    return name !== null && authenticator.isActiveUser(name) ? { name } : null;
  } catch {
    return null;
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
