import { z } from "zod";
import { parseFirst } from "../../../platform/db/rows.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { timedQuery } from "../../../platform/db/timedQuery.js";

/**
 * ADR-0051 section 1 + ADR-0057 D6: the SQL behind device-code pairing (table `agents.pairings`). The pairing secret is
 * stored only as its SHA-256 (the agent's own `sha256`, agentRepository.ts). "Open" means not expired, not approved and not
 * consumed. Every function takes a `Queryable`, so approve and mint can run several of them in one transaction. All times
 * are the database's `now()`, so the comparisons never depend on this process's clock.
 */

/** Rows are kept this long after they expire (ADR-0051: the session name and agent version live at most ~75 minutes). */
export const PAIRING_RETENTION_AFTER_EXPIRY_HOURS = 1;

// A user code or secret hash that already exists inserts nothing (the caller draws again): a unique violation would abort
// the transaction.
const INSERT_PAIRING = `
  INSERT INTO agents.pairings (secret_hash, user_code, server_name, agent_version, expires_at)
  VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))
  ON CONFLICT DO NOTHING
  RETURNING id`;

/** True when the pairing was stored, false when its code or secret hash already exists (draw again). */
export async function insertPairing(
  db: Queryable,
  input: { secretHash: Buffer; userCode: string; serverName: string | undefined; agentVersion: string; expiresInSeconds: number },
): Promise<boolean> {
  const result = await timedQuery(db, "agents.insertPairing", INSERT_PAIRING, [
    input.secretHash,
    input.userCode,
    input.serverName ?? null,
    input.agentVersion,
    input.expiresInSeconds,
  ]);
  return result.rows.length > 0;
}

const PEEK_SERVER = `
  SELECT server_id::text AS server_id FROM agents.pairings WHERE secret_hash = $1`;

/** The internal server uuid a pairing was approved for, read WITHOUT a lock (null when not approved, undefined when unknown).
 *  The poll reads it first so it can lock the server row BEFORE the pairing row, the order the approval takes. */
export async function peekPairingServer(db: Queryable, secretHash: Buffer): Promise<string | null | undefined> {
  const result = await timedQuery(db, "agents.peekPairingServer", PEEK_SERVER, [secretHash]);
  const row = parseFirst(z.object({ server_id: z.string().nullable() }), result.rows, "agents.peekPairingServer");
  return row === undefined ? undefined : row.server_id;
}

const LOCK_SERVER_BY_ID = `
  SELECT id::text AS id FROM servers.servers WHERE id = $1 AND deleted_at IS NULL FOR NO KEY UPDATE`;

/** Locks a live server row by its internal uuid (the lock `lockServer` takes by public id). False for a removed server. */
export async function lockServerRow(db: Queryable, serverUuid: string): Promise<boolean> {
  const result = await timedQuery(db, "agents.lockServerRow", LOCK_SERVER_BY_ID, [serverUuid]);
  return result.rows.length > 0;
}

// The poll's row, LOCKED: two polls of one pairing (a retry, a replay) are serialised, so exactly one mints.
const LOCK_BY_SECRET = `
  SELECT id::text AS id, agent_version, server_id::text AS server_id, approved_by IS NOT NULL AS approved,
         consumed_at IS NOT NULL AS consumed, expires_at > now() AS open, poll_interval_seconds,
         extract(epoch FROM (now() - last_poll_at))::float8 AS seconds_since_poll
  FROM agents.pairings
  WHERE secret_hash = $1
  FOR UPDATE`;

export interface LockedPairing {
  id: string;
  agentVersion: string;
  /** The internal server uuid the approval is for; null before approval. */
  serverUuid: string | null;
  approved: boolean;
  consumed: boolean;
  /** Not yet expired (the database's clock). */
  open: boolean;
  pollIntervalSeconds: number;
  /** Null before the first poll. */
  secondsSincePoll: number | null;
}

export async function lockPairingBySecret(db: Queryable, secretHash: Buffer): Promise<LockedPairing | undefined> {
  const result = await timedQuery(db, "agents.lockPairingBySecret", LOCK_BY_SECRET, [secretHash]);
  const row = parseFirst(
    z.object({
      id: z.string(),
      agent_version: z.string(),
      server_id: z.string().nullable(),
      approved: z.boolean(),
      consumed: z.boolean(),
      open: z.boolean(),
      poll_interval_seconds: z.number(),
      seconds_since_poll: z.number().nullable(),
    }),
    result.rows,
    "agents.lockPairingBySecret",
  );
  if (row === undefined) return undefined;
  return {
    id: row.id,
    agentVersion: row.agent_version,
    serverUuid: row.server_id,
    approved: row.approved,
    consumed: row.consumed,
    open: row.open,
    pollIntervalSeconds: row.poll_interval_seconds,
    secondsSincePoll: row.seconds_since_poll,
  };
}

const TOUCH_POLL = `
  UPDATE agents.pairings
  SET last_poll_at = now(), poll_interval_seconds = $2
  WHERE id = $1`;

/** Records a poll (always, so hammering never goes unnoticed) and the interval now expected. */
export async function touchPairingPoll(db: Queryable, id: string, pollIntervalSeconds: number): Promise<void> {
  await timedQuery(db, "agents.touchPairingPoll", TOUCH_POLL, [id, pollIntervalSeconds]);
}

// One guarded UPDATE makes a pairing single-use, as for an enrolment code.
const CONSUME_PAIRING = `
  UPDATE agents.pairings
  SET consumed_at = now()
  WHERE id = $1 AND consumed_at IS NULL
  RETURNING id`;

/** True when this call spent the pairing. */
export async function consumePairing(db: Queryable, id: string): Promise<boolean> {
  const result = await timedQuery(db, "agents.consumePairing", CONSUME_PAIRING, [id]);
  return result.rows.length > 0;
}

const FIND_OPEN_BY_CODE = `
  SELECT server_name, agent_version, created_at
  FROM agents.pairings
  WHERE user_code = $1 AND approved_by IS NULL AND consumed_at IS NULL AND expires_at > now()`;

export interface OpenPairing {
  serverName: string | null;
  agentVersion: string;
  createdAt: Date;
}

/** The open pairing a code names, or undefined for an unknown, approved, spent or expired code (all alike). */
export async function findOpenPairing(db: Queryable, userCode: string): Promise<OpenPairing | undefined> {
  const result = await timedQuery(db, "agents.findOpenPairing", FIND_OPEN_BY_CODE, [userCode]);
  const row = parseFirst(
    z.object({ server_name: z.string().nullable(), agent_version: z.string(), created_at: z.date() }),
    result.rows,
    "agents.findOpenPairing",
  );
  return row === undefined ? undefined : { serverName: row.server_name, agentVersion: row.agent_version, createdAt: row.created_at };
}

// The approval itself: whoever's UPDATE finds the pairing open wins; a second approval, an expired or spent code gets no row.
const APPROVE_PAIRING = `
  UPDATE agents.pairings
  SET approved_by = $2, approved_at = now(), server_id = $3
  WHERE user_code = $1 AND approved_by IS NULL AND consumed_at IS NULL AND expires_at > now()
  RETURNING id`;

/** True when this call approved the pairing for the server (internal uuid). */
export async function approvePairing(db: Queryable, input: { userCode: string; userId: string; serverUuid: string }): Promise<boolean> {
  const result = await timedQuery(db, "agents.approvePairing", APPROVE_PAIRING, [input.userCode, input.userId, input.serverUuid]);
  return result.rows.length > 0;
}

// Rows go one hour after they expire. `unused` is those never spent (never approved, or approved and never collected).
const SWEEP_PAIRINGS = `
  DELETE FROM agents.pairings
  WHERE expires_at < now() - make_interval(hours => $1)
  RETURNING consumed_at IS NULL AS unused`;

export async function sweepPairings(db: Queryable): Promise<{ deleted: number; unused: number }> {
  const result = await timedQuery(db, "agents.sweepPairings", SWEEP_PAIRINGS, [PAIRING_RETENTION_AFTER_EXPIRY_HOURS]);
  const rows = result.rows as { unused: boolean }[];
  return { deleted: rows.length, unused: rows.filter((row) => row.unused).length };
}
