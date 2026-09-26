import { z } from "zod";
import { parseFirst, parseOne, parseRows } from "../../../platform/db/rows.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { recordAuditEvent } from "../../../platform/audit/auditRepository.js";
import { withTransaction } from "../../../platform/db/transaction.js";

/**
 * The server registry in Postgres (ADR-0020, ADR-0025): the public id used in every
 * /api/servers/:serverId URL, its display name and hosting mode. HOW to reach a server (host,
 * ports, tokens) stays in local config; who may SEE it is memberships.
 */
export type HostingMode = "self" | "managed";
export type MemberRole = "owner" | "admin" | "viewer";
/** ADR-0030: 'local' is reached directly by this backend (operator only); 'agent' only through a player's edge agent. */
export type ConnectionKind = "local" | "agent";

export interface RegisteredServer {
  /** Internal primary key (uuid). Never sent to clients. */
  id: string;
  publicId: string;
  displayName: string;
  hostingMode: HostingMode;
  connectionKind: ConnectionKind;
}

const ServerRowSchema = z.object({
  id: z.string(),
  public_id: z.string(),
  display_name: z.string(),
  hosting_mode: z.enum(["self", "managed"]),
  connection_kind: z.enum(["local", "agent"]),
});

const toServer = (row: z.output<typeof ServerRowSchema>): RegisteredServer => ({
  id: row.id,
  publicId: row.public_id,
  displayName: row.display_name,
  hostingMode: row.hosting_mode,
  connectionKind: row.connection_kind,
});

const UPSERT_SERVER = `
  INSERT INTO servers.servers (public_id, display_name)
  VALUES ($1, $2)
  ON CONFLICT (public_id) DO UPDATE
    SET display_name = EXCLUDED.display_name, deleted_at = NULL
  RETURNING id, public_id, display_name, hosting_mode, connection_kind`;

/** Startup registration of a server named in local config: created, or its display name and
 *  live state refreshed (a configured server is by definition not deleted). Idempotent. */
export async function upsertConfiguredServer(
  db: Queryable,
  input: { publicId: string; displayName: string },
): Promise<RegisteredServer> {
  const result = await db.query(UPSERT_SERVER, [input.publicId, input.displayName]);
  return toServer(parseOne(ServerRowSchema, result.rows, "servers.upsertConfiguredServer"));
}

const ENSURE_SERVER = `
  INSERT INTO servers.servers (public_id, display_name)
  VALUES ($1, $2)
  ON CONFLICT (public_id) DO UPDATE SET deleted_at = NULL
  RETURNING id, public_id, display_name, hosting_mode, connection_kind`;

/** Like `upsertConfiguredServer`, but an existing row keeps its display name (an import must not undo
 *  a rename made in the app). A soft-deleted server is revived. Idempotent. */
export async function ensureServer(db: Queryable, input: { publicId: string; displayName: string }): Promise<RegisteredServer> {
  const result = await db.query(ENSURE_SERVER, [input.publicId, input.displayName]);
  return toServer(parseOne(ServerRowSchema, result.rows, "servers.ensureServer"));
}

const SELECT_BY_PUBLIC_ID = `
  SELECT id, public_id, display_name, hosting_mode, connection_kind
  FROM servers.servers
  WHERE public_id = $1 AND deleted_at IS NULL`;

export async function findServerByPublicId(db: Queryable, publicId: string): Promise<RegisteredServer | undefined> {
  const result = await db.query(SELECT_BY_PUBLIC_ID, [publicId]);
  const row = parseFirst(ServerRowSchema, result.rows, "servers.findServerByPublicId");
  return row === undefined ? undefined : toServer(row);
}

export interface UserServer {
  publicId: string;
  displayName: string;
  role: MemberRole;
}

const UserServerRowSchema = z.object({
  public_id: z.string(),
  display_name: z.string(),
  role: z.enum(["owner", "admin", "viewer"]),
});

const LIST_FOR_USER = `
  SELECT s.public_id, s.display_name, m.role
  FROM servers.server_members m
  JOIN servers.servers s ON s.id = m.server_id
  WHERE m.user_id = $1 AND s.deleted_at IS NULL
  ORDER BY s.display_name, s.public_id`;

/** The per-user server list (GET /api/servers): only servers this user is a member of, so a
 *  server they can't see is never named. */
export async function listServersForUser(db: Queryable, userId: string): Promise<UserServer[]> {
  const result = await db.query(LIST_FOR_USER, [userId]);
  return parseRows(UserServerRowSchema, result.rows, "servers.listServersForUser").map((row) => ({
    publicId: row.public_id,
    displayName: row.display_name,
    role: row.role,
  }));
}

const RENAME_SERVER = `
  UPDATE servers.servers
  SET display_name = $2
  WHERE public_id = $1 AND deleted_at IS NULL
  RETURNING id`;

/** Renames a live server (an edit that changes nothing about how it is reached). The audit event
 *  `server.updated` names only the field. False if the server is unknown or removed. */
export async function renameServer(
  pool: Parameters<typeof withTransaction>[0],
  publicId: string,
  displayName: string,
  audit: { actorUserId: string | null },
): Promise<boolean> {
  return withTransaction(pool, async (client) => {
    const result = await client.query(RENAME_SERVER, [publicId, displayName]);
    const row = parseFirst(IdRowSchema, result.rows, "servers.renameServer");
    if (row === undefined) return false;
    await recordAuditEvent(client, {
      action: "server.updated",
      actorUserId: audit.actorUserId ?? undefined,
      serverId: row.id,
      detail: { fields: ["displayName"] },
    });
    return true;
  });
}

const SOFT_DELETE = `
  UPDATE servers.servers
  SET deleted_at = now()
  WHERE public_id = $1 AND deleted_at IS NULL
  RETURNING id`;

const DELETE_MEMBERS = `
  DELETE FROM servers.server_members
  WHERE server_id = $1`;

const DELETE_CONNECTION = `
  DELETE FROM servers.server_connections
  WHERE server_id = $1`;

// ADR-0027 history belongs to the server it was recorded on. A soft-deleted server keeps its row, and creating
// the same public id again revives that row (same internal id), so without this a new physical server would
// inherit the old one's history (ADR-0030 security review). Constants, one per table: no dynamic table names.
const DELETE_HISTORY = [
  "DELETE FROM telemetry.power_samples WHERE server_id = $1",
  "DELETE FROM telemetry.item_samples WHERE server_id = $1",
  "DELETE FROM telemetry.power_rollups WHERE server_id = $1",
  "DELETE FROM telemetry.item_rollups WHERE server_id = $1",
  "DELETE FROM telemetry.building_transitions WHERE server_id = $1",
  // ADR-0027 PR 5, the same reason: a revived id must not inherit the old server's alert rules (their states go with
  // them: alert_state cascades from rules), its alert log or its mute.
  "DELETE FROM alerts.rules WHERE server_id = $1",
  "DELETE FROM alerts.alert_events WHERE server_id = $1",
  "DELETE FROM alerts.server_mutes WHERE server_id = $1",
  // ADR-0027 PR 6: the encrypted webhook goes with the server (its outbox rows cascade from the destination).
  "DELETE FROM alerts.destinations WHERE server_id = $1",
  // ADR-0031 PR 5a: an enrolled agent's credential and any pending enrolment code go with the server, so a revived
  // id can never be reached by the old agent.
  "DELETE FROM agents.enrollment_codes WHERE server_id = $1",
  "DELETE FROM agents.agent_credentials WHERE server_id = $1",
] as const;

const IdRowSchema = z.object({ id: z.string() });

/**
 * Soft delete: the server row stays (for the audit trail) but every membership goes, in the same
 * transaction. That matters because a configured server that is registered again keeps its row
 * and uuid; without this, re-registering a public id would hand every old member, including the
 * old owner, their old role back. False if the server is unknown or already deleted. Takes a pool,
 * not a Queryable, because the two statements must be atomic.
 */
export async function softDeleteServer(
  pool: Parameters<typeof withTransaction>[0],
  publicId: string,
  /** When given, an audit event `server.deleted` (ids only) is written in the same transaction. */
  audit?: { actorUserId: string | null },
): Promise<boolean> {
  return withTransaction(pool, async (client) => {
    const deleted = await client.query(SOFT_DELETE, [publicId]);
    const row = parseFirst(IdRowSchema, deleted.rows, "servers.softDeleteServer");
    if (row === undefined) {
      return false;
    }
    if (audit !== undefined) {
      await recordAuditEvent(client, { action: "server.deleted", actorUserId: audit.actorUserId ?? undefined, serverId: row.id });
    }
    await client.query(DELETE_MEMBERS, [row.id]);
    // ADR-0030: a removed server keeps no credentials, not even encrypted ones.
    await client.query(DELETE_CONNECTION, [row.id]);
    for (const statement of DELETE_HISTORY) {
      await client.query(statement, [row.id]);
    }
    return true;
  });
}

const SWITCH_TO_AGENT = `
  UPDATE servers.servers
  SET connection_kind = 'agent'
  WHERE id = $1 AND deleted_at IS NULL
  RETURNING public_id`;

/**
 * ADR-0031 PR 5a: a server is now reached through an agent. Its kind becomes 'agent' and its stored game-server
 * tokens are deleted (an agent server holds none), and it returns the public id, or undefined when the server is
 * unknown or removed (nothing is written then). The caller runs it in the enrolment transaction, so the switch, the
 * credential and the audit event commit together.
 */
export async function switchToAgentConnection(db: Queryable, serverId: string): Promise<string | undefined> {
  const switched = await db.query(SWITCH_TO_AGENT, [serverId]);
  const row = parseFirst(z.object({ public_id: z.string() }), switched.rows, "servers.switchToAgentConnection");
  if (row === undefined) return undefined;
  await db.query(DELETE_CONNECTION, [serverId]);
  return row.public_id;
}

const LIST_AGENT_SERVERS = `
  SELECT public_id, display_name
  FROM servers.servers
  WHERE connection_kind = 'agent' AND deleted_at IS NULL
  ORDER BY public_id`;

/** The live servers reached through an agent (they have no connection row), for building their runtime entries at startup. */
export async function listAgentServers(db: Queryable): Promise<{ publicId: string; displayName: string }[]> {
  const result = await db.query(LIST_AGENT_SERVERS);
  return parseRows(z.object({ public_id: z.string(), display_name: z.string() }), result.rows, "servers.listAgentServers").map((row) => ({
    publicId: row.public_id,
    displayName: row.display_name,
  }));
}
