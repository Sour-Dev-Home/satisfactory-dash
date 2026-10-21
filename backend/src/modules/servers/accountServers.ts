import type { Queryable } from "../../platform/db/schemaVersion.js";
import { timedQuery } from "../../platform/db/timedQuery.js";
import { Mutex } from "../../platform/mutex.js";
import { TAKE_SERVER_MANAGEMENT_LOCK } from "./importServers.js";
import { lockOwnedServers, softDeleteServerInTransaction } from "./repositories/serverRepository.js";

/**
 * ADR-0047 decision 3: the servers' part of deleting an account. `identity/` orchestrates the deletion and defines the port
 * this satisfies structurally (`AccountServersPort` in identity/accountDeletion.ts); the composition root wires the two, so
 * neither module imports the other (ALLOWED_MODULE_EDGES stays `identity: []`, `servers: []`).
 *
 * Inside the deletion transaction, under the server-management advisory lock (so a self-serve create in another tab cannot
 * add a server mid-deletion), the servers the account OWNS NOW (its owner membership, not `created_by_user_id`) are locked.
 * Any operator-created one blocks the deletion (nothing is changed; no automatic handover). Otherwise every owned
 * self-serve server goes through the same purge as every other removal (`softDeleteServerInTransaction`: members,
 * connection, `PURGED_TABLES`, its name cleared), audited `server.deleted` with the user as actor and
 * `detail: { reason: "account_deleted" }`. After the commit each runtime entry is dropped, as the owner's remove does.
 */
export type OwnedServersOutcome =
  | { outcome: "removed"; removed: string[] }
  | { outcome: "operator_servers"; servers: { id: string; displayName: string }[] };

export interface AccountServers {
  /** Runs the whole deletion (its transaction and the runtime changes after it) under the shared server-write mutex, so it
   *  never interleaves with the operator's, the owner's or the sweep's runtime changes. */
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  /** First, in the deletion transaction: the server-management advisory lock (the self-serve create's lock, taken before
   *  the account row is locked, so the two never wait on each other in opposite orders). */
  lockForDeletion(client: Queryable): Promise<void>;
  /** Then, once the caller holds the account row: lock and remove what it owns now. */
  removeOwnedServers(client: Queryable, userId: string): Promise<OwnedServersOutcome>;
  /** After the commit: the removed servers' runtime entries go. */
  afterCommit(removedPublicIds: readonly string[]): Promise<void>;
}

export interface AccountServersDeps {
  /** The running servers; absent in the operator CLI, which cannot reach a running backend (restart it after). */
  runtime?: { remove(publicId: string): Promise<unknown> };
  /** The process's shared server-write mutex (the composition root passes the one the other server writes use). */
  mutex?: Mutex;
}

export function createAccountServers(deps: AccountServersDeps = {}): AccountServers {
  const mutex = deps.mutex ?? new Mutex();
  return {
    exclusive: (work) => mutex.run(work),

    async lockForDeletion(client) {
      await timedQuery(client, "servers.accountDeletion.takeManagementLock", TAKE_SERVER_MANAGEMENT_LOCK);
    },

    async removeOwnedServers(client, userId) {
      const owned = await lockOwnedServers(client, userId);
      const blocking = owned.filter((server) => server.createdVia === "operator");
      if (blocking.length > 0) {
        return { outcome: "operator_servers", servers: blocking.map((server) => ({ id: server.publicId, displayName: server.displayName })) };
      }
      for (const server of owned) {
        await softDeleteServerInTransaction(client, server.publicId, { actorUserId: userId, detail: { reason: "account_deleted" } });
      }
      return { outcome: "removed", removed: owned.map((server) => server.publicId) };
    },

    async afterCommit(removedPublicIds) {
      if (deps.runtime === undefined) return;
      for (const publicId of removedPublicIds) {
        await deps.runtime.remove(publicId);
      }
    },
  };
}
