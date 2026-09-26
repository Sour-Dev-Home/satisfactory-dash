import { createHash } from "node:crypto";
import { z } from "zod";
import { parseFirst } from "../../../platform/db/rows.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";

/**
 * ADR-0031 PR 5a: the SQL behind agent enrolment and credentials. A code and an agent's secret are stored only as their
 * SHA-256 (a code is a 10-minute, single-use secret of 40 bits; the secret is 256 random bits, so a fast hash is enough
 * and lets the auth lookup be one indexed equality). Every function takes a `Queryable`, so the enrolment can run
 * several of them in one transaction.
 */

/** The hash both a code and a secret are stored under. */
export const sha256 = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();

// SQL constants are plain templates without interpolation (sqlGuard.test.ts).
const LOCK_SERVER = `
  SELECT s.id::text AS id, s.connection_kind AS connection_kind
  FROM servers.servers s
  WHERE s.public_id = $1 AND s.deleted_at IS NULL
  FOR NO KEY UPDATE`;

export interface LockedServer {
  /** The internal uuid, as text. */
  id: string;
  connectionKind: string;
}

/**
 * Locks the server's row for the rest of the transaction (like the alerts writes: FOR NO KEY UPDATE, which does not
 * conflict with the foreign-key locks the history and alert writers take), so creating a code and revoking cannot race.
 * Undefined for an unknown or removed server.
 */
export async function lockServer(db: Queryable, publicId: string): Promise<LockedServer | undefined> {
  const result = await db.query(LOCK_SERVER, [publicId]);
  const row = parseFirst(z.object({ id: z.string(), connection_kind: z.string() }), result.rows, "agents.lockServer");
  return row === undefined ? undefined : { id: row.id, connectionKind: row.connection_kind };
}

// A server has at most one live code: making a new one drops the old, and expired ones go with it.
const DELETE_OPEN_CODES = `
  DELETE FROM agents.enrollment_codes
  WHERE server_id = $1 AND (consumed_at IS NULL OR expires_at < now())`;

export async function deleteOpenCodes(db: Queryable, serverUuid: string): Promise<void> {
  await db.query(DELETE_OPEN_CODES, [serverUuid]);
}

// A code that collides with an existing hash inserts nothing (the caller draws another): a unique violation would abort
// the transaction.
const INSERT_CODE = `
  INSERT INTO agents.enrollment_codes (server_id, code_hash, expires_at, created_by)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (code_hash) DO NOTHING
  RETURNING id`;

/** True when the code was stored, false when its hash already exists (draw another). */
export async function insertCode(
  db: Queryable,
  input: { serverUuid: string; codeHash: Buffer; expiresAt: Date; createdBy: string | undefined },
): Promise<boolean> {
  const result = await db.query(INSERT_CODE, [input.serverUuid, input.codeHash, input.expiresAt, input.createdBy ?? null]);
  return result.rows.length > 0;
}

// The single statement that makes a code single-use: whoever's UPDATE finds it unconsumed and unexpired wins, everyone
// else (a second request, a replay, a race) gets no row. The join makes a removed server's code dead too.
const CONSUME_CODE = `
  UPDATE agents.enrollment_codes c
  SET consumed_at = now()
  FROM servers.servers s
  WHERE s.id = c.server_id AND s.deleted_at IS NULL
    AND c.code_hash = $1 AND c.consumed_at IS NULL AND c.expires_at > now()
  RETURNING c.server_id::text AS server_id`;

/** The server's internal id when the code was valid and is now spent; undefined for an unknown, used or expired code alike. */
export async function consumeCode(db: Queryable, codeHash: Buffer): Promise<string | undefined> {
  const result = await db.query(CONSUME_CODE, [codeHash]);
  return parseFirst(z.object({ server_id: z.string() }), result.rows, "agents.consumeCode")?.server_id;
}

// Enrolling again replaces the credential: a new secret, not revoked, never seen.
const UPSERT_CREDENTIAL = `
  INSERT INTO agents.agent_credentials (server_id, secret_hash, agent_version)
  VALUES ($1, $2, $3)
  ON CONFLICT (server_id) DO UPDATE
    SET secret_hash = EXCLUDED.secret_hash, agent_version = EXCLUDED.agent_version,
        created_at = now(), last_seen_at = NULL, revoked_at = NULL`;

export async function upsertCredential(db: Queryable, input: { serverUuid: string; secretHash: Buffer; agentVersion: string }): Promise<void> {
  await db.query(UPSERT_CREDENTIAL, [input.serverUuid, input.secretHash, input.agentVersion]);
}

const FIND_ACTIVE = `
  SELECT c.server_id::text AS server_id, s.public_id AS public_id
  FROM agents.agent_credentials c
  JOIN servers.servers s ON s.id = c.server_id
  WHERE c.secret_hash = $1 AND c.revoked_at IS NULL AND s.deleted_at IS NULL`;

export interface ActiveAgent {
  /** The internal uuid, as text. Never sent to a client. */
  serverUuid: string;
  publicId: string;
}

/** The server an agent's secret belongs to, or undefined for an unknown secret, a revoked one, or a removed server (all alike). */
export async function findActiveAgent(db: Queryable, secretHash: Buffer): Promise<ActiveAgent | undefined> {
  const result = await db.query(FIND_ACTIVE, [secretHash]);
  const row = parseFirst(z.object({ server_id: z.string(), public_id: z.string() }), result.rows, "agents.findActiveAgent");
  return row === undefined ? undefined : { serverUuid: row.server_id, publicId: row.public_id };
}

const TOUCH = `
  UPDATE agents.agent_credentials
  SET last_seen_at = now()
  WHERE server_id = $1 AND revoked_at IS NULL`;

export async function touchAgent(db: Queryable, serverUuid: string): Promise<void> {
  await db.query(TOUCH, [serverUuid]);
}

const SET_VERSION = `
  UPDATE agents.agent_credentials
  SET agent_version = $2
  WHERE server_id = $1 AND revoked_at IS NULL`;

export async function setAgentVersion(db: Queryable, serverUuid: string, agentVersion: string): Promise<void> {
  await db.query(SET_VERSION, [serverUuid, agentVersion]);
}

const AGENT_STATUS = `
  SELECT s.connection_kind AS connection_kind, c.server_id IS NOT NULL AND c.revoked_at IS NULL AS enrolled,
         c.last_seen_at AS last_seen_at, c.agent_version AS agent_version
  FROM servers.servers s
  LEFT JOIN agents.agent_credentials c ON c.server_id = s.id
  WHERE s.public_id = $1 AND s.deleted_at IS NULL`;

export interface AgentStatusRow {
  connectionKind: string;
  enrolled: boolean;
  lastSeenAt: Date | null;
  agentVersion: string | null;
}

/** Undefined for an unknown or removed server. A revoked credential reads as "not enrolled", without a version or time. */
export async function getAgentStatus(db: Queryable, publicId: string): Promise<AgentStatusRow | undefined> {
  const result = await db.query(AGENT_STATUS, [publicId]);
  const row = parseFirst(
    z.object({ connection_kind: z.string(), enrolled: z.boolean(), last_seen_at: z.date().nullable(), agent_version: z.string().nullable() }),
    result.rows,
    "agents.getAgentStatus",
  );
  if (row === undefined) return undefined;
  return {
    connectionKind: row.connection_kind,
    enrolled: row.enrolled,
    lastSeenAt: row.enrolled ? row.last_seen_at : null,
    agentVersion: row.enrolled ? row.agent_version : null,
  };
}

const REVOKE = `
  UPDATE agents.agent_credentials
  SET revoked_at = now()
  WHERE server_id = $1 AND revoked_at IS NULL
  RETURNING server_id`;

/** True when a credential was revoked now, false when there was none or it was already revoked. */
export async function revokeCredential(db: Queryable, serverUuid: string): Promise<boolean> {
  const result = await db.query(REVOKE, [serverUuid]);
  return result.rows.length > 0;
}
