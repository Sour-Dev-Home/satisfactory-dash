import { Router } from "express";
import type { CookieOptions, Request, Response } from "express";
import { parse as parseCookies } from "cookie";
import * as oidc from "openid-client";
import { RouteNotFoundError, ServiceUnavailableError } from "../../../platform/errorResponse.js";
import { isDatabaseUnavailable } from "../../../platform/db/errors.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { clientIp } from "../../../platform/clientIp.js";
import type { GoogleConfig } from "../googleConfig.js";
import type { GoogleOidc } from "../googleOidc.js";
import type { GoogleSignIn } from "../googleSignIn.js";
import { readSessionCookie, setSessionCookie } from "../session.js";
import { ReturnPathSchema } from "../returnPath.js";
import { consumeLoginAttempt, createLoginAttempt, hashLoginAttemptId, newLoginAttemptId } from "../repositories/loginAttemptRepository.js";
import { createLoginRequestCap } from "./loginRequestCap.js";

/** The cookie that ties a callback to the attempt /start created: only a random id, nothing else. */
export const LOGIN_ATTEMPT_COOKIE = "sd_login_attempt";
const ATTEMPT_COOKIE_MAX_AGE_SECONDS = 10 * 60;
/** Lax, not Strict: Google's redirect back is a cross-site top-level GET, which Lax carries. */
const ATTEMPT_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/api/auth/google",
};

/** The fixed set of reasons a failed sign-in sends the browser back with (`/app/login?error=`).
 *  Google's own error text is never passed through. */
export type GoogleLoginError = "denied" | "expired" | "failed" | "not_invited" | "unavailable";

const DEFAULT_RETURN_PATH = "/app";

export interface GoogleAuthDeps {
  config: GoogleConfig;
  oidc: GoogleOidc;
  signIn: GoogleSignIn;
  db: Queryable;
}

/** With Google not configured, every /api/auth/google/* path is a plain 404 (and must not fall
 *  through to the session guard, which would answer 401). */
export function createGoogleDisabledRouter(): Router {
  const router = Router();
  router.use("/auth/google", (_req, _res, next) => {
    next(new RouteNotFoundError());
  });
  return router;
}

/**
 * ADR-0025 decision 3: Google sign-in (authorization code + PKCE + state + nonce).
 *   GET /api/auth/google/start     -> 302 to Google
 *   GET /api/auth/google/callback  -> 302 to the frontend (signed in, or /app/login?error=<code>)
 * Every redirect after Google is built ONLY from the configured frontend origin plus either the
 * stored, validated return path or a fixed error code; nothing from the query string is reflected.
 */
export function createGoogleAuthRouter(deps: GoogleAuthDeps): Router {
  const { config, oidc: google, signIn, db } = deps;
  const router = Router();
  // Same per-IP cap as password login (IPv6 by /56); one instance covering both routes.
  const cap = createLoginRequestCap("google sign-in");

  const noStore = (res: Response) => void res.setHeader("Cache-Control", "no-store");
  const failTo = (res: Response, error: GoogleLoginError) =>
    res.redirect(302, `${config.frontendOrigin}/app/login?error=${error}`);

  router.get("/auth/google/start", cap, async (req, res) => {
    noStore(res);
    // A return path that is not a safe /app path is ignored, not an error: sign-in still works.
    const requested = typeof req.query.return === "string" ? ReturnPathSchema.safeParse(req.query.return) : undefined;
    const returnPath = requested?.success ? requested.data : DEFAULT_RETURN_PATH;
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    // Discovery first: when Google is unreachable this is a 503 and nothing is written.
    const url = await google.authorizationUrl({ state, nonce, codeVerifier });
    const attempt = newLoginAttemptId();
    try {
      await createLoginAttempt(db, { idHash: attempt.idHash, state, nonce, codeVerifier, returnPath });
    } catch (err) {
      throw isDatabaseUnavailable(err) ? Object.assign(new ServiceUnavailableError(), { cause: err }) : err;
    }
    res.cookie(LOGIN_ATTEMPT_COOKIE, attempt.id, { ...ATTEMPT_COOKIE_OPTIONS, maxAge: ATTEMPT_COOKIE_MAX_AGE_SECONDS * 1000 });
    res.redirect(302, url.toString());
  });

  router.get("/auth/google/callback", cap, async (req, res) => {
    noStore(res);
    const ip = clientIp(req);
    const attemptId = readAttemptCookie(req);
    // The attempt cookie is single use whatever happens next.
    res.clearCookie(LOGIN_ATTEMPT_COOKIE, ATTEMPT_COOKIE_OPTIONS);
    if (attemptId === undefined) {
      req.log.warn({ ip, code: "expired" }, "google sign-in failed");
      failTo(res, "expired");
      return;
    }
    try {
      const attempt = await consumeLoginAttempt(db, hashLoginAttemptId(attemptId));
      if (attempt === undefined) {
        req.log.warn({ ip, code: "expired" }, "google sign-in failed");
        failTo(res, "expired");
        return;
      }
      if (typeof req.query.error === "string") {
        const code: GoogleLoginError = req.query.error === "access_denied" ? "denied" : "failed";
        req.log.warn({ ip, code }, "google sign-in failed");
        failTo(res, code);
        return;
      }
      const claims = await google.exchange({
        callbackUrl: callbackUrlOf(config, req),
        state: attempt.state,
        nonce: attempt.nonce,
        codeVerifier: attempt.codeVerifier,
      });
      if (claims.sub.length < 1 || claims.sub.length > 255) {
        throw new Error("Unusable subject claim.");
      }
      const result = await signIn.complete(claims, readSessionCookie(req));
      if (result.kind === "refused") {
        // A disabled account or an unverified email looks like a generic failure to the browser
        // (the reason is in the audit row): only "not invited" tells the person something they can act on.
        const code: GoogleLoginError = result.reason === "not_invited" ? "not_invited" : "failed";
        req.log.warn({ ip, code }, "google sign-in refused");
        failTo(res, code);
        return;
      }
      setSessionCookie(res, result.session.cookieValue, result.session.maxAgeSeconds);
      req.log.info({ ip, userId: result.session.user.id }, "google sign-in succeeded");
      // The stored path was validated on the way in and again by the table's CHECK; re-checked here.
      const returnPath = ReturnPathSchema.safeParse(attempt.returnPath);
      res.redirect(302, `${config.frontendOrigin}${returnPath.success ? returnPath.data : DEFAULT_RETURN_PATH}`);
    } catch (err) {
      const unavailable = err instanceof ServiceUnavailableError || isDatabaseUnavailable(err);
      const code: GoogleLoginError = unavailable ? "unavailable" : "failed";
      // A code and the error's class, never Google's message or any claim.
      req.log.warn({ ip, code, errorName: errorName(err) }, "google sign-in failed");
      failTo(res, code);
    }
  });

  return router;
}

function readAttemptCookie(req: Request): string | undefined {
  try {
    const value = parseCookies(req.headers.cookie ?? "")[LOGIN_ATTEMPT_COOKIE];
    return value !== undefined && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The configured redirect URI plus the response's query string: behind the tunnel the request's own
 *  host is not what Google was told, and openid-client anchors the code exchange to this URL. */
function callbackUrlOf(config: GoogleConfig, req: Request): URL {
  const url = new URL(config.redirectUri);
  url.search = new URL(req.originalUrl, "http://placeholder.invalid").search;
  return url;
}

function errorName(err: unknown): string {
  if (err instanceof oidc.ClientError && err.code) {
    return err.code;
  }
  return err instanceof Error ? err.name : "unknown";
}
