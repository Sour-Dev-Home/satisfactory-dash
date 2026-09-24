import type { CookieOptions, Request, RequestHandler, Response } from "express";
import { parse as parseCookies } from "cookie";
import type { SessionStore, SessionUser } from "./sessionStore.js";
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
  /** Where sessions live: the database (deploy A onward) or the original signed tokens. */
  store: SessionStore;
}

export function setSessionCookie(res: Response, cookieValue: string, maxAgeSeconds: number): void {
  res.cookie(SESSION_COOKIE, cookieValue, { ...COOKIE_OPTIONS, maxAge: maxAgeSeconds * 1000 });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS);
}

/** The raw session cookie value, or undefined. Never throws (a malformed Cookie header is "none"). */
export function readSessionCookie(req: Request): string | undefined {
  try {
    return parseCookies(req.headers.cookie ?? "")[SESSION_COOKIE] || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The signed-in user for this request, or null. A cookie that this store does not recognize (an
 * old signed token after deploy A, a foreign value) is answered as "signed out" AND cleared, so the
 * browser stops sending it. A database outage throws ServiceUnavailableError (a 503), never null.
 */
export async function currentUser(req: Request, res: Response, deps: SessionDeps): Promise<SessionUser | null> {
  const cookieValue = readSessionCookie(req);
  if (cookieValue === undefined) {
    return null;
  }
  const user = await deps.store.resolve(cookieValue);
  if (user === null && !deps.store.recognizes(cookieValue)) {
    clearSessionCookie(res);
  }
  return user;
}

/** Signs out the session this request carries, if any. Unknown or expired: a no-op. */
export async function revokeCurrentSession(req: Request, deps: SessionDeps): Promise<void> {
  await deps.store.revoke(readSessionCookie(req));
}

/** Guards every protected /api route (ADR-0011): no valid session means 401
 *  unauthorized, which the frontend treats as "go to login"; an unavailable session store is a
 *  503, which the frontend must not treat as signed out. */
export function createSessionGuard(deps: SessionDeps): RequestHandler {
  return async (req, res, next) => {
    try {
      const user = await currentUser(req, res, deps);
      if (!user) {
        next(new UnauthorizedError("Sign in to continue"));
        return;
      }
      res.locals.user = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}
