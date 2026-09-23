import type { CookieOptions, NextFunction, Request, RequestHandler, Response } from "express";
import { parse as parseCookies } from "cookie";
import type { Authenticator, AuthenticatedUser } from "../services/auth/authenticator.js";
import { SESSION_TTL_SECONDS, createSessionToken, verifySessionToken } from "../services/auth/sessionToken.js";
import { UnauthorizedError, UnsupportedMediaTypeError } from "./errorResponse.js";

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

const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** True when the request actually carries body bytes. `req.is()` alone isn't enough: it
 *  counts `Content-Length: 0` as a body, and that's what a browser sends for a
 *  body-less fetch POST. */
function hasBodyBytes(req: Request): boolean {
  if (req.headers["transfer-encoding"] !== undefined) {
    return true;
  }
  const length = Number(req.headers["content-length"] ?? 0);
  return Number.isFinite(length) && length > 0;
}

/**
 * ADR-0011: mutations accept JSON only (with SameSite=Lax, this is the CSRF defense: a
 * cross-site form can't send application/json). The rule applies only when a request
 * HAS a body, so the frontend's body-less POST /api/auth/logout passes (issue #19).
 */
export function requireJsonBody(req: Request, _res: Response, next: NextFunction): void {
  if (METHODS_WITH_BODY.has(req.method) && hasBodyBytes(req) && !req.is("application/json")) {
    next(new UnsupportedMediaTypeError());
    return;
  }
  next();
}
