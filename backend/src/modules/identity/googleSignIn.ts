import { isDatabaseUnavailable, isUniqueViolation } from "../../platform/db/errors.js";
import { withTransaction } from "../../platform/db/transaction.js";
import { recordAuditEvent } from "../../platform/audit/auditRepository.js";
import { ServiceUnavailableError } from "../../platform/errorResponse.js";
import type { Queryable } from "../../platform/db/schemaVersion.js";
import { OPERATOR_SUBJECT } from "./authenticator.js";
import { startSession } from "./dbSessionStore.js";
import type { Db } from "./dbSessionStore.js";
import type { GoogleClaims } from "./googleOidc.js";
import type { CreatedSession } from "./sessionStore.js";
import { SESSION_TTL_SECONDS } from "./sessionToken.js";
import { addIdentity, authMethodsForUser, findUserByIdentity, setUserEmail } from "./repositories/userRepository.js";
import type { User } from "./repositories/userRepository.js";

export type GoogleSignInResult =
  | { kind: "signed_in"; session: CreatedSession }
  /** Nothing was created: `not_invited` (closed sign-up) or `disabled`. */
  | { kind: "refused"; reason: "not_invited" | "disabled" | "unverified_email" };

export interface GoogleSignIn {
  complete(claims: GoogleClaims, replacingSessionCookie: string | undefined): Promise<GoogleSignInResult>;
}

/**
 * ADR-0025 decisions 4 and 5. The account is found by (provider "google", sub) and NEVER by email,
 * with exactly one exception: the one-time bootstrap link, which attaches the first matching
 * Google identity to the SEEDED OPERATOR (so its memberships carry over) when the verified email
 * equals BOOTSTRAP_OWNER_EMAIL. Sign-up is closed: any other Google account is refused, creating no
 * user row and storing no email. Resolving the account, the session and the audit row are one
 * transaction. Audit rows carry ids and codes only, never the email.
 */
export function createGoogleSignIn(db: Db, bootstrapOwnerEmail: string): GoogleSignIn {
  const refuse = async (
    client: Queryable,
    reason: "not_invited" | "disabled" | "unverified_email",
    userId?: string,
  ): Promise<GoogleSignInResult> => {
    await recordAuditEvent(client, {
      action: "signin.refused",
      ...(userId ? { actorUserId: userId } : {}),
      detail: { provider: "google", reason },
    });
    return { kind: "refused", reason };
  };

  /** The user this Google identity belongs to, linking the operator on the bootstrap path. */
  const resolveUser = async (client: Queryable, claims: GoogleClaims): Promise<User | undefined> => {
    const known = await findUserByIdentity(client, "google", claims.sub);
    if (known !== undefined) {
      return known;
    }
    if (claims.email === undefined || claims.email.trim().toLowerCase() !== bootstrapOwnerEmail) {
      return undefined;
    }
    const operator = await findUserByIdentity(client, "local", OPERATOR_SUBJECT);
    // Not linkable when the operator is disabled or already has a (different) Google identity.
    if (operator === undefined || operator.status !== "active" || (await authMethodsForUser(client, operator.id)).includes("google")) {
      return undefined;
    }
    await addIdentity(client, { userId: operator.id, provider: "google", subject: claims.sub });
    await setUserEmail(client, operator.id, claims.email);
    return { ...operator, email: claims.email.trim().toLowerCase() };
  };

  const attempt = (claims: GoogleClaims, replacing: string | undefined): Promise<GoogleSignInResult> =>
    withTransaction(db, async (client) => {
      // The one hard requirement on the claims: a boolean true (the string "true" is not accepted).
      if (claims.emailVerified !== true) {
        return refuse(client, "unverified_email");
      }
      const user = await resolveUser(client, claims);
      if (user === undefined) {
        return refuse(client, "not_invited");
      }
      if (user.status !== "active") {
        return refuse(client, "disabled", user.id);
      }
      const cookieValue = await startSession(client, user.id, replacing, { provider: "google" });
      const authMethods = await authMethodsForUser(client, user.id);
      return {
        kind: "signed_in",
        session: {
          cookieValue,
          maxAgeSeconds: SESSION_TTL_SECONDS,
          user: { id: user.id, name: user.displayName, ...(user.email ? { email: user.email } : {}), authMethods },
        },
      } satisfies GoogleSignInResult;
    });

  return {
    async complete(claims, replacing) {
      try {
        try {
          return await attempt(claims, replacing);
        } catch (err) {
          // Two first sign-ins racing on the bootstrap link: the loser hits the unique constraint
          // and simply re-reads what the winner wrote.
          if (isUniqueViolation(err)) {
            return await attempt(claims, replacing);
          }
          throw err;
        }
      } catch (err) {
        if (isDatabaseUnavailable(err)) {
          throw Object.assign(new ServiceUnavailableError(), { cause: err });
        }
        throw err;
      }
    },
  };
}
