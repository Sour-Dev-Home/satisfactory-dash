import { ServiceUnavailableError, UnauthorizedError } from "../../platform/errorResponse.js";
import { isDatabaseUnavailable } from "../../platform/db/errors.js";
import type { Queryable } from "../../platform/db/schemaVersion.js";
import { withTransaction } from "../../platform/db/transaction.js";
import { recordAuditEvent } from "../../platform/audit/auditRepository.js";
import type { CreatedSession, Principal, SessionStore, SessionUser } from "./sessionStore.js";
import { SESSION_TTL_SECONDS } from "./sessionToken.js";
import {
  createSession,
  findActiveSession,
  hashSessionId,
  newSessionId,
  revokeAllSessionsForUser,
  revokeSession,
  touchSession,
} from "./repositories/sessionRepository.js";
import { authMethodsForUser, ensureLocalUser } from "./repositories/userRepository.js";

/** A database session id is 32 random bytes as base64url: exactly 43 characters. Anything else
 *  (a foreign cookie, an old signed token, junk) is refused without asking the database. */
const SESSION_ID_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** A touch is only attempted when the last one is older than this (the UPDATE is itself
 *  conditional, so this is just to skip a pointless round trip). */
const TOUCH_AFTER_MS = 60_000;

export type Db = Queryable & Parameters<typeof withTransaction>[0];

/**
 * ADR-0025 decision 4: server-side sessions. The cookie holds a 32-byte random id, the table only
 * its sha256; a new id on every login (no fixation); the same 8-hour lifetime; time is the
 * database's. A database failure while answering is a 503 (ServiceUnavailableError), NEVER a 401:
 * an outage must not look like "signed out". Audit rows carry ids only.
 */
export function createDbSessionStore(db: Db): SessionStore {
  /** Database outages become a 503; everything else (a bug, a constraint) stays what it is. */
  const guard = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (err) {
      if (isDatabaseUnavailable(err)) {
        throw Object.assign(new ServiceUnavailableError(), { cause: err });
      }
      throw err;
    }
  };

  return {
    create: (principal: Principal, replacing?: string): Promise<CreatedSession> =>
      guard(async () => {
        const user = await ensureLocalUser(db, { subject: principal.subject, displayName: principal.name });
        if (user.status !== "active") {
          // A disabled account cannot sign in; the answer is the same as a wrong password.
          throw new UnauthorizedError("Invalid username or password");
        }
        const { id, idHash } = newSessionId();
        await withTransaction(db, async (client) => {
          await createSession(client, { idHash, userId: user.id, ttlSeconds: SESSION_TTL_SECONDS });
          await recordAuditEvent(client, { action: "login", actorUserId: user.id });
          // Rotation: the browser's previous session ends with the new one starting (one
          // transaction, so there is no moment with both, and a failure leaves the old one alone).
          if (replacing && SESSION_ID_SHAPE.test(replacing)) {
            await revokeSession(client, hashSessionId(replacing));
          }
        });
        const authMethods = await authMethodsForUser(db, user.id);
        return {
          cookieValue: id,
          maxAgeSeconds: SESSION_TTL_SECONDS,
          user: { id: user.id, name: user.displayName, ...(user.email ? { email: user.email } : {}), authMethods },
        };
      }),

    resolve: (cookieValue: string | undefined): Promise<SessionUser | null> =>
      guard(async () => {
        if (!cookieValue || !SESSION_ID_SHAPE.test(cookieValue)) {
          return null;
        }
        const idHash = hashSessionId(cookieValue);
        const session = await findActiveSession(db, idHash);
        if (session === undefined) {
          return null;
        }
        if (session.lastSeenAt === null || Date.now() - session.lastSeenAt.getTime() > TOUCH_AFTER_MS) {
          // One conditional statement; a failed touch never fails the request.
          await touchSession(db, idHash).catch(() => false);
        }
        return {
          id: session.userId,
          name: session.displayName,
          ...(session.email ? { email: session.email } : {}),
          authMethods: session.authMethods,
        };
      }),

    revoke: (cookieValue: string | undefined): Promise<void> =>
      guard(async () => {
        if (!cookieValue || !SESSION_ID_SHAPE.test(cookieValue)) {
          return;
        }
        const idHash = hashSessionId(cookieValue);
        await withTransaction(db, async (client) => {
          const userId = await revokeSession(client, idHash);
          if (userId !== undefined) {
            await recordAuditEvent(client, { action: "logout", actorUserId: userId });
          }
        });
      }),

    revokeAllFor: (user: SessionUser): Promise<number> =>
      guard(() =>
        withTransaction(db, async (client) => {
          const count = await revokeAllSessionsForUser(client, user.id);
          await recordAuditEvent(client, { action: "logout_all", actorUserId: user.id, detail: { count } });
          return count;
        }),
      ),

    recognizes: (cookieValue: string): boolean => SESSION_ID_SHAPE.test(cookieValue),
  };
}
