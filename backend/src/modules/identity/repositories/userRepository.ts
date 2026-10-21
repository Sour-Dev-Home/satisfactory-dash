import { z } from "zod";
import { isUniqueViolation } from "../../../platform/db/errors.js";
import { parseFirst, parseOne } from "../../../platform/db/rows.js";
import { withTransaction } from "../../../platform/db/transaction.js";
import { timedQuery } from "../../../platform/db/timedQuery.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";

/**
 * Accounts and their sign-in identities (ADR-0020, ADR-0025). Identities are keyed on
 * (provider, provider_subject), NEVER on email. All SQL is hand-written and parameterized; row
 * sets are parsed with zod. Functions take a Queryable so a caller can pass a pool or, inside
 * withTransaction, the transaction's client (sign-up creates user, identity and session together).
 */
export type IdentityProvider = "local" | "google";
export type UserStatus = "active" | "disabled";

export interface User {
  id: string;
  displayName: string;
  email: string | null;
  status: UserStatus;
  createdAt: Date;
}

const UserRowSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  email: z.string().nullable(),
  status: z.enum(["active", "disabled"]),
  created_at: z.date(),
});

const toUser = (row: z.output<typeof UserRowSchema>): User => ({
  id: row.id,
  displayName: row.display_name,
  email: row.email,
  status: row.status,
  createdAt: row.created_at,
});

const INSERT_USER = `
  INSERT INTO identity.users (display_name, email)
  VALUES ($1, lower($2::text))
  RETURNING id, display_name, email, status, created_at`;

/** `email` is trimmed here and lowercased BY POSTGRES (`lower()`), the same function the table's
 *  CHECK uses, so the two can never disagree about a unicode edge case. Never a key. */
export async function createUser(db: Queryable, input: { displayName: string; email?: string | null }): Promise<User> {
  const email = input.email?.trim() || null;
  const result = await timedQuery(db, "identity.createUser", INSERT_USER,[input.displayName.trim(), email]);
  return toUser(parseOne(UserRowSchema, result.rows, "identity.createUser"));
}

const INSERT_SIGNUP_USER = `
  INSERT INTO identity.users (display_name, terms_version, terms_accepted_at)
  VALUES ($1, $2, now())
  RETURNING id, display_name, email, status, created_at`;

/** Open sign-up (ADR-0046): a new account with NO email stored, and the terms version it accepted
 *  (the time is the database's `now()`). */
export async function createSignupUser(db: Queryable, input: { displayName: string; termsVersion: string }): Promise<User> {
  const result = await timedQuery(db, "identity.createSignupUser", INSERT_SIGNUP_USER, [input.displayName, input.termsVersion]);
  return toUser(parseOne(UserRowSchema, result.rows, "identity.createSignupUser"));
}

/** Serializes sign-up creations within a transaction (released at commit or rollback), so the C8 count
 *  and the insert can't be raced past the cap, and two first sign-ins of one identity take turns. */
export async function takeSignupLock(db: Queryable): Promise<void> {
  await timedQuery(db, "identity.takeSignupLock", "SELECT pg_advisory_xact_lock(hashtext('identity.signup'))", []);
}

const COUNT_RECENT_USERS = `
  SELECT count(*)::int AS n
  FROM identity.users
  WHERE created_at > now() - interval '1 hour'`;

/** C8: accounts created in the last hour (any provider), counted from `created_at`. */
export async function countUsersCreatedLastHour(db: Queryable): Promise<number> {
  const result = await timedQuery(db, "identity.countUsersCreatedLastHour", COUNT_RECENT_USERS, []);
  return parseOne(z.object({ n: z.number() }), result.rows, "identity.countUsersCreatedLastHour").n;
}

const SELECT_NAME_TAKEN = `SELECT 1 AS taken FROM identity.users WHERE display_name = $1 LIMIT 1`;

export async function displayNameTaken(db: Queryable, displayName: string): Promise<boolean> {
  const result = await timedQuery(db, "identity.displayNameTaken", SELECT_NAME_TAKEN, [displayName]);
  return result.rows.length > 0;
}

const SELECT_USER_BY_ID = `
  SELECT id, display_name, email, status, created_at
  FROM identity.users
  WHERE id = $1`;

export async function getUserById(db: Queryable, id: string): Promise<User | undefined> {
  const result = await timedQuery(db, "identity.getUserById", SELECT_USER_BY_ID,[id]);
  const row = parseFirst(UserRowSchema, result.rows, "identity.getUserById");
  return row === undefined ? undefined : toUser(row);
}

const SELECT_USER_BY_IDENTITY = `
  SELECT u.id, u.display_name, u.email, u.status, u.created_at
  FROM identity.auth_identities i
  JOIN identity.users u ON u.id = i.user_id
  WHERE i.provider = $1 AND i.provider_subject = $2`;

/** The user behind a provider identity (any status: the caller decides what "disabled" means). */
export async function findUserByIdentity(
  db: Queryable,
  provider: IdentityProvider,
  subject: string,
): Promise<User | undefined> {
  const result = await timedQuery(db, "identity.findUserByIdentity", SELECT_USER_BY_IDENTITY,[provider, subject]);
  const row = parseFirst(UserRowSchema, result.rows, "identity.findUserByIdentity");
  return row === undefined ? undefined : toUser(row);
}

const INSERT_IDENTITY = `
  INSERT INTO identity.auth_identities (user_id, provider, provider_subject)
  VALUES ($1, $2, $3)
  RETURNING id`;

const IdentityIdRowSchema = z.object({ id: z.string() });

/** Links an identity to a user. Throws a 23505 (see isUniqueViolation) when the identity already
 *  belongs to someone, or the user already has one for that provider. Returns the identity id. */
export async function addIdentity(
  db: Queryable,
  input: { userId: string; provider: IdentityProvider; subject: string },
): Promise<string> {
  const result = await timedQuery(db, "identity.addIdentity", INSERT_IDENTITY,[input.userId, input.provider, input.subject]);
  return parseOne(IdentityIdRowSchema, result.rows, "identity.addIdentity").id;
}

const SELECT_PROVIDERS = `
  SELECT provider
  FROM identity.auth_identities
  WHERE user_id = $1
  ORDER BY provider`;

const ProviderRowSchema = z.object({ provider: z.enum(["local", "google"]) });

/** How the account can sign in, as the contract names it: "password" (the local operator
 *  identity) and/or "google". */
export async function authMethodsForUser(db: Queryable, userId: string): Promise<string[]> {
  const result = await timedQuery(db, "identity.authMethodsForUser", SELECT_PROVIDERS,[userId]);
  const methods = result.rows.map((row) => ProviderRowSchema.parse(row).provider);
  return methods.map((provider) => (provider === "local" ? "password" : provider));
}

const UPDATE_DISPLAY_NAME = `
  UPDATE identity.users
  SET display_name = $2
  WHERE id = $1 AND display_name <> $2`;

/**
 * The single operator (ADR-0025): ensures a user with a LOCAL identity whose subject is a FIXED
 * key (not the username), creating both in one transaction on first use. The .env username is
 * only the display name, refreshed when it changes, so renaming it can never fork a second account
 * that loses ownership. Safe under concurrent first logins (a lost race re-reads the winner).
 */
export async function ensureLocalUser(
  pool: Queryable & Parameters<typeof withTransaction>[0],
  input: { subject: string; displayName: string },
): Promise<User> {
  const find = async (db: Queryable) => findUserByIdentity(db, "local", input.subject);
  const existing = await find(pool);
  if (existing !== undefined) {
    if (existing.displayName !== input.displayName.trim()) {
      await timedQuery(pool, "identity.updateDisplayName", UPDATE_DISPLAY_NAME,[existing.id, input.displayName.trim()]);
      return { ...existing, displayName: input.displayName.trim() };
    }
    return existing;
  }
  try {
    return await withTransaction(pool, async (client) => {
      const user = await createUser(client, { displayName: input.displayName });
      await addIdentity(client, { userId: user.id, provider: "local", subject: input.subject });
      return user;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const winner = await find(pool);
      if (winner !== undefined) {
        return winner;
      }
    }
    throw err;
  }
}

const UPDATE_EMAIL = `
  UPDATE identity.users
  SET email = lower($2::text)
  WHERE id = $1`;

/** Stores the account's email (lowercased by Postgres, like createUser). Never a key. */
export async function setUserEmail(db: Queryable, userId: string, email: string): Promise<void> {
  await timedQuery(db, "identity.setUserEmail", UPDATE_EMAIL,[userId, email.trim()]);
}

const UPDATE_STATUS = `
  UPDATE identity.users
  SET status = $2
  WHERE id = $1
  RETURNING id`;

/** Disables or re-enables an account. False when the user does not exist. */
export async function setUserStatus(db: Queryable, userId: string, status: UserStatus): Promise<boolean> {
  const result = await timedQuery(db, "identity.setUserStatus", UPDATE_STATUS,[userId, status]);
  return result.rows.length > 0;
}
