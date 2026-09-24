import { z } from "zod";
import { parseFirst, parseOne } from "../../../platform/db/rows.js";
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
  const result = await db.query(INSERT_USER, [input.displayName.trim(), email]);
  return toUser(parseOne(UserRowSchema, result.rows, "identity.createUser"));
}

const SELECT_USER_BY_ID = `
  SELECT id, display_name, email, status, created_at
  FROM identity.users
  WHERE id = $1`;

export async function getUserById(db: Queryable, id: string): Promise<User | undefined> {
  const result = await db.query(SELECT_USER_BY_ID, [id]);
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
  const result = await db.query(SELECT_USER_BY_IDENTITY, [provider, subject]);
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
  const result = await db.query(INSERT_IDENTITY, [input.userId, input.provider, input.subject]);
  return parseOne(IdentityIdRowSchema, result.rows, "identity.addIdentity").id;
}

const UPDATE_STATUS = `
  UPDATE identity.users
  SET status = $2
  WHERE id = $1
  RETURNING id`;

/** Disables or re-enables an account. False when the user does not exist. */
export async function setUserStatus(db: Queryable, userId: string, status: UserStatus): Promise<boolean> {
  const result = await db.query(UPDATE_STATUS, [userId, status]);
  return result.rows.length > 0;
}
