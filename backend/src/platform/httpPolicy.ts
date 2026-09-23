import type { NextFunction, Request, RequestHandler, Response } from "express";
import { BadRequestError, UnsupportedMediaTypeError } from "./errorResponse.js";

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

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** Sec-Fetch-Site values a legitimate mutation can carry: the frontend is same-site
 *  in production (satis-manager.com -> api.satis-manager.com) and same-origin through
 *  the Vite dev proxy; "none" is a user-initiated request. */
const ALLOWED_FETCH_SITES = new Set(["same-origin", "same-site", "none"]);

/**
 * Refuses cross-site mutations (found by the security review of PR #24). SameSite=Lax
 * and JSON-only don't cover a body-less mutation that needs no cookie -- an empty
 * cross-site form POST to logout signed the operator out -- and any future body-less
 * action would have had the same gap. So a non-GET request is refused when the browser
 * says it's cross-site (Sec-Fetch-Site), or, for browsers that don't send that header,
 * when its Origin isn't allowlisted. A client that sends neither (curl, scripts) isn't
 * a browser and can't carry a victim's cookie, so it passes.
 */
export function createCrossSiteGuard(allowedOrigins: string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    const fetchSite = req.headers["sec-fetch-site"];
    const origin = req.headers.origin;
    const refused =
      typeof fetchSite === "string"
        ? !ALLOWED_FETCH_SITES.has(fetchSite)
        : typeof origin === "string" && !allowed.has(origin);
    next(refused ? new BadRequestError("Cross-site request refused") : undefined);
  };
}
