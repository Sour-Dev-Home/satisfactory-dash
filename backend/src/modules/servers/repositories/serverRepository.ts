import { z } from "zod";
import { parseFirst, parseOne, parseRows } from "../../../platform/db/rows.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { timedQuery } from "../../../platform/db/timedQuery.js";
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

// #516: a revive (a removed row coming back) purges the per-server data again, whatever raced the removal. `was_removed`
// reads the row as it was before this statement, so a live server's refresh is not a revive.
// #525: these upserts are operator paths (the management create, the import, the startup registration), so a revived row
// becomes `created_via = 'operator'` even if it was a removed self-serve server; a live row keeps what it was.
const UPSERT_SERVER = `
  WITH was_removed AS (SELECT id FROM servers.servers WHERE public_id = $1 AND deleted_at IS NOT NULL)
  INSERT INTO servers.servers AS s (public_id, display_name)
  VALUES ($1, $2)
  ON CONFLICT (public_id) DO UPDATE
    SET display_name = EXCLUDED.display_name, deleted_at = NULL,
        created_via = CASE WHEN s.deleted_at IS NULL THEN s.created_via ELSE 'operator' END
  RETURNING id, public_id, display_name, hosting_mode, connection_kind, EXISTS (SELECT 1 FROM was_removed) AS revived`;

const RevivedRowSchema = ServerRowSchema.extend({ revived: z.boolean() });

async function toServerPurgingRevived(db: Queryable, row: z.output<typeof RevivedRowSchema>): Promise<RegisteredServer> {
  if (row.revived) await purgeServerData(db, row.id);
  return toServer(row);
}

/** Startup registration of a server named in local config: created, or its display name and
 *  live state refreshed (a configured server is by definition not deleted). Idempotent. */
export async function upsertConfiguredServer(
  db: Queryable,
  input: { publicId: string; displayName: string },
): Promise<RegisteredServer> {
  const result = await timedQuery(db, "servers.upsertConfiguredServer", UPSERT_SERVER, [input.publicId, input.displayName]);
  return toServerPurgingRevived(db, parseOne(RevivedRowSchema, result.rows, "servers.upsertConfiguredServer"));
}

const ENSURE_SERVER = `
  WITH was_removed AS (SELECT id FROM servers.servers WHERE public_id = $1 AND deleted_at IS NOT NULL)
  INSERT INTO servers.servers AS s (public_id, display_name)
  VALUES ($1, $2)
  ON CONFLICT (public_id) DO UPDATE
    SET deleted_at = NULL, created_via = CASE WHEN s.deleted_at IS NULL THEN s.created_via ELSE 'operator' END
  RETURNING id, public_id, display_name, hosting_mode, connection_kind, EXISTS (SELECT 1 FROM was_removed) AS revived`;

/** Like `upsertConfiguredServer`, but an existing row keeps its display name (an import must not undo
 *  a rename made in the app). A soft-deleted server is revived. Idempotent. */
export async function ensureServer(db: Queryable, input: { publicId: string; displayName: string }): Promise<RegisteredServer> {
  const result = await timedQuery(db, "servers.ensureServer", ENSURE_SERVER, [input.publicId, input.displayName]);
  return toServerPurgingRevived(db, parseOne(RevivedRowSchema, result.rows, "servers.ensureServer"));
}

const SELECT_BY_PUBLIC_ID = `
  SELECT id, public_id, display_name, hosting_mode, connection_kind
  FROM servers.servers
  WHERE public_id = $1 AND deleted_at IS NULL`;

export async function findServerByPublicId(db: Queryable, publicId: string): Promise<RegisteredServer | undefined> {
  const result = await timedQuery(db, "servers.findServerByPublicId", SELECT_BY_PUBLIC_ID, [publicId]);
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
  const result = await timedQuery(db, "servers.listServersForUser", LIST_FOR_USER, [userId]);
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
    const result = await timedQuery(client, "servers.renameServer", RENAME_SERVER, [publicId, displayName]);
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
  "DELETE FROM agents.commands WHERE server_id = $1",
  // #516 (ADR-0045 "Retention"): the saved world layers and the push opt-ins also belong to the server, so a revived
  // id must not inherit them either. Every table that references servers.servers (migrations) is on this list:
  // server_members and server_connections above; telemetry (5 tables), alerts (rules and alert_state, alert_events,
  // server_mutes, destinations and outbox, push_optins), agents (3 tables) and map.world_layers here. The audit trail
  // keeps its server_id on purpose, and metrics.series_hourly has no server column.
  "DELETE FROM map.world_layers WHERE server_id = $1",
  "DELETE FROM alerts.push_optins WHERE server_id = $1",
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
    const deleted = await timedQuery(client, "servers.softDeleteServer", SOFT_DELETE, [publicId]);
    const row = parseFirst(IdRowSchema, deleted.rows, "servers.softDeleteServer");
    if (row === undefined) {
      return false;
    }
    if (audit !== undefined) {
      await recordAuditEvent(client, { action: "server.deleted", actorUserId: audit.actorUserId ?? undefined, serverId: row.id });
    }
    await timedQuery(client, "servers.softDeleteServer.deleteMembers", DELETE_MEMBERS, [row.id]);
    // ADR-0030: a removed server keeps no credentials, not even encrypted ones.
    await timedQuery(client, "servers.softDeleteServer.deleteConnection", DELETE_CONNECTION, [row.id]);
    await purgeServerData(client, row.id);
    return true;
  });
}

/** Deletes everything recorded for one server except its membership and connection (those have their own statements):
 *  the same list the soft delete runs, and the revive paths run again so a revived id always starts empty. */
export async function purgeServerData(db: Queryable, serverId: string): Promise<void> {
  for (const statement of DELETE_HISTORY) {
    await timedQuery(db, "servers.softDeleteServer.deleteHistory", statement, [serverId]);
  }
}

/** The tables `purgeServerData` clears, parsed from its statements (the guard test compares them with the catalogue). */
export const PURGED_TABLES: readonly string[] = DELETE_HISTORY.map((s) => /^DELETE FROM (\S+)/.exec(s)![1]!);

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
  const switched = await timedQuery(db, "servers.switchToAgentConnection", SWITCH_TO_AGENT, [serverId]);
  const row = parseFirst(z.object({ public_id: z.string() }), switched.rows, "servers.switchToAgentConnection");
  if (row === undefined) return undefined;
  await timedQuery(db, "servers.switchToAgentConnection.deleteConnection", DELETE_CONNECTION, [serverId]);
  return row.public_id;
}

const LOCK_SERVER = `
  SELECT id, public_id, display_name, hosting_mode, connection_kind
  FROM servers.servers
  WHERE public_id = $1 AND deleted_at IS NULL
  FOR NO KEY UPDATE`;

/** The live server row, LOCKED for this transaction (the same order enrolment and revoke take: the server row first), so a
 *  concurrent enrol, revoke or removal waits and the kind read here is the kind the caller then changes. */
export async function lockServerByPublicId(db: Queryable, publicId: string): Promise<RegisteredServer | undefined> {
  const result = await timedQuery(db, "servers.lockServerByPublicId", LOCK_SERVER, [publicId]);
  const row = parseFirst(ServerRowSchema, result.rows, "servers.lockServerByPublicId");
  return row === undefined ? undefined : toServer(row);
}

const SWITCH_TO_LOCAL = `
  UPDATE servers.servers
  SET connection_kind = 'local'
  WHERE id = $1 AND connection_kind = 'agent' AND deleted_at IS NULL
  RETURNING id`;

/** ADR-0031 amendment: an agent server is read by this backend again. Only an agent server changes (false otherwise). The
 *  caller stores the new connection right after, in the same transaction (`createConnection` needs the kind to be 'local'). */
export async function switchToLocalKind(db: Queryable, serverId: string): Promise<boolean> {
  return (await timedQuery(db, "servers.switchToLocalKind", SWITCH_TO_LOCAL, [serverId])).rows.length > 0;
}

const LIST_AGENT_SERVERS = `
  SELECT id, public_id, display_name
  FROM servers.servers
  WHERE connection_kind = 'agent' AND deleted_at IS NULL
  ORDER BY public_id`;

/** The live servers reached through an agent (they have no connection row), for building their runtime entries at startup
 *  (`serverId` is the internal id, for seeding an owner). */
export async function listAgentServers(db: Queryable): Promise<{ serverId: string; publicId: string; displayName: string }[]> {
  const result = await timedQuery(db, "servers.listAgentServers", LIST_AGENT_SERVERS);
  return parseRows(z.object({ id: z.string(), public_id: z.string(), display_name: z.string() }), result.rows, "servers.listAgentServers").map((row) => ({
    serverId: row.id,
    publicId: row.public_id,
    displayName: row.display_name,
  }));
}

const LIST_OPERATOR_AGENT_SERVERS = `
  SELECT public_id, display_name
  FROM servers.servers
  WHERE connection_kind = 'agent' AND created_via = 'operator' AND deleted_at IS NULL
  ORDER BY public_id`;

/** ADR-0046 section 6: the operator's managed list shows only the agent servers the operator created. A self-serve server's
 *  scoped routes 404 for the operator (not a member), so the list never offers rename or remove on one. */
export async function listOperatorAgentServers(db: Queryable): Promise<{ publicId: string; displayName: string }[]> {
  const result = await timedQuery(db, "servers.listOperatorAgentServers", LIST_OPERATOR_AGENT_SERVERS);
  return parseRows(z.object({ public_id: z.string(), display_name: z.string() }), result.rows, "servers.listOperatorAgentServers").map((row) => ({
    publicId: row.public_id,
    displayName: row.display_name,
  }));
}

// ADR-0046 section 1.3: a plain INSERT, never the upserts above. A public id that already exists, live or soft-deleted, is
// a unique violation (the transaction fails), so a self-serve create can never revive a removed server's id.
const INSERT_SELF_SERVE_SERVER = `
  INSERT INTO servers.servers (public_id, display_name, connection_kind, created_via)
  VALUES ($1, $2, 'agent', 'self_serve')
  RETURNING id, public_id, display_name, hosting_mode, connection_kind`;

/** Inserts a new self-serve agent server. The caller adds its owner in the same transaction (the database refuses the
 *  commit otherwise, `servers_self_serve_has_owner`). */
export async function insertSelfServeServer(db: Queryable, input: { publicId: string; displayName: string }): Promise<RegisteredServer> {
  const result = await timedQuery(db, "servers.insertSelfServeServer", INSERT_SELF_SERVE_SERVER, [input.publicId, input.displayName]);
  return toServer(parseOne(ServerRowSchema, result.rows, "servers.insertSelfServeServer"));
}

const COUNT_SELF_SERVE_SERVERS = `
  SELECT count(*) AS n
  FROM servers.servers
  WHERE created_via = 'self_serve' AND deleted_at IS NULL`;

/** C2: the live self-serve servers in total. */
export async function countSelfServeServers(db: Queryable): Promise<number> {
  const result = await timedQuery(db, "servers.countSelfServeServers", COUNT_SELF_SERVE_SERVERS);
  return parseOne(z.object({ n: z.coerce.number() }), result.rows, "servers.countSelfServeServers").n;
}

const LIST_OWNED_SELF_SERVE = `
  SELECT s.id, s.display_name
  FROM servers.servers s
  JOIN servers.server_members m ON m.server_id = s.id AND m.role = 'owner'
  WHERE m.user_id = $1 AND s.created_via = 'self_serve' AND s.deleted_at IS NULL
  ORDER BY s.created_at, s.id`;

/** C1 and C3: the live self-serve servers this account owns (internal id and name), oldest first. */
export async function listOwnedSelfServeServers(db: Queryable, userId: string): Promise<{ serverId: string; displayName: string }[]> {
  const result = await timedQuery(db, "servers.listOwnedSelfServeServers", LIST_OWNED_SELF_SERVE, [userId]);
  return parseRows(z.object({ id: z.string(), display_name: z.string() }), result.rows, "servers.listOwnedSelfServeServers").map((row) => ({
    serverId: row.id,
    displayName: row.display_name,
  }));
}
