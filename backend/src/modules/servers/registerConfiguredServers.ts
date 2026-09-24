import type { Queryable } from "../../platform/db/schemaVersion.js";
import { addMember } from "./repositories/memberRepository.js";
import { upsertConfiguredServer } from "./repositories/serverRepository.js";

/**
 * ADR-0025 PR 6: at startup, every server named in local config gets a row (created, or its
 * display name refreshed and any soft delete undone) and, if it has no owner yet, the bootstrap
 * owner (the operator account). Idempotent: a restart changes nothing, and once ownership has
 * moved to someone else the one-owner index makes the bootstrap insert a no-op, so the operator
 * is never re-added as a second owner. Runs after the database is up and before requests are
 * authorized against memberships.
 */
export async function registerConfiguredServers(
  db: Queryable,
  servers: { id: string; displayName: string }[],
  bootstrapOwnerId: string,
): Promise<{ registered: number }> {
  for (const server of servers) {
    const row = await upsertConfiguredServer(db, { publicId: server.id, displayName: server.displayName });
    // "owner_exists" and "already_member" are the normal restart outcomes; a missing user or
    // server would leave the server ownerless while the process reports ready, so it fails loudly.
    // actorUserId null: the system does this, not a signed-in user.
    const outcome = await addMember(db, { serverId: row.id, userId: bootstrapOwnerId, role: "owner", actorUserId: null });
    if (outcome === "unknown_server_or_user") {
      throw new Error(`could not seed an owner for server "${server.id}": unknown server or user`);
    }
  }
  return { registered: servers.length };
}
