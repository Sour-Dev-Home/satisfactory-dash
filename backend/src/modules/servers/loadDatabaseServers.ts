import { createHash } from "node:crypto";
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
  /** Public ids of servers the operator was just made owner of because they had none (#310/#311); the caller logs
   *  one `ownership seeded` line each. Empty on every later start. */
  ownershipSeeded: string[];
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
 * That includes servers reached through an agent (#267).
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
    return { usingDatabase: false, loaded: [], unreadable: [], refused: [], ownershipSeeded: [] };
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
  // A server reached through an agent is seeded the same way (#267): only when it has NO owner (an ownerless server is
  // unreachable for everyone, the operator included, since routes 404 for a non-member). It never takes ownership from
  // an existing owner: the one-owner index turns that into "owner_exists", a no-op.
  const seeds = [...listed.connections, ...unreadable, ...agentServers].map(({ serverId, publicId }) => ({ serverId, publicId }));
  const ownershipSeeded: string[] = [];
  for (const { serverId, publicId } of seeds) {
    const outcome = await addMember(deps.db, { serverId, userId: deps.operatorUserId, role: "owner", actorUserId: null, source: "startup_seed" });
    if (outcome === "unknown_server_or_user") {
      throw new Error("could not seed an owner for a database server: unknown server or user");
    }
    if (outcome === "added") {
      ownershipSeeded.push(publicId);
    }
  }
  return { usingDatabase: true, loaded: connections.map((c) => c.publicId), unreadable, refused, ownershipSeeded };
}

/**
 * ADR-0054 D3: a digest of what a polled server connects with (address, ports, tokens), set as `RuntimeServer.source` by
 * the composition root's builder. Not the display name: a rename keeps the pollers. A SHA-256, so the entry holds no token.
 */
export function connectionSource(c: Pick<ServerConnection, "host" | "pinnedIp" | "apiPort" | "frmPort" | "apiToken" | "frmToken">): string {
  return createHash("sha256")
    .update(JSON.stringify([c.host, c.pinnedIp, c.apiPort, c.frmPort, c.apiToken, c.frmToken ?? null]))
    .digest("hex");
}

export interface ReconcileDatabaseServersResult {
  added: string[];
  removed: string[];
  /** Polled servers whose connection changed: rebuilt, their pollers restarted. */
  replaced: string[];
  renamed: string[];
  /** Rows this process cannot open; like at startup they are not served. */
  unreadable: UnreadableConnection[];
  refused: { serverId: string; publicId: string }[];
}

/**
 * ADR-0054 D3: brings a RUNNING runtime in line with the database, changing only what differs. During a deploy's overlap
 * two tasks serve, and a server write handled by one (add, remove, rename, connection edit, a switch to or from an agent)
 * reaches only that task's runtime; the other loaded its servers at startup. The new task runs this when it becomes the
 * leader, that is once the old task has stopped, so a write made there during the overlap is picked up.
 *
 * Unlike `loadDatabaseServers` it never clears the runtime: an unchanged server keeps its pollers and an agent server its
 * in-memory snapshots. With nothing stored at all it changes nothing, as at startup. It seeds no owners (startup did).
 * Run it under the server-write mutex, so it never interleaves with this process's own post-commit runtime changes.
 */
export async function reconcileDatabaseServers<TServices>(deps: {
  db: Queryable;
  ring: SecretsKeyring | null;
  runtime: ServerRuntime<TServices>;
  build: (connection: ServerConnection) => RuntimeServer<TServices>;
  buildAgent?: (server: { publicId: string; displayName: string }) => RuntimeServer<TServices>;
  policy?: AddressPolicy;
  /** True in database mode, where the runtime holds only stored servers: an empty database then means the last one was
   *  deleted elsewhere, so everything is removed. Default false: servers from the config stay (startup semantics). */
  emptyMeansNone?: boolean;
}): Promise<ReconcileDatabaseServersResult> {
  const result: ReconcileDatabaseServersResult = { added: [], removed: [], replaced: [], renamed: [], unreadable: [], refused: [] };
  const listed = await listConnections(deps.db, deps.ring);
  const policy = deps.policy ?? DEFAULT_ADDRESS_POLICY;
  const connections = listed.connections.filter((c) => addressVerdict(c.pinnedIp, policy) === "ok");
  result.refused = listed.connections.filter((c) => addressVerdict(c.pinnedIp, policy) !== "ok").map(({ serverId, publicId }) => ({ serverId, publicId }));
  result.unreadable = listed.unreadable;
  const agentServers = deps.buildAgent ? await listAgentServers(deps.db) : [];
  if (!deps.emptyMeansNone && listed.connections.length === 0 && listed.unreadable.length === 0 && agentServers.length === 0) return result;

  const wanted = new Set([...connections.map((c) => c.publicId), ...agentServers.map((a) => a.publicId)]);
  // A row this process cannot open right now (a keyring problem) still exists: a server already running from it keeps
  // running, unlike at startup, where there is nothing to keep. A refused address is removed: that is a safety rule.
  const unopenable = new Set(listed.unreadable.map((u) => u.publicId));
  for (const { id } of deps.runtime.list()) {
    if (!wanted.has(id) && !unopenable.has(id) && (await deps.runtime.remove(id))) result.removed.push(id);
  }

  for (const connection of connections) {
    const current = deps.runtime.describe(connection.publicId);
    if (current === undefined) {
      deps.runtime.add(deps.build(connection));
      result.added.push(connection.publicId);
    } else if (current.kind === "agent") {
      // Switched back to a polled server elsewhere: a deliberate un-enrol, so not a replace (which refuses it).
      await deps.runtime.remove(connection.publicId);
      deps.runtime.add(deps.build(connection));
      result.replaced.push(connection.publicId);
    } else if (current.source !== connectionSource(connection)) {
      await deps.runtime.replace(deps.build(connection));
      result.replaced.push(connection.publicId);
    } else if (current.displayName !== connection.displayName) {
      deps.runtime.rename(connection.publicId, connection.displayName);
      result.renamed.push(connection.publicId);
    }
  }

  for (const server of agentServers) {
    const current = deps.runtime.describe(server.publicId);
    if (current === undefined) {
      deps.runtime.add(deps.buildAgent!(server));
      result.added.push(server.publicId);
    } else if (current.kind !== "agent") {
      // Enrolled elsewhere: polled to agent, the same swap the enrolment makes.
      await deps.runtime.replace(deps.buildAgent!(server));
      result.replaced.push(server.publicId);
    } else if (current.displayName !== server.displayName) {
      deps.runtime.rename(server.publicId, server.displayName);
      result.renamed.push(server.publicId);
    }
  }
  return result;
}
