import type { Queryable } from "../../platform/db/schemaVersion.js";
import { addMember } from "./repositories/memberRepository.js";
import { listAgentServers } from "./repositories/serverRepository.js";
import type { RuntimeServer, ServerRuntime } from "./serverRuntime.js";

/** Builds the running entry of a server reached through the mod (the agent protocol): no game connection and no pollers. */
export type BuildAgentServer<TServices> = (server: { publicId: string; displayName: string }) => RuntimeServer<TServices>;

export interface LoadDatabaseServersResult {
  /** Public ids now served from the database. */
  loaded: string[];
  /** Public ids of servers the operator was just made owner of because they had none (#310/#311); the caller logs
   *  one `ownership seeded` line each. Empty on every later start. */
  ownershipSeeded: string[];
}

/**
 * The servers this process serves are the ones stored in the database (ADR-0030; issue #196: nothing comes from the
 * environment). Since ADR-0066 every one is reached through the mod: each is built as an agent server, and a leftover
 * `local` row (a backup restored from before the migration that converted them) loads the same way, as a server
 * awaiting the mod. Its stored connection, if any, is never read. Whatever the runtime held is replaced.
 *
 * The operator is also made owner of any of these servers that has none (idempotent; the one-owner index makes it a
 * no-op once ownership has moved), so no server is ownerless (#267).
 */
export async function loadDatabaseServers<TServices>(deps: {
  db: Queryable;
  runtime: ServerRuntime<TServices>;
  operatorUserId: string;
  buildAgent: BuildAgentServer<TServices>;
}): Promise<LoadDatabaseServersResult> {
  const servers = await listAgentServers(deps.db);
  for (const { id } of deps.runtime.list()) {
    await deps.runtime.remove(id);
  }
  for (const server of servers) {
    deps.runtime.add(deps.buildAgent(server));
  }
  // Only when a server has NO owner (an ownerless server is unreachable for everyone, the operator included, since routes
  // 404 for a non-member). It never takes ownership from an existing owner: the one-owner index makes that "owner_exists".
  const ownershipSeeded: string[] = [];
  for (const { serverId, publicId } of servers) {
    const outcome = await addMember(deps.db, { serverId, userId: deps.operatorUserId, role: "owner", actorUserId: null, source: "startup_seed" });
    if (outcome === "unknown_server_or_user") {
      throw new Error("could not seed an owner for a database server: unknown server or user");
    }
    if (outcome === "added") {
      ownershipSeeded.push(publicId);
    }
  }
  return { loaded: servers.map((s) => s.publicId), ownershipSeeded };
}

export interface ReconcileDatabaseServersResult {
  added: string[];
  removed: string[];
  renamed: string[];
}

/**
 * ADR-0054 D3: brings a RUNNING runtime in line with the database, changing only what differs. During a deploy's overlap
 * two tasks serve, and a server write handled by one (add, remove, rename) reaches only that task's runtime; the other
 * loaded its servers at startup. The new task runs this when it becomes the leader, that is once the old task has
 * stopped, so a write made there during the overlap is picked up.
 *
 * Unlike `loadDatabaseServers` it never clears the runtime: an unchanged server keeps its in-memory snapshots. The
 * database is the only source of servers, so an empty database means the last one was deleted elsewhere. It seeds no
 * owners (startup did). Run it under the server-write mutex, so it never interleaves with this process's own post-commit
 * runtime changes.
 */
export async function reconcileDatabaseServers<TServices>(deps: {
  db: Queryable;
  runtime: ServerRuntime<TServices>;
  buildAgent: BuildAgentServer<TServices>;
}): Promise<ReconcileDatabaseServersResult> {
  const result: ReconcileDatabaseServersResult = { added: [], removed: [], renamed: [] };
  const servers = await listAgentServers(deps.db);
  const wanted = new Set(servers.map((s) => s.publicId));
  for (const { id } of deps.runtime.list()) {
    if (!wanted.has(id) && (await deps.runtime.remove(id))) result.removed.push(id);
  }
  for (const server of servers) {
    const current = deps.runtime.describe(server.publicId);
    if (current === undefined) {
      deps.runtime.add(deps.buildAgent(server));
      result.added.push(server.publicId);
    } else if (current.displayName !== server.displayName) {
      deps.runtime.rename(server.publicId, server.displayName);
      result.renamed.push(server.publicId);
    }
  }
  return result;
}
