import { randomBytes } from "node:crypto";
import type { AgentServer, CreateAgentServerRequest } from "@satisfactory-dash/shared";
import { recordAuditEvent } from "../../platform/audit/auditRepository.js";
import type { Queryable } from "../../platform/db/schemaVersion.js";
import { timedQuery } from "../../platform/db/timedQuery.js";
import { withTransaction } from "../../platform/db/transaction.js";
import { ApiFailure, ForbiddenError, RateLimitedError, ServerNotFoundError } from "../../platform/errorResponse.js";
import { Mutex } from "../../platform/mutex.js";
import { TAKE_SERVER_MANAGEMENT_LOCK } from "./importServers.js";
import { addMember } from "./repositories/memberRepository.js";
import {
  countRecentSelfServeCreations,
  countSelfServeServers,
  insertSelfServeServer,
  listCreatedSelfServeServers,
  lockServerForSelfServeOwner,
  renameServerInTransaction,
  softDeleteServerInTransaction,
} from "./repositories/serverRepository.js";
import type { SelfServeConfig } from "./selfServeConfig.js";
import type { ManagementDb } from "./serverManagement.js";

/**
 * ADR-0046 sections 1 and 2: a signed-in player creates an agent server of their own, without the operator. The server is
 * born `agent` (no host, no tokens, no connection test, no outbound connection), gets a backend-generated public id, and
 * its owner is the caller. The player then takes an enrolment code from the existing agent settings.
 *
 * One transaction, under the server-management advisory lock (the same lock the operator's create and the import take),
 * so two concurrent creates cannot both pass a cap: the caps are re-checked (C5, C1, C3, C2), the server is INSERTED (never
 * the reviving upsert) with its creator, the owner membership added and `server.created` audited, ids only. After the commit
 * the runtime gains the server's agent entry. The operator's account is exempt from the caps. The kill switch is the route's.
 *
 * #526: C1, C3 and C5 count by CREATOR (`created_by_user_id`), not by current owner, so a transfer never frees a slot; C5 is
 * a count of the rows created in the last 24 hours, live or removed, so it survives a restart and counts create/remove churn.
 *
 * #526 (section 1.8): the OWNER of a self-serve server may rename and remove it (`renameAsOwner`, `removeAsOwner`). Each runs
 * in one transaction that locks the server row first and re-checks, under that lock, that the server is self-serve and the
 * caller its owner. An operator-created server answers "not_self_serve" (the route then applies the operator-only rule).
 */
export interface SelfServeDeps {
  db: ManagementDb;
  /** The caps (the kill switch is checked by the route). */
  config: Pick<SelfServeConfig, "maxServersPerAccount" | "maxServersTotal" | "maxPendingPerAccount" | "createsPerDay">;
  /** True only for the seeded operator account (exempt from every cap). */
  isOperator: (userId: string) => boolean;
  /** C3: which of these servers (internal ids) have EVER enrolled (an agent credential row exists, revoked or not). Run inside
   *  the create transaction. The composition root supplies the agents module's function, so `servers` never imports `agents`. */
  enrolledServerIds: (db: Queryable, serverIds: readonly string[]) => Promise<ReadonlySet<string>>;
  /** Builds the server's agent-backed runtime entry after the commit (idempotent; the composition root's builder). */
  attachRuntime: (publicId: string) => Promise<void>;
  /** A failed attach after the commit: the server exists and the first snapshot attaches it, so it is reported, not thrown. */
  onAttachError?: (publicId: string, err: unknown) => void;
  /** The running servers, for an owner's rename and remove after their commit (the composition root's `ServerRuntime`). */
  runtime: SelfServeRuntime;
  /** The management service's mutex (one per process; the composition root passes the same instance to both). */
  mutex?: Mutex;
  /** Injectable for tests. */
  generateId?: () => string;
}

/** What an owner's rename or remove changes in the running servers. */
export interface SelfServeRuntime {
  rename(publicId: string, displayName: string): unknown;
  remove(publicId: string): Promise<unknown>;
}

/** The server is operator-created: the owner path does not apply (nothing was changed). */
export const NOT_SELF_SERVE = "not_self_serve";

export interface SelfServeService {
  isOperator(userId: string): boolean;
  create(actorUserId: string, input: CreateAgentServerRequest): Promise<AgentServer>;
  /** The owner renames their self-serve server. 404 for an unknown or removed one, 403 when the caller is not its owner. */
  renameAsOwner(actorUserId: string, publicId: string, displayName: string): Promise<AgentServer | typeof NOT_SELF_SERVE>;
  /** The owner removes their self-serve server: `softDeleteServer`'s purge, the credential and codes with it, then the runtime
   *  entry. 404 for an unknown or removed one, 403 when the caller is not its owner. */
  removeAsOwner(actorUserId: string, publicId: string): Promise<"removed" | typeof NOT_SELF_SERVE>;
}

/** RFC 4648 base32, lowercased so it fits the public id format (`[a-z0-9-]`). */
const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
export const SELF_SERVE_ID_LENGTH = 20;
/** C5's window. */
export const CREATION_WINDOW_HOURS = 24;
const DAILY_LIMITED_MESSAGE = "You have added the most servers allowed in one day. Try again tomorrow.";
const NOT_OWNER_MESSAGE = "Only the owner of this server can do that.";

/** ADR-0020: 20 random base32 characters (100 bits). 256 is a multiple of 32, so masking a byte has no bias. */
export function generateServerPublicId(): string {
  return Array.from(randomBytes(SELF_SERVE_ID_LENGTH), (byte) => ALPHABET.charAt(byte & 31)).join("");
}

function limitReached(message: string): ApiFailure {
  return new ApiFailure("server_limit_reached", message);
}

export function createSelfServeService(deps: SelfServeDeps): SelfServeService {
  const generateId = deps.generateId ?? generateServerPublicId;
  const mutex = deps.mutex ?? new Mutex();

  /** C5, C1, C3, C2, in that order (the most specific answer first). Runs under the management lock. */
  const assertWithinCaps = async (client: Queryable, actorUserId: string): Promise<void> => {
    const { maxServersPerAccount, maxPendingPerAccount, maxServersTotal, createsPerDay } = deps.config;
    const recent = await countRecentSelfServeCreations(client, actorUserId, CREATION_WINDOW_HOURS, createsPerDay);
    if (recent.count >= createsPerDay) {
      throw new RateLimitedError(Math.max(1, recent.retryAfterSeconds ?? 1), DAILY_LIMITED_MESSAGE);
    }
    const created = await listCreatedSelfServeServers(client, actorUserId);
    if (created.length >= maxServersPerAccount) {
      throw limitReached(`You already have ${created.length} server(s); one account can have at most ${maxServersPerAccount}. Remove one to add another.`);
    }
    if (created.length > 0) {
      const enrolled = await deps.enrolledServerIds(client, created.map((server) => server.serverId));
      const pending = created.filter((server) => !enrolled.has(server.serverId));
      if (pending.length >= maxPendingPerAccount) {
        throw limitReached(`Connect your server "${pending[0]!.displayName}" with its enrolment code before adding another.`);
      }
    }
    if ((await countSelfServeServers(client)) >= maxServersTotal) {
      throw limitReached("The service is full right now: no new servers can be added. Try again later.");
    }
  };

  /** Locks the server row and checks the owner path applies: undefined to go on, NOT_SELF_SERVE to leave it to the operator. */
  const lockOwned = async (client: Queryable, actorUserId: string, publicId: string): Promise<typeof NOT_SELF_SERVE | undefined> => {
    const locked = await lockServerForSelfServeOwner(client, publicId, actorUserId);
    if (locked === undefined) throw new ServerNotFoundError();
    if (!locked.selfServe) return NOT_SELF_SERVE;
    if (!locked.isOwner) throw new ForbiddenError(NOT_OWNER_MESSAGE);
    return undefined;
  };

  return {
    isOperator: (userId) => deps.isOperator(userId),

    async create(actorUserId, input) {
      const exempt = deps.isOperator(actorUserId);
      const publicId = generateId();
      const server = await withTransaction(deps.db, async (client) => {
        // Serialises the cap checks and the insert across requests, processes and instances; released at COMMIT.
        await timedQuery(client, "servers.selfServe.takeAdvisoryLock", TAKE_SERVER_MANAGEMENT_LOCK);
        if (!exempt) await assertWithinCaps(client, actorUserId);
        const row = await insertSelfServeServer(client, { publicId, displayName: input.displayName, createdByUserId: actorUserId });
        // actorUserId null: the audit event below records who did it (as the operator's create does).
        const member = await addMember(client, { serverId: row.id, userId: actorUserId, role: "owner", actorUserId: null });
        if (member !== "added") throw new Error("could not add the owner of a new self-serve server");
        // Ids only: the display name is the player's own text and stays out of the audit trail.
        await recordAuditEvent(client, { action: "server.created", actorUserId, serverId: row.id, detail: { via: "self_serve" } });
        return row;
      });

      try {
        await deps.attachRuntime(server.publicId);
      } catch (err) {
        deps.onAttachError?.(server.publicId, err);
      }
      return { id: server.publicId, displayName: server.displayName, kind: "agent" };
    },

    // #526 (L1): both run under the management service's mutex (the composition root passes the same one), so the write and
    // its runtime change never interleave with an operator's create, edit, switch or remove. The mutex is released before the
    // router falls through to the operator path on NOT_SELF_SERVE, so the two never nest.
    renameAsOwner(actorUserId, publicId, displayName) {
      return mutex.run(async () => {
        const outcome = await withTransaction(deps.db, async (client) => {
          const refused = await lockOwned(client, actorUserId, publicId);
          if (refused !== undefined) return refused;
          // `server.updated`, the field name only (never the new name), as the operator's rename writes it.
          if (!(await renameServerInTransaction(client, publicId, displayName, { actorUserId }))) throw new ServerNotFoundError();
          return "renamed" as const;
        });
        if (outcome === NOT_SELF_SERVE) return outcome;
        deps.runtime.rename(publicId, displayName);
        return { id: publicId, displayName, kind: "agent" as const };
      });
    },

    removeAsOwner(actorUserId, publicId) {
      return mutex.run(async () => {
        const outcome = await withTransaction(deps.db, async (client) => {
          const refused = await lockOwned(client, actorUserId, publicId);
          if (refused !== undefined) return refused;
          // The same purge as the operator's remove (#516's list): memberships, credential and codes, history, alerts, map.
          const removed = await softDeleteServerInTransaction(client, publicId, { actorUserId, detail: { reason: "owner_removed" } });
          if (!removed) throw new ServerNotFoundError();
          return "removed" as const;
        });
        if (outcome === NOT_SELF_SERVE) return outcome;
        // After the commit: the agent-backed entry goes (its live reading with it). The database is the truth; a restart
        // never rebuilds a removed server.
        await deps.runtime.remove(publicId);
        return outcome;
      });
    },
  };
}
