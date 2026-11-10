import type { AgentServer } from "@satisfactory-dash/shared";
import type { withTransaction } from "../../platform/db/transaction.js";
import type { Queryable } from "../../platform/db/schemaVersion.js";
import { ServerNotFoundError } from "../../platform/errorResponse.js";
import { Mutex } from "../../platform/mutex.js";
import { findServerByPublicId, isOperatorServer, listOperatorAgentServers, renameServer, softDeleteServer } from "./repositories/serverRepository.js";
import type { ServerRuntime } from "./serverRuntime.js";

/**
 * ADR-0030's server management, as it stands since ADR-0066 (build PR 5): every server is reached through the mod, so the
 * operator lists, renames and removes servers here (an agent server is created by `POST /api/servers/agent`, the self-serve
 * create). Adding, editing, testing and switching a direct-poll server are gone, with their routes (build PR 6). This is
 * the service behind the routes; it knows nothing about HTTP.
 *
 * - Every mutation of the runtime (rename, remove) runs under one mutex, one at a time, after its commit.
 * - Remove soft-deletes the server (its memberships and every recorded row go in the same
 *   transaction) and stops its workers.
 */

/** The Postgres side of the service: a pool that can also open a transaction. */
export type ManagementDb = Queryable & Parameters<typeof withTransaction>[0];

export interface ServerManagementDeps<TServices> {
  db: ManagementDb;
  runtime: ServerRuntime<TServices>;
  /** The seeded operator account's id; undefined until the database is up. */
  getOperatorUserId: () => string | undefined;
  /** One mutex per process; tests may pass their own. */
  mutex?: Mutex;
}

export interface ServerManagementService {
  /** True only for the operator account. */
  canManage(userId: string): boolean;
  /** ADR-0031: the servers reached through the mod that the operator created, for the managed list. */
  listAgentServers(): Promise<AgentServer[]>;
  /** ADR-0031: renames a server. Not found for an unknown or removed id. */
  renameAgentServer(actorUserId: string, publicId: string, displayName: string): Promise<AgentServer>;
  remove(actorUserId: string, publicId: string): Promise<void>;
}

export function createServerManagementService<TServices>(deps: ServerManagementDeps<TServices>): ServerManagementService {
  const mutex = deps.mutex ?? new Mutex();

  return {
    canManage(userId) {
      const operator = deps.getOperatorUserId();
      return operator !== undefined && operator === userId;
    },

    async listAgentServers() {
      // ADR-0046 section 6: operator-created only (the startup load still loads every agent server). A leftover `local` row
      // is listed too: it is served as an agent server awaiting the mod (ADR-0066).
      return (await listOperatorAgentServers(deps.db)).map(({ publicId, displayName }) => ({ id: publicId, displayName, kind: "agent" as const }));
    },

    /** Renames a server. A leftover `local` row is an agent server awaiting the mod (ADR-0066), so it is renamed the same
     *  way; an unknown id is "no such server". */
    renameAgentServer(actorUserId, publicId, displayName) {
      return mutex.run(async () => {
        const server = await findServerByPublicId(deps.db, publicId);
        if (server === undefined) throw new ServerNotFoundError();
        if (!(await renameServer(deps.db, publicId, displayName, { actorUserId }))) throw new ServerNotFoundError();
        deps.runtime.rename(publicId, displayName);
        return { id: publicId, displayName, kind: "agent" as const };
      });
    },

    remove(actorUserId, publicId) {
      return mutex.run(async () => {
        // ADR-0066: any live server the operator created, whatever its kind. It used to look the server up by its stored
        // connection, so an agent server the operator created could not be removed here (a 404). A self-serve server stays
        // its owner's to remove, even when the operator is a member of it (the same 404 as before).
        if (!(await isOperatorServer(deps.db, publicId))) throw new ServerNotFoundError();
        // The row's memberships and its recorded data go in one transaction; then its workers stop.
        const removed = await softDeleteServer(deps.db, publicId, { actorUserId });
        if (!removed) throw new ServerNotFoundError();
        await deps.runtime.remove(publicId);
      });
    },
  };
}
