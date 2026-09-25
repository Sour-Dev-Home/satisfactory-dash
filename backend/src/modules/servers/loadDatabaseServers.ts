import type { Queryable } from "../../platform/db/schemaVersion.js";
import type { SecretsKeyring } from "../../platform/secrets/secrets.js";
import { addMember } from "./repositories/memberRepository.js";
import { listConnections } from "./repositories/connectionRepository.js";
import type { ServerConnection, UnreadableConnection } from "./repositories/connectionRepository.js";
import type { RuntimeServer, ServerRuntime } from "./serverRuntime.js";

export interface LoadDatabaseServersResult {
  /** False when the database holds no connections: the caller keeps using the config (nothing changed). */
  usingDatabase: boolean;
  /** Public ids now served from the database. */
  loaded: string[];
  /** Rows this process cannot open (no keyring, unknown key id, failed open): public id and key id only. */
  unreadable: UnreadableConnection[];
}

/**
 * ADR-0030 startup precedence: if the database holds any server connections, the database WINS.
 * Every server currently in the runtime (the ones built from the servers file or the single-server
 * env) is removed, its pollers stopped, and each connection in the database is built and added
 * (started if the runtime is running). With no connections in the database nothing changes.
 *
 * A row that cannot be opened is never skipped silently: it is returned in `unreadable` so the caller
 * can report not-ready with a stable code and log its public id and key id (never a value).
 *
 * The operator is also made owner of any of these servers that has none (idempotent; the one-owner
 * index makes it a no-op once ownership has moved), so a server added by the import CLI is not ownerless.
 */
export async function loadDatabaseServers<TServices>(deps: {
  db: Queryable;
  ring: SecretsKeyring | null;
  runtime: ServerRuntime<TServices>;
  operatorUserId: string;
  build: (connection: ServerConnection) => RuntimeServer<TServices>;
}): Promise<LoadDatabaseServersResult> {
  const { connections, unreadable } = await listConnections(deps.db, deps.ring);
  if (connections.length === 0 && unreadable.length === 0) {
    return { usingDatabase: false, loaded: [], unreadable: [] };
  }
  for (const { id } of deps.runtime.list()) {
    await deps.runtime.remove(id);
  }
  for (const connection of connections) {
    deps.runtime.add(deps.build(connection));
  }
  for (const serverId of [...connections.map((c) => c.serverId), ...unreadable.map((u) => u.serverId)]) {
    const outcome = await addMember(deps.db, { serverId, userId: deps.operatorUserId, role: "owner", actorUserId: null });
    if (outcome === "unknown_server_or_user") {
      throw new Error("could not seed an owner for a database server: unknown server or user");
    }
  }
  return { usingDatabase: true, loaded: connections.map((c) => c.publicId), unreadable };
}
