import type { Authenticator } from "./authenticator.js";
import type { SessionDenylist } from "./sessionDenylist.js";
import { SESSION_TTL_SECONDS, createSessionToken, readSessionToken } from "./sessionToken.js";
import type { CreatedSession, Principal, SessionStore, SessionUser } from "./sessionStore.js";

/**
 * The original ADR-0011 sessions: a signed, expiring token in the cookie, plus an in-memory
 * denylist for logout. Used only when no database is configured, and removed with the rest of the
 * stateless code in ADR-0025 PR 9. Its behaviour is unchanged.
 */
export function createStatelessSessionStore(deps: {
  authenticator: Authenticator;
  sessionSecret: string;
  denylist: SessionDenylist;
}): SessionStore {
  const { authenticator, sessionSecret, denylist } = deps;
  return {
    async create(principal: Principal): Promise<CreatedSession> {
      return {
        cookieValue: createSessionToken(principal.name, sessionSecret),
        maxAgeSeconds: SESSION_TTL_SECONDS,
        user: { id: principal.subject, name: principal.name },
      };
    },

    async resolve(cookieValue: string | undefined): Promise<SessionUser | null> {
      if (!cookieValue) {
        return null;
      }
      try {
        const session = readSessionToken(cookieValue, sessionSecret);
        if (session === null || denylist.isRevoked(session.jti) || !authenticator.isActiveUser(session.sub)) {
          return null;
        }
        return { id: session.sub, name: session.sub };
      } catch {
        return null;
      }
    },

    async revoke(cookieValue: string | undefined): Promise<void> {
      if (!cookieValue) {
        return;
      }
      try {
        const session = readSessionToken(cookieValue, sessionSecret);
        if (session !== null) {
          denylist.revoke(session.jti, session.exp);
        }
      } catch {
        // An unreadable token is already unusable.
      }
    },

    // Signed tokens are not tracked server-side, so only the current one can be ended (by
    // `revoke`); every other device keeps its token until it expires. Database sessions fix this.
    async revokeAllFor(): Promise<number> {
      return 0;
    },

    recognizes(cookieValue: string): boolean {
      return cookieValue.includes(".");
    },
  };
}
