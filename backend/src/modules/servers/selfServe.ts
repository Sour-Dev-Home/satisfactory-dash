import { randomBytes } from "node:crypto";
import type { AgentServer, CreateAgentServerRequest } from "@satisfactory-dash/shared";
import { recordAuditEvent } from "../../platform/audit/auditRepository.js";
import type { Queryable } from "../../platform/db/schemaVersion.js";
import { timedQuery } from "../../platform/db/timedQuery.js";
import { withTransaction } from "../../platform/db/transaction.js";
import { ApiFailure } from "../../platform/errorResponse.js";
import { TAKE_SERVER_MANAGEMENT_LOCK } from "./importServers.js";
import { addMember } from "./repositories/memberRepository.js";
import { countSelfServeServers, insertSelfServeServer, listOwnedSelfServeServers } from "./repositories/serverRepository.js";
import type { SelfServeConfig } from "./selfServeConfig.js";
import type { ManagementDb } from "./serverManagement.js";

/**
 * ADR-0046 sections 1 and 2: a signed-in player creates an agent server of their own, without the operator. The server is
 * born `agent` (no host, no tokens, no connection test, no outbound connection), gets a backend-generated public id, and
 * its owner is the caller. The player then takes an enrolment code from the existing agent settings.
 *
 * One transaction, under the server-management advisory lock (the same lock the operator's create and the import take),
 * so two concurrent creates cannot both pass a cap: the caps are re-checked (C1, C3, C2), the server is INSERTED (never
 * the reviving upsert), the owner membership added and `server.created` audited, ids only. After the commit the runtime
 * gains the server's agent entry. The operator's account is exempt from the caps. C5 (creations per day) is the route's
 * limiter; the kill switch is the route's too.
 */
export interface SelfServeDeps {
  db: ManagementDb;
  /** The caps (the kill switch is checked by the route). */
  config: Pick<SelfServeConfig, "maxServersPerAccount" | "maxServersTotal" | "maxPendingPerAccount">;
  /** True only for the seeded operator account (exempt from every cap). */
  isOperator: (userId: string) => boolean;
  /** C3: which of these servers (internal ids) have EVER enrolled (an agent credential row exists, revoked or not). Run inside
   *  the create transaction. The composition root supplies the agents module's function, so `servers` never imports `agents`. */
  enrolledServerIds: (db: Queryable, serverIds: readonly string[]) => Promise<ReadonlySet<string>>;
  /** Builds the server's agent-backed runtime entry after the commit (idempotent; the composition root's builder). */
  attachRuntime: (publicId: string) => Promise<void>;
  /** A failed attach after the commit: the server exists and the first snapshot attaches it, so it is reported, not thrown. */
  onAttachError?: (publicId: string, err: unknown) => void;
  /** Injectable for tests. */
  generateId?: () => string;
}

export interface SelfServeService {
  isOperator(userId: string): boolean;
  create(actorUserId: string, input: CreateAgentServerRequest): Promise<AgentServer>;
}

/** RFC 4648 base32, lowercased so it fits the public id format (`[a-z0-9-]`). */
const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
export const SELF_SERVE_ID_LENGTH = 20;

/** ADR-0020: 20 random base32 characters (100 bits). 256 is a multiple of 32, so masking a byte has no bias. */
export function generateServerPublicId(): string {
  return Array.from(randomBytes(SELF_SERVE_ID_LENGTH), (byte) => ALPHABET.charAt(byte & 31)).join("");
}

function limitReached(message: string): ApiFailure {
  return new ApiFailure("server_limit_reached", message);
}

export function createSelfServeService(deps: SelfServeDeps): SelfServeService {
  const generateId = deps.generateId ?? generateServerPublicId;

  /** C1, C3, C2, in that order (the most specific answer first). Runs under the management lock. */
  const assertWithinCaps = async (client: Queryable, actorUserId: string): Promise<void> => {
    const { maxServersPerAccount, maxPendingPerAccount, maxServersTotal } = deps.config;
    const owned = await listOwnedSelfServeServers(client, actorUserId);
    if (owned.length >= maxServersPerAccount) {
      throw limitReached(`You already have ${owned.length} server(s); one account can have at most ${maxServersPerAccount}. Remove one to add another.`);
    }
    if (owned.length > 0) {
      const enrolled = await deps.enrolledServerIds(client, owned.map((server) => server.serverId));
      const pending = owned.filter((server) => !enrolled.has(server.serverId));
      if (pending.length >= maxPendingPerAccount) {
        throw limitReached(`Connect your server "${pending[0]!.displayName}" with its enrolment code before adding another.`);
      }
    }
    if ((await countSelfServeServers(client)) >= maxServersTotal) {
      throw limitReached("The service is full right now: no new servers can be added. Try again later.");
    }
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
        const row = await insertSelfServeServer(client, { publicId, displayName: input.displayName });
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
  };
}
