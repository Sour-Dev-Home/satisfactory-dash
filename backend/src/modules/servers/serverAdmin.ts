import { z } from "zod";
import { parseRows } from "../../platform/db/rows.js";
import { timedQuery } from "../../platform/db/timedQuery.js";
import type { Queryable } from "../../platform/db/index.js";
import { softDeleteServer } from "./repositories/serverRepository.js";

/**
 * The operator's server commands (#516, ADR-0046), run locally as `npm run admin -- remove-server <public-id>` and
 * `npm run admin -- list-servers`; shell access to the PC is the trust boundary. They exist because the operator is not
 * a member of a self-serve server and the scoped HTTP remove answers 404 to a non-member.
 */

/** The full delete of any live server: the same transaction as the HTTP remove (`softDeleteServer`), so the same
 *  `server.deleted` audit row (no actor, the server's internal id) and the same per-server clean-up. False when the id
 *  is unknown or already removed. A running backend keeps polling a removed LOCAL server until it restarts. */
export async function removeServerAdmin(db: Parameters<typeof softDeleteServer>[0], publicId: string): Promise<boolean> {
  return softDeleteServer(db, publicId, { actorUserId: null });
}

const ListRowSchema = z.object({
  public_id: z.string(),
  display_name: z.string(),
  connection_kind: z.enum(["local", "agent"]),
  owner_user_id: z.string().nullable(),
  enrolled: z.boolean(),
  last_seen_at: z.date().nullable(),
  power_rows: z.coerce.number(),
  item_rows: z.coerce.number(),
});

export interface AdminServerRow {
  publicId: string;
  displayName: string;
  kind: "local" | "agent";
  ownerUserId: string | null;
  enrolled: boolean;
  lastSeenAt: string | null;
  powerRows: number;
  itemRows: number;
}

// `created_via` (ADR-0046, #525) is added to this list when that column exists.
const LIST_SERVERS = `
  SELECT s.public_id, s.display_name, s.connection_kind,
         (SELECT m.user_id::text FROM servers.server_members m WHERE m.server_id = s.id AND m.role = 'owner' LIMIT 1) AS owner_user_id,
         COALESCE(c.revoked_at IS NULL, false) AS enrolled,
         CASE WHEN c.revoked_at IS NULL THEN c.last_seen_at END AS last_seen_at,
         (SELECT count(*) FROM telemetry.power_samples p WHERE p.server_id = s.id) AS power_rows,
         (SELECT count(*) FROM telemetry.item_samples i WHERE i.server_id = s.id) AS item_rows
  FROM servers.servers s
  LEFT JOIN agents.agent_credentials c ON c.server_id = s.id
  WHERE s.deleted_at IS NULL
  ORDER BY s.created_at, s.public_id`;

/** Every live server, ids and numbers only (display names are the owner's own text; no emails, no tokens). */
export async function listServersAdmin(db: Queryable): Promise<AdminServerRow[]> {
  const result = await timedQuery(db, "servers.admin.listServers", LIST_SERVERS);
  return parseRows(ListRowSchema, result.rows, "servers.admin.listServers").map((r) => ({
    publicId: r.public_id,
    displayName: r.display_name,
    kind: r.connection_kind,
    ownerUserId: r.owner_user_id,
    enrolled: r.enrolled,
    lastSeenAt: r.last_seen_at === null ? null : r.last_seen_at.toISOString(),
    powerRows: r.power_rows,
    itemRows: r.item_rows,
  }));
}
