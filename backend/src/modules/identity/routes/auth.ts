import { Router } from "express";
import { SessionResponseSchema, endpoints } from "@satisfactory-dash/shared";
import { clearSessionCookie, currentUser, revokeCurrentSession } from "../session.js";
import type { SessionDeps } from "../session.js";
import type { SessionUser } from "../sessionStore.js";
import { routePath } from "../../../platform/routePath.js";
import { sendValidated } from "../../../platform/sendValidated.js";

/** The account as the contract's SessionResponse names it: never the internal id. */
function publicUser(user: SessionUser): { name: string; email?: string; authMethods?: string[] } {
  return {
    name: user.name,
    ...(user.email ? { email: user.email } : {}),
    ...(user.authMethods ? { authMethods: user.authMethods } : {}),
  };
}

/**
 * ADR-0011's auth endpoints (sign-in itself is Google's, routes/googleAuth.ts). All are exempt
 * from the session guard (issue #19), and GET /api/auth/session answers 200
 * { authenticated: false } when signed out, never 401: it's how the frontend decides whether
 * to show the sign-in screen. There is no password login since ADR-0025 PR 9: POST
 * /api/auth/login is an unknown route (404).
 */
export function createAuthRouter(
  deps: SessionDeps & {
    /** What the sign-in screen may offer (SessionResponse.signInMethods): "google", "google_signup", or none. */
    signInMethods: string[];
  },
): Router {
  const { store, signInMethods } = deps;
  const router = Router();

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
