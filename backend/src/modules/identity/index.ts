/**
 * The identity module's public API (ADR-0014): login, the session cookie and the guard
 * that protects every other /api route (ADR-0011). Site-wide HTTP policy (cross-site
 * guard, JSON-only) is not identity's; it lives in platform/httpPolicy.ts.
 */
import { Router } from "express";
import type { RequestHandler } from "express";
import { ConfigError } from "../../platform/errors.js";
import { loadAuthConfigFromEnv } from "./authConfig.js";
import { loadGoogleConfigFromEnv } from "./googleConfig.js";
import { createGoogleOidc } from "./googleOidc.js";
import type { GoogleOidcOptions } from "./googleOidc.js";
import { createGoogleSignIn } from "./googleSignIn.js";
import { createGoogleAuthRouter, createGoogleDisabledRouter } from "./routes/googleAuth.js";
import { OPERATOR_SUBJECT, SingleOperatorAuthenticator } from "./authenticator.js";
import { ensureLocalUser } from "./repositories/userRepository.js";
import { LoginRateLimiter } from "./loginRateLimiter.js";
import { createAuthRouter } from "./routes/auth.js";
import { createSessionGuard } from "./session.js";
import { SessionDenylist } from "./sessionDenylist.js";
import { createDbSessionStore } from "./dbSessionStore.js";
import type { Db } from "./dbSessionStore.js";
import { createStatelessSessionStore } from "./statelessSessionStore.js";
import { createSessionPurgeWorker } from "./sessionPurge.js";
import type { PurgeLogger } from "./sessionPurge.js";

export type { SessionUser } from "./sessionStore.js";

export interface IdentityWorker {
  start(): void;
  stop(): Promise<void>;
}

export interface IdentityModule {
  /** Login, logout and session status: mounted with no session required. */
  authRouter: Router;
  /** Guards every protected /api route. */
  sessionGuard: RequestHandler;
  /** Exact origins allowed to call the API with credentials (CORS + cross-site guard). */
  allowedOrigins: string[];
  /** Background housekeeping (database mode only): started once the server is listening. */
  workers: IdentityWorker[];
  /** Database mode only: makes sure the operator's account exists and returns its id, so the
   *  composition root can seed it as the owner of the configured servers (ADR-0025 PR 6). */
  ensureOperatorUserId?: () => Promise<string>;
}

export interface IdentityOptions {
  /** The database (ADR-0025). Without it, sessions are the original signed tokens. */
  db?: Db;
  logger?: PurgeLogger;
  /** Test-only: point Google sign-in at a local fake issuer. Never read from the environment. */
  googleOidc?: GoogleOidcOptions;
}

/** Throws ConfigError when the login settings are missing or invalid (backend must not start). */
export function createIdentityModule(
  env: NodeJS.ProcessEnv = process.env,
  options: IdentityOptions = {},
): IdentityModule {
  const auth = loadAuthConfigFromEnv(env);
  const authenticator = new SingleOperatorAuthenticator(auth.adminUser, auth.passwordHash);
  const store = options.db
    ? createDbSessionStore(options.db)
    : createStatelessSessionStore({ authenticator, sessionSecret: auth.sessionSecret, denylist: new SessionDenylist() });
  const sessionDeps = { store };
  const noopLogger: PurgeLogger = { info: () => {}, warn: () => {} };
  // ADR-0025 decisions 3 and 5: all-or-nothing Google settings; unset means /api/auth/google/* is 404.
  const googleConfig = loadGoogleConfigFromEnv(env, auth.allowedOrigins);
  if (googleConfig && !options.db) {
    throw new ConfigError("Google sign-in needs the database: set DATABASE_URL, or unset the GOOGLE_* settings.");
  }
  const authRouter = Router().use(createAuthRouter({ ...sessionDeps, authenticator, rateLimiter: new LoginRateLimiter() }));
  authRouter.use(
    googleConfig && options.db
      ? createGoogleAuthRouter({
          config: googleConfig,
          oidc: createGoogleOidc(googleConfig, options.googleOidc),
          signIn: createGoogleSignIn(options.db, googleConfig.bootstrapOwnerEmail),
          db: options.db,
        })
      : createGoogleDisabledRouter(),
  );
  return {
    authRouter,
    sessionGuard: createSessionGuard(sessionDeps),
    allowedOrigins: auth.allowedOrigins,
    workers: options.db ? [createSessionPurgeWorker(options.db, options.logger ?? noopLogger)] : [],
    ...(options.db && {
      ensureOperatorUserId: async () =>
        (await ensureLocalUser(options.db!, { subject: OPERATOR_SUBJECT, displayName: auth.adminUser })).id,
    }),
  };
}
