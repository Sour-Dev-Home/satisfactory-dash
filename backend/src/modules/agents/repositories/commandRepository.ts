import { z } from "zod";
import { parseFirst, parseRows } from "../../../platform/db/rows.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";

/**
 * ADR-0031 PR 5b: the SQL behind commands to an edge agent. Every statement is scoped by the server (the agent's own
 * credential, or the public id the membership check already passed), never by a command id alone, so a command id from
 * another server matches nothing. The status a caller sees is EFFECTIVE: an open command past its expiry reads as
 * `expired` even before the sweeper has written that, so nobody is told a dead command is still pending.
 */
export const COMMAND_TTL_MS = 60_000;
/** A server can have at most this many open commands (a stray script cannot pile them up for the agent to run). */
export const MAX_OPEN_COMMANDS = 5;
/** Finished commands are kept this long, then purged (only a boolean target and a status; nothing personal). */
export const COMMAND_RETENTION_DAYS = 7;

const CommandRowSchema = z.object({
  id: z.string(),
  type: z.string(),
  params: z.record(z.string(), z.unknown()),
  status: z.string(),
  created_at: z.date(),
  expires_at: z.date(),
  completed_at: z.date().nullable(),
  result_code: z.string().nullable(),
});

export interface CommandRow {
  id: string;
  type: string;
  params: Record<string, unknown>;
  /** pending, sent, succeeded, failed or expired (effective, see above). */
  status: string;
  createdAt: Date;
  expiresAt: Date;
  completedAt: Date | null;
  resultCode: string | null;
}

const toCommand = (row: z.output<typeof CommandRowSchema>): CommandRow => ({
  id: row.id,
  type: row.type,
  params: row.params,
  status: row.status,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  completedAt: row.completed_at,
  resultCode: row.result_code,
});

// SQL constants are plain templates without interpolation (sqlGuard.test.ts), so the effective-status expression is
// spelled out in each statement that returns a status.
const COUNT_OPEN = `
  SELECT count(*)::int AS count
  FROM agents.commands
  WHERE server_id = $1 AND status IN ('pending', 'sent') AND expires_at > now()`;

const INSERT_COMMAND = `
  INSERT INTO agents.commands (server_id, type, params, expires_at, created_by)
  VALUES ($1, $2, $3::jsonb, now() + ($4::int * interval '1 millisecond'), $5)
  RETURNING id::text AS id, type, params, status, created_at, expires_at, completed_at, result_code`;

/** How many commands this server has open (pending or sent, not yet expired). */
export async function countOpenCommands(db: Queryable, serverUuid: string): Promise<number> {
  const result = await db.query(COUNT_OPEN, [serverUuid]);
  return parseFirst(z.object({ count: z.number().int() }), result.rows, "agents.countOpenCommands")?.count ?? 0;
}

/** Stores a new command that expires `COMMAND_TTL_MS` from now (the database's clock). */
export async function insertCommand(
  db: Queryable,
  input: { serverUuid: string; type: string; params: Record<string, unknown>; createdBy: string | undefined },
): Promise<CommandRow> {
  const result = await db.query(INSERT_COMMAND, [input.serverUuid, input.type, JSON.stringify(input.params), COMMAND_TTL_MS, input.createdBy ?? null]);
  const row = parseFirst(CommandRowSchema, result.rows, "agents.insertCommand");
  if (row === undefined) throw new Error("the command was not stored");
  return toCommand(row);
}

// The agent's poll: every open, unexpired command of THIS server, and only while an agent is enrolled and not revoked (a
// poll that began before a revoke gets nothing when it wakes; the security review of PR 5b). A pending one becomes `sent`; one already `sent` is
// handed out again (the agent may have restarted before reporting; it de-duplicates by id, and the expiry bounds it).
const CLAIM_OPEN = `
  UPDATE agents.commands c
  SET status = 'sent', sent_at = COALESCE(c.sent_at, now())
  WHERE c.server_id = $1 AND c.status IN ('pending', 'sent') AND c.expires_at > now()
    AND EXISTS (SELECT 1 FROM agents.agent_credentials k WHERE k.server_id = c.server_id AND k.revoked_at IS NULL)
  RETURNING c.id::text AS id, c.type AS type, c.params AS params, c.status AS status, c.created_at AS created_at,
            c.expires_at AS expires_at, c.completed_at AS completed_at, c.result_code AS result_code`;

/** The server's open commands, oldest first, marked `sent`. */
export async function claimOpenCommands(db: Queryable, serverUuid: string): Promise<CommandRow[]> {
  const result = await db.query(CLAIM_OPEN, [serverUuid]);
  return parseRows(CommandRowSchema, result.rows, "agents.claimOpenCommands")
    .map(toCommand)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
}

const HAS_OPEN = `
  SELECT EXISTS (
    SELECT 1 FROM agents.commands WHERE server_id = $1 AND status IN ('pending', 'sent') AND expires_at > now()
  ) AS open`;

export async function hasOpenCommands(db: Queryable, serverUuid: string): Promise<boolean> {
  const result = await db.query(HAS_OPEN, [serverUuid]);
  return parseFirst(z.object({ open: z.boolean() }), result.rows, "agents.hasOpenCommands")?.open ?? false;
}

// Reporting a result: one guarded UPDATE, scoped to the agent's own server and to a command that is still open and not
// past its expiry. Whoever reports first wins; a late report does not resurrect an expired command.
const COMPLETE = `
  UPDATE agents.commands
  SET status = $3, completed_at = now(), result_code = $4
  WHERE id = $1 AND server_id = $2 AND status IN ('pending', 'sent') AND expires_at > now()
  RETURNING id`;

const LOOK_UP_FOR_REPORT = `
  SELECT c.status AS status, (c.expires_at <= now()) AS past_expiry
  FROM agents.commands c
  WHERE c.id = $1 AND c.server_id = $2`;

const MARK_EXPIRED = `
  UPDATE agents.commands
  SET status = 'expired', completed_at = now()
  WHERE id = $1 AND server_id = $2 AND status IN ('pending', 'sent') AND expires_at <= now()`;

export type CompleteOutcome = "accepted" | "already_done" | "not_found" | "expired";

/**
 * Records the agent's result. `already_done` when the command was completed before (a retried report changes nothing,
 * whatever it says); `expired` when it ran out before the result arrived; `not_found` for an unknown id and for another
 * server's command alike.
 */
export async function completeCommand(
  db: Queryable,
  input: { serverUuid: string; commandId: string; ok: boolean; code: string | undefined },
): Promise<CompleteOutcome> {
  if (!isCommandId(input.commandId)) return "not_found"; // the column is a uuid: Postgres would reject other text (a 500)
  const done = await db.query(COMPLETE, [input.commandId, input.serverUuid, input.ok ? "succeeded" : "failed", input.ok ? null : (input.code ?? null)]);
  if (done.rows.length > 0) return "accepted";
  const found = parseFirst(z.object({ status: z.string(), past_expiry: z.boolean() }), (await db.query(LOOK_UP_FOR_REPORT, [input.commandId, input.serverUuid])).rows, "agents.completeCommand");
  if (found === undefined) return "not_found";
  if (found.status === "succeeded" || found.status === "failed") return "already_done";
  if (found.status === "expired" || found.past_expiry) {
    await db.query(MARK_EXPIRED, [input.commandId, input.serverUuid]);
    return "expired";
  }
  return "already_done"; // it was open and unexpired, and lost a race to a concurrent report
}

// The user's view of one command, by the server's PUBLIC id (already passed by the membership check) and the command id.
const GET_FOR_SERVER = `
  SELECT c.id::text AS id, c.type AS type, c.params AS params,
         CASE WHEN c.status IN ('pending', 'sent') AND c.expires_at <= now() THEN 'expired' ELSE c.status END AS status,
         c.created_at AS created_at, c.expires_at AS expires_at, c.completed_at AS completed_at, c.result_code AS result_code
  FROM agents.commands c
  JOIN servers.servers s ON s.id = c.server_id
  WHERE s.public_id = $1 AND s.deleted_at IS NULL AND c.id = $2::uuid`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isCommandId = (value: string): boolean => UUID.test(value);

/** One command of this server, or undefined (unknown, another server's, or not an id at all). */
export async function getCommandForServer(db: Queryable, publicId: string, commandId: string): Promise<CommandRow | undefined> {
  if (!isCommandId(commandId)) return undefined;
  const result = await db.query(GET_FOR_SERVER, [publicId, commandId]);
  const row = parseFirst(CommandRowSchema, result.rows, "agents.getCommandForServer");
  return row === undefined ? undefined : toCommand(row);
}

// The newest commands of a server, for the auto-pause read (what was last asked and confirmed).
const RECENT_FOR_SERVER = `
  SELECT c.id::text AS id, c.type AS type, c.params AS params,
         CASE WHEN c.status IN ('pending', 'sent') AND c.expires_at <= now() THEN 'expired' ELSE c.status END AS status,
         c.created_at AS created_at, c.expires_at AS expires_at, c.completed_at AS completed_at, c.result_code AS result_code
  FROM agents.commands c
  JOIN servers.servers s ON s.id = c.server_id
  WHERE s.public_id = $1 AND s.deleted_at IS NULL AND c.type = $2
  ORDER BY c.created_at DESC
  LIMIT 20`;

export async function recentCommandsOfType(db: Queryable, publicId: string, type: string): Promise<CommandRow[]> {
  const result = await db.query(RECENT_FOR_SERVER, [publicId, type]);
  return parseRows(CommandRowSchema, result.rows, "agents.recentCommandsOfType").map(toCommand);
}

// The sweeper: open commands past their expiry become `expired` (the reads above already show them so), and old finished
// ones are purged.
const EXPIRE_STALE = `
  UPDATE agents.commands
  SET status = 'expired', completed_at = now()
  WHERE status IN ('pending', 'sent') AND expires_at <= now()
  RETURNING id`;

const PURGE_OLD = `
  DELETE FROM agents.commands
  WHERE status IN ('succeeded', 'failed', 'expired') AND COALESCE(completed_at, expires_at) < now() - ($1::int * interval '1 day')
  RETURNING id`;

export async function expireStaleCommands(db: Queryable): Promise<number> {
  return (await db.query(EXPIRE_STALE, [])).rows.length;
}

export async function purgeOldCommands(db: Queryable): Promise<number> {
  return (await db.query(PURGE_OLD, [COMMAND_RETENTION_DAYS])).rows.length;
}
