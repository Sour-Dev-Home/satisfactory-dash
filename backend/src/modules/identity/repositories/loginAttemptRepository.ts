import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { parseFirst } from "../../../platform/db/rows.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { ReturnPathSchema } from "../returnPath.js";

/**
 * One row per in-flight OIDC login (ADR-0025 decision 3): state, nonce and the PKCE verifier live
 * here for 10 minutes; the browser holds only a random id in a cookie. The attempt is consumed
 * exactly once by a guarded DELETE ... RETURNING (single use, like ADR-0020's enrollment codes), so
 * a replayed callback finds nothing.
 */
export const LOGIN_ATTEMPT_TTL_MINUTES = 10;

export function newLoginAttemptId(): { id: string; idHash: Buffer } {
  const id = randomBytes(32).toString("base64url");
  return { id, idHash: hashLoginAttemptId(id) };
}

export function hashLoginAttemptId(id: string): Buffer {
  return createHash("sha256").update(id).digest();
}

export interface LoginAttempt {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnPath: string;
}

const LoginAttemptRowSchema = z.object({
  state: z.string(),
  nonce: z.string(),
  code_verifier: z.string(),
  return_path: z.string(),
});

const INSERT_ATTEMPT = `
  INSERT INTO identity.login_attempts (id_hash, state, nonce, code_verifier, return_path, expires_at)
  VALUES ($1, $2, $3, $4, $5, now() + make_interval(mins => $6::int))`;

/** The return path is validated here (ReturnPathSchema) and again by the table's CHECK
 *  constraint, which uses the same regex: a relative, ASCII-only /app path or nothing. */
export async function createLoginAttempt(
  db: Queryable,
  input: { idHash: Buffer } & LoginAttempt,
): Promise<void> {
  if (!ReturnPathSchema.safeParse(input.returnPath).success) {
    throw new RangeError("The login return path must be a relative, ASCII-only /app path.");
  }
  await db.query(INSERT_ATTEMPT, [
    input.idHash,
    input.state,
    input.nonce,
    input.codeVerifier,
    input.returnPath,
    LOGIN_ATTEMPT_TTL_MINUTES,
  ]);
}

const CONSUME_ATTEMPT = `
  DELETE FROM identity.login_attempts
  WHERE id_hash = $1 AND expires_at > now()
  RETURNING state, nonce, code_verifier, return_path`;

/** Single use: returns the attempt and deletes it in one statement, or undefined when it is
 *  unknown, expired or already consumed. */
export async function consumeLoginAttempt(db: Queryable, idHash: Buffer): Promise<LoginAttempt | undefined> {
  const result = await db.query(CONSUME_ATTEMPT, [idHash]);
  const row = parseFirst(LoginAttemptRowSchema, result.rows, "identity.consumeLoginAttempt");
  return row === undefined
    ? undefined
    : { state: row.state, nonce: row.nonce, codeVerifier: row.code_verifier, returnPath: row.return_path };
}

const DELETE_EXPIRED_ATTEMPTS = `
  DELETE FROM identity.login_attempts
  WHERE expires_at < now()
  RETURNING 1 AS deleted`;

/** Housekeeping for attempts nobody came back for. Returns the count. */
export async function deleteExpiredLoginAttempts(db: Queryable): Promise<number> {
  const result = await db.query(DELETE_EXPIRED_ATTEMPTS);
  return result.rows.length;
}
