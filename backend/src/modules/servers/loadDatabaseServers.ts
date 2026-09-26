import type { Queryable } from "../../platform/db/schemaVersion.js";
import type { SecretsKeyring } from "../../platform/secrets/secrets.js";
import { addMember } from "./repositories/memberRepository.js";
import { listConnections } from "./repositories/connectionRepository.js";
import { listAgentServers } from "./repositories/serverRepository.js";
import type { ServerConnection, UnreadableConnection } from "./repositories/connectionRepository.js";
import { DEFAULT_ADDRESS_POLICY, addressVerdict } from "./addressGuard.js";
import type { AddressPolicy } from "./addressGuard.js";
import type { RuntimeServer, ServerRuntime } from "./serverRuntime.js";

export interface LoadDatabaseServersResult {
  /** False when the database holds no connections: the caller keeps using the config (nothing changed). */
  usingDatabase: boolean;
  /** Public ids now served from the database. */
  loaded: string[];
  /** Rows this process cannot open (no keyring, unknown key id, failed open): public id and key id only. */
  unreadable: UnreadableConnection[];
  /** Rows whose stored pinned address is not loopback or private (public ids only): not served, like unreadable ones. */
  refused: { serverId: string; publicId: string }[];
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
  /** ADR-0031 PR 5a: builds the entry of a server reached through an agent (no connection, no pollers). Omitted: none are loaded. */
  buildAgent?: (server: { publicId: string; displayName: string }) => RuntimeServer<TServices>;
  /** Tests only; production uses the default (the LAN_ALLOWED constant). */
  policy?: AddressPolicy;
}): Promise<LoadDatabaseServersResult> {
  const listed = await listConnections(deps.db, deps.ring);
  const { unreadable } = listed;
  // The stored address is re-checked here, not trusted: a row edited outside the app (or restored
  // from a tampered backup) must never make the backend send tokens to a non-private address.
  const policy = deps.policy ?? DEFAULT_ADDRESS_POLICY;
  // Not usable = not loopback/private, or a LAN address while LAN servers wait for certificate pinning (amendment 1):
  // no server is built for it, so it gets no pollers and no connection is ever made.
  const connections = listed.connections.filter((c) => addressVerdict(c.pinnedIp, policy) === "ok");
  const refused = listed.connections
    .filter((c) => addressVerdict(c.pinnedIp, policy) !== "ok")
    .map(({ serverId, publicId }) => ({ serverId, publicId }));
  // ADR-0031 PR 5a: a server reached through an agent has no connection row; it counts as "the database holds servers"
  // too, so the database wins for it as well.
  const agentServers = deps.buildAgent ? await listAgentServers(deps.db) : [];
  if (listed.connections.length === 0 && unreadable.length === 0 && agentServers.length === 0) {
    return { usingDatabase: false, loaded: [], unreadable: [], refused: [] };
  }
  for (const { id } of deps.runtime.list()) {
    await deps.runtime.remove(id);
  }
  for (const connection of connections) {
    deps.runtime.add(deps.build(connection));
  }
  for (const server of agentServers) {
    deps.runtime.add(deps.buildAgent!(server));
  }
  const seedIds = [...listed.connections.map((c) => c.serverId), ...unreadable.map((u) => u.serverId)];
  for (const serverId of seedIds) {
    const outcome = await addMember(deps.db, { serverId, userId: deps.operatorUserId, role: "owner", actorUserId: null });
    if (outcome === "unknown_server_or_user") {
      throw new Error("could not seed an owner for a database server: unknown server or user");
    }
  }
  return { usingDatabase: true, loaded: connections.map((c) => c.publicId), unreadable, refused };
}
