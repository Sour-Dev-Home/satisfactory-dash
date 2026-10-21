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
import {
  addIdentity,
  authMethodsForUser,
  countUsersCreatedLastHour,
  createSignupUser,
  displayNameTaken,
  findUserByIdentity,
  setUserEmail,
  takeSignupLock,
} from "./repositories/userRepository.js";
import { generateDisplayName } from "./generatedName.js";
import { TERMS_VERSION } from "./signupConfig.js";
import type { SignupConfig } from "./signupConfig.js";
import type { User } from "./repositories/userRepository.js";

export type GoogleSignInResult =
  | { kind: "signed_in"; session: CreatedSession }
  /** Nothing was created: `not_invited` (closed sign-up), `disabled`, or in open sign-up `terms_required`
   *  (a new account that has not accepted the terms) and `signup_busy` (C8, the hourly cap). */
  | { kind: "refused"; reason: RefusalReason };

export type RefusalReason = "not_invited" | "disabled" | "unverified_email" | "terms_required" | "signup_busy";

export interface GoogleSignInOptions {
  /** The terms version the person accepted on the sign-in page (from the login attempt). */
  acceptedTermsVersion?: string | undefined;
}

export interface GoogleSignIn {
  complete(
    claims: GoogleClaims,
    replacingSessionCookie: string | undefined,
    options?: GoogleSignInOptions,
  ): Promise<GoogleSignInResult>;
}

const CLOSED_SIGNUP: SignupConfig = { mode: "closed", maxPerHour: 0 };

/**
 * ADR-0025 decisions 4 and 5. The account is found by (provider "google", sub) and NEVER by email,
 * with exactly one exception: the one-time bootstrap link, which attaches the first matching
 * Google identity to the SEEDED OPERATOR (so its memberships carry over) when the verified email
 * equals BOOTSTRAP_OWNER_EMAIL. Sign-up is closed: any other Google account is refused, creating no
 * user row and storing no email. Resolving the account, the session and the audit row are one
 * transaction. Audit rows carry ids and codes only, never the email.
 */
export function createGoogleSignIn(db: Db, bootstrapOwnerEmail: string, signup: SignupConfig = CLOSED_SIGNUP): GoogleSignIn {
  const refuse = async (client: Queryable, reason: RefusalReason, userId?: string): Promise<GoogleSignInResult> => {
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
    if (operator === undefined || operator.status !== "active") {
      return undefined;
    }
    if ((await authMethodsForUser(client, operator.id)).includes("google")) {
      // Already linked. Usually to a different Google account (refused), but a sign-in racing this
      // one may have just linked THIS sub between the lookup above and now (each statement sees
      // what committed before it): look again.
      return findUserByIdentity(client, "google", claims.sub);
    }
    await addIdentity(client, { userId: operator.id, provider: "google", subject: claims.sub });
    await setUserEmail(client, operator.id, claims.email);
    // The one-time link leaves its own trace (ids and codes only, never the email).
    await recordAuditEvent(client, { action: "identity_link", actorUserId: operator.id, detail: { provider: "google" } });
    return { ...operator, email: claims.email.trim().toLowerCase() };
  };

  /**
   * Open sign-up (ADR-0046, C8). Returns the new user, or the refusal to send. Everything runs under the
   * sign-up lock: the identity is looked up again (a racing first sign-in of the same sub just won), the
   * hourly count and the insert can't be raced past the cap, and the generated name is still free at the
   * insert. No email is stored: the account is keyed on (google, sub) alone.
   */
  const signUp = async (
    client: Queryable,
    claims: GoogleClaims,
    termsVersion: string,
  ): Promise<User | GoogleSignInResult> => {
    await takeSignupLock(client);
    const raced = await findUserByIdentity(client, "google", claims.sub);
    if (raced !== undefined) {
      return raced;
    }
    if ((await countUsersCreatedLastHour(client)) >= signup.maxPerHour) {
      return refuse(client, "signup_busy");
    }
    const displayName = await generateDisplayName((name) => displayNameTaken(client, name));
    const user = await createSignupUser(client, { displayName, termsVersion });
    await addIdentity(client, { userId: user.id, provider: "google", subject: claims.sub });
    // Ids and the terms version only: the audit trail never holds an email or a name.
    await recordAuditEvent(client, {
      action: "signup",
      actorUserId: user.id,
      detail: { provider: "google", termsVersion },
    });
    return user;
  };

  const attempt = (
    claims: GoogleClaims,
    replacing: string | undefined,
    options: GoogleSignInOptions,
  ): Promise<GoogleSignInResult> =>
    withTransaction(db, async (client) => {
      // The one hard requirement on the claims: a boolean true (the string "true" is not accepted).
      if (claims.emailVerified !== true) {
        return refuse(client, "unverified_email");
      }
      let user = await resolveUser(client, claims);
      if (user === undefined) {
        if (signup.mode !== "open") {
          return refuse(client, "not_invited");
        }
        if (options.acceptedTermsVersion !== TERMS_VERSION) {
          return refuse(client, "terms_required");
        }
        const created = await signUp(client, claims, TERMS_VERSION);
        if ("kind" in created) {
          return created;
        }
        user = created;
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
    async complete(claims, replacing, options = {}) {
      try {
        try {
          return await attempt(claims, replacing, options);
        } catch (err) {
          // Two first sign-ins racing on the bootstrap link: the loser hits the unique constraint
          // and simply re-reads what the winner wrote.
          if (isUniqueViolation(err)) {
            return await attempt(claims, replacing, options);
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
