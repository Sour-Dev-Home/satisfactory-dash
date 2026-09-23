/**
 * The identity module's public API (ADR-0014): login, the session cookie and the guard
 * that protects every other /api route (ADR-0011). Site-wide HTTP policy (cross-site
 * guard, JSON-only) is not identity's; it lives in platform/httpPolicy.ts.
 */
import type { RequestHandler, Router } from "express";
import { loadAuthConfigFromEnv } from "./authConfig.js";
import { SingleOperatorAuthenticator } from "./authenticator.js";
import { LoginRateLimiter } from "./loginRateLimiter.js";
import { createAuthRouter } from "./routes/auth.js";
import { createSessionGuard } from "./session.js";

export interface IdentityModule {
  /** Login, logout and session status: mounted with no session required. */
  authRouter: Router;
  /** Guards every protected /api route. */
  sessionGuard: RequestHandler;
  /** Exact origins allowed to call the API with credentials (CORS + cross-site guard). */
  allowedOrigins: string[];
}

/** Throws ConfigError when the login settings are missing or invalid (backend must not start). */
export function createIdentityModule(env: NodeJS.ProcessEnv = process.env): IdentityModule {
  const auth = loadAuthConfigFromEnv(env);
  const sessionDeps = {
    authenticator: new SingleOperatorAuthenticator(auth.adminUser, auth.passwordHash),
    sessionSecret: auth.sessionSecret,
  };
  return {
    authRouter: createAuthRouter({ ...sessionDeps, rateLimiter: new LoginRateLimiter() }),
    sessionGuard: createSessionGuard(sessionDeps),
    allowedOrigins: auth.allowedOrigins,
  };
}
