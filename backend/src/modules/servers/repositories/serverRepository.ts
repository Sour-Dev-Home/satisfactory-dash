import { z } from "zod";
import { parseFirst, parseOne, parseRows } from "../../../platform/db/rows.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { withTransaction } from "../../../platform/db/transaction.js";

/**
 * The server registry in Postgres (ADR-0020, ADR-0025): the public id used in every
 * /api/servers/:serverId URL, its display name and hosting mode. HOW to reach a server (host,
 * ports, tokens) stays in local config; who may SEE it is memberships.
 */
export type HostingMode = "self" | "managed";
export type MemberRole = "owner" | "admin" | "viewer";

export interface RegisteredServer {
  /** Internal primary key (uuid). Never sent to clients. */
  id: string;
  publicId: string;
  displayName: string;
  hostingMode: HostingMode;
}

const ServerRowSchema = z.object({
  id: z.string(),
  public_id: z.string(),
  display_name: z.string(),
  hosting_mode: z.enum(["self", "managed"]),
});

const toServer = (row: z.output<typeof ServerRowSchema>): RegisteredServer => ({
  id: row.id,
  publicId: row.public_id,
  displayName: row.display_name,
  hostingMode: row.hosting_mode,
});

const UPSERT_SERVER = `
  INSERT INTO servers.servers (public_id, display_name)
  VALUES ($1, $2)
  ON CONFLICT (public_id) DO UPDATE
    SET display_name = EXCLUDED.display_name, deleted_at = NULL
  RETURNING id, public_id, display_name, hosting_mode`;

/** Startup registration of a server named in local config: created, or its display name and
 *  live state refreshed (a configured server is by definition not deleted). Idempotent. */
export async function upsertConfiguredServer(
  db: Queryable,
  input: { publicId: string; displayName: string },
): Promise<RegisteredServer> {
  const result = await db.query(UPSERT_SERVER, [input.publicId, input.displayName]);
  return toServer(parseOne(ServerRowSchema, result.rows, "servers.upsertConfiguredServer"));
}

const SELECT_BY_PUBLIC_ID = `
  SELECT id, public_id, display_name, hosting_mode
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

const SOFT_DELETE = `
  UPDATE servers.servers
  SET deleted_at = now()
  WHERE public_id = $1 AND deleted_at IS NULL
  RETURNING id`;

const DELETE_MEMBERS = `
  DELETE FROM servers.server_members
  WHERE server_id = $1`;

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
): Promise<boolean> {
  return withTransaction(pool, async (client) => {
    const deleted = await client.query(SOFT_DELETE, [publicId]);
    const row = parseFirst(IdRowSchema, deleted.rows, "servers.softDeleteServer");
    if (row === undefined) {
      return false;
    }
    await client.query(DELETE_MEMBERS, [row.id]);
    return true;
  });
}
