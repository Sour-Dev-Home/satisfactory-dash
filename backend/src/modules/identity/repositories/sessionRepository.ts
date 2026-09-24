import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { parseFirst } from "../../../platform/db/rows.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";

/**
 * Server-side sessions (ADR-0020, ADR-0025 decision 4). The browser holds a 32-byte random id in
 * the session cookie; the table stores only sha256(id), so a database leak cannot be replayed.
 * A new id on every login (no fixation); logout and "sign out everywhere" set `revoked_at`.
 */
export const SESSION_ID_BYTES = 32;

/** A fresh session id (for the cookie) and its hash (for the table). */
export function newSessionId(): { id: string; idHash: Buffer } {
  const id = randomBytes(SESSION_ID_BYTES).toString("base64url");
  return { id, idHash: hashSessionId(id) };
}

export function hashSessionId(id: string): Buffer {
  return createHash("sha256").update(id).digest();
}

export interface ActiveSession {
  userId: string;
  displayName: string;
  email: string | null;
  expiresAt: Date;
  /** null until first touched; the store touches at most once a minute. */
  lastSeenAt: Date | null;
  /** "password" and/or "google", read in the same query. */
  authMethods: string[];
}

const ActiveSessionRowSchema = z.object({
  user_id: z.string(),
  display_name: z.string(),
  email: z.string().nullable(),
  expires_at: z.date(),
  last_seen_at: z.date().nullable(),
  providers: z.array(z.enum(["local", "google"])),
});

/** One year; far above any real session lifetime and well inside int4. */
export const MAX_TTL_SECONDS = 365 * 24 * 3600;

const INSERT_SESSION = `
  INSERT INTO identity.sessions (id_hash, user_id, expires_at)
  VALUES ($1, $2, now() + make_interval(secs => $3::int))`;

/** The lifetime is a duration, and the database's clock sets the expiry, so validity checks
 *  (`expires_at > now()`) and creation always agree. */
export async function createSession(
  db: Queryable,
  input: { idHash: Buffer; userId: string; ttlSeconds: number },
): Promise<void> {
  const ttl = Math.trunc(input.ttlSeconds);
  // NaN, 0, negatives (the expires_at > created_at CHECK) and values past int4 (make_interval
  // overflow) would otherwise surface as raw database errors; refuse them up front.
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > MAX_TTL_SECONDS) {
    throw new RangeError(`Session ttlSeconds must be between 1 and ${MAX_TTL_SECONDS}.`);
  }
  await db.query(INSERT_SESSION, [input.idHash, input.userId, ttl]);
}

const SELECT_ACTIVE_SESSION = `
  SELECT s.user_id, u.display_name, u.email, s.expires_at, s.last_seen_at,
         ARRAY(SELECT i.provider FROM identity.auth_identities i WHERE i.user_id = s.user_id ORDER BY i.provider) AS providers
  FROM identity.sessions s
  JOIN identity.users u ON u.id = s.user_id
  WHERE s.id_hash = $1
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND u.status = 'active'`;

/** The signed-in user for this session hash, or undefined when it is unknown, revoked, expired or
 *  its account is disabled. Time is the database's (`now()`), never the app's clock. */
export async function findActiveSession(db: Queryable, idHash: Buffer): Promise<ActiveSession | undefined> {
  const result = await db.query(SELECT_ACTIVE_SESSION, [idHash]);
  const row = parseFirst(ActiveSessionRowSchema, result.rows, "identity.findActiveSession");
  return row === undefined
    ? undefined
    : {
        userId: row.user_id,
        displayName: row.display_name,
        email: row.email,
        expiresAt: row.expires_at,
        lastSeenAt: row.last_seen_at,
        authMethods: row.providers.map((provider) => (provider === "local" ? "password" : provider)),
      };
}

const TOUCH_SESSION = `
  UPDATE identity.sessions
  SET last_seen_at = now()
  WHERE id_hash = $1
    AND revoked_at IS NULL
    AND expires_at > now()
    AND (last_seen_at IS NULL OR last_seen_at < now() - interval '1 minute')
  RETURNING 1 AS touched`;

/** Records activity at most once a minute (the WHERE makes it a no-op otherwise, so a busy
 *  session does not write on every request). True when a write happened. */
export async function touchSession(db: Queryable, idHash: Buffer): Promise<boolean> {
  const result = await db.query(TOUCH_SESSION, [idHash]);
  return result.rows.length > 0;
}

const REVOKE_SESSION = `
  UPDATE identity.sessions
  SET revoked_at = now()
  WHERE id_hash = $1 AND revoked_at IS NULL
  RETURNING user_id`;

const RevokedRowSchema = z.object({ user_id: z.string() });

/** Logout. The user id when this call revoked it (for the audit row), undefined when the
 *  session was unknown or already revoked (both fine). */
export async function revokeSession(db: Queryable, idHash: Buffer): Promise<string | undefined> {
  const result = await db.query(REVOKE_SESSION, [idHash]);
  return parseFirst(RevokedRowSchema, result.rows, "identity.revokeSession")?.user_id;
}

const REVOKE_ALL_FOR_USER = `
  UPDATE identity.sessions
  SET revoked_at = now()
  WHERE user_id = $1 AND revoked_at IS NULL
  RETURNING 1 AS revoked`;

/** "Sign out everywhere" for one user. Returns how many sessions were revoked. */
export async function revokeAllSessionsForUser(db: Queryable, userId: string): Promise<number> {
  const result = await db.query(REVOKE_ALL_FOR_USER, [userId]);
  return result.rows.length;
}

const REVOKE_ALL = `
  UPDATE identity.sessions
  SET revoked_at = now()
  WHERE revoked_at IS NULL
  RETURNING 1 AS revoked`;

/** The emergency revoke-all (replaces rotating SESSION_SECRET). Returns the count. */
export async function revokeAllSessions(db: Queryable): Promise<number> {
  const result = await db.query(REVOKE_ALL);
  return result.rows.length;
}

/** Sessions are kept 30 days after they expire (privacy policy retention), then purged. */
export const SESSION_PURGE_AFTER_DAYS = 30;

const DELETE_EXPIRED_BATCH = `
  DELETE FROM identity.sessions
  WHERE id_hash IN (
    SELECT id_hash FROM identity.sessions
    WHERE expires_at < now() - make_interval(days => $1::int)
    LIMIT $2
  )
  RETURNING 1 AS deleted`;

/** Housekeeping: drops up to `batchSize` sessions that expired more than 30 days ago (a small
 *  batch, so a purge never holds a long lock). Returns the count; call until it is below the batch. */
export async function deleteExpiredSessions(db: Queryable, batchSize = 1000): Promise<number> {
  const result = await db.query(DELETE_EXPIRED_BATCH, [SESSION_PURGE_AFTER_DAYS, Math.max(1, Math.trunc(batchSize))]);
  return result.rows.length;
}
