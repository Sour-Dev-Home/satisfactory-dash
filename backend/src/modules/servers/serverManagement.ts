import type {
  CreateServerRequest,
  ServerConnection as ServerConnectionView,
  TestConnectionRequest,
  TestConnectionResponse,
  UpdateServerRequest,
} from "@satisfactory-dash/shared";
import { withTransaction } from "../../platform/db/transaction.js";
import type { Queryable } from "../../platform/db/schemaVersion.js";
import { ApiFailure, ServerNotFoundError } from "../../platform/errorResponse.js";
import { Mutex } from "../../platform/mutex.js";
import { SecretsError } from "../../platform/secrets/secrets.js";
import type { SecretsKeyring } from "../../platform/secrets/secrets.js";
import { recordAuditEvent } from "../../platform/audit/auditRepository.js";
import { AddressRefusedError, isAllowedAddress, isLoopbackAddress, resolveAllowedAddress } from "./addressGuard.js";
import type { AddressLookup } from "./addressGuard.js";
import { MAX_LOCAL_SERVERS } from "./importServers.js";
import { addMember } from "./repositories/memberRepository.js";
import {
  countConnections,
  createConnection,
  getConnection,
  getConnectionMetaByPublicId,
  listConnectionMetas,
  updateConnection,
} from "./repositories/connectionRepository.js";
import type { ConnectionMeta, ConnectionPatch, ServerConnection } from "./repositories/connectionRepository.js";
import { findServerByPublicId, renameServer, softDeleteServer, upsertConfiguredServer } from "./repositories/serverRepository.js";
import type { RuntimeServer, ServerRuntime } from "./serverRuntime.js";

/**
 * ADR-0030 phase 1: the operator adds, edits and removes the game servers this backend connects to.
 * This is the service behind the routes; it knows nothing about HTTP. The rules it enforces:
 *
 * - The host is resolved and EVERY address must be loopback or private (`resolveAllowedAddress`), on
 *   every create, every edit that touches the connection, and every test. The pinned address is what
 *   the backend connects to. A refusal never names the address.
 * - A test connection must pass before anything is saved.
 * - Tokens are write-only: a view carries "set" and the last 4 characters, never a token.
 * - At most MAX_LOCAL_SERVERS. The count and the insert are serialised by an in-process mutex AND a
 *   transaction-scoped Postgres advisory lock, so concurrent creates cannot pass the cap together.
 * - Every mutation of the runtime (add, replace, remove) runs under the same mutex, one at a time.
 * - Remove wipes the encrypted tokens and the memberships and stops the pollers.
 */

/** The Postgres side of the service: a pool that can also open a transaction. */
export type ManagementDb = Queryable & Parameters<typeof withTransaction>[0];

/** What a test connection needs: the address to use and the tokens. Never a hostname (no re-resolving). */
export interface ConnectionCandidate {
  pinnedIp: string;
  apiPort: number;
  frmPort: number;
  apiToken: string;
  frmToken?: string;
}

export interface ServerManagementDeps<TServices> {
  db: ManagementDb;
  ring: SecretsKeyring | null;
  runtime: ServerRuntime<TServices>;
  /** Builds a running server (services and pollers) from an opened connection. */
  build: (connection: ServerConnection) => RuntimeServer<TServices>;
  /** Runs the two reads against the candidate (composition root: the gameserver module). */
  testConnection: (candidate: ConnectionCandidate) => Promise<TestConnectionResponse>;
  /** The seeded operator account's id; undefined until the database is up. */
  getOperatorUserId: () => string | undefined;
  /** Names of the environment variables that still configure servers (composition root: the gameserver module).
   *  While any is set and no connection is stored, create is refused with `import_required`. */
  configuredServerEnvNames?: () => string[];
  /** DNS lookup, injectable for tests. */
  lookup?: AddressLookup;
  /** One mutex per process; tests may pass their own. */
  mutex?: Mutex;
}

export interface ServerManagementService {
  /** True only for the operator account. */
  canManage(userId: string): boolean;
  create(actorUserId: string, input: CreateServerRequest): Promise<ServerConnectionView>;
  get(publicId: string): Promise<ServerConnectionView>;
  /** Every stored connection, including unreadable and refused ones (the operator's management list). */
  list(): Promise<ServerConnectionView[]>;
  update(actorUserId: string, publicId: string, patch: UpdateServerRequest): Promise<ServerConnectionView>;
  remove(actorUserId: string, publicId: string): Promise<void>;
  testCandidate(input: TestConnectionRequest): Promise<TestConnectionResponse>;
  testSaved(publicId: string): Promise<TestConnectionResponse>;
}

/** Long enough that the last 4 characters reveal little; shorter tokens show no suffix. */
const LAST4_MIN_LENGTH = 12;
const last4 = (token: string): string | null => (token.length >= LAST4_MIN_LENGTH ? token.slice(-4) : null);

const TAKE_ADVISORY_LOCK = "SELECT pg_advisory_xact_lock(hashtext('satis.server_management'))";

function refusedAddress(): ApiFailure {
  return new ApiFailure(
    "address_not_allowed",
    "That host is not a loopback or private (LAN) address, or it could not be resolved.",
  );
}

function testFailure(result: TestConnectionResponse): ApiFailure {
  const side = (check: TestConnectionResponse["api"]) => (check.ok ? "ok" : (check.error ?? "failed"));
  return new ApiFailure(
    "connection_test_failed",
    `The game server did not pass the connection test (API: ${side(result.api)}, FRM: ${side(result.frm)}). Nothing was saved.`,
  );
}

const UNREADABLE_MESSAGE =
  "The stored tokens cannot be read with this backend's key. Send both tokens again (the FRM token may be null).";

function viewOf(
  meta: Pick<ConnectionMeta, "publicId" | "displayName" | "host" | "pinnedIp" | "apiPort" | "frmPort" | "frmTokenSet">,
  tokens: { apiToken: string; frmToken?: string } | undefined,
): ServerConnectionView {
  return {
    id: meta.publicId,
    displayName: meta.displayName,
    host: meta.host,
    apiPort: meta.apiPort,
    frmPort: meta.frmPort,
    apiTokenSet: true,
    apiTokenLast4: tokens ? last4(tokens.apiToken) : null,
    frmTokenSet: meta.frmTokenSet,
    frmTokenLast4: tokens?.frmToken === undefined ? null : last4(tokens.frmToken),
    // "refused" wins: a stored address that is not loopback or private is never connected to, whatever the tokens are.
    state: !isAllowedAddress(meta.pinnedIp) ? "refused" : tokens ? "ok" : "unreadable",
    plainHttpOverLan: !isLoopbackAddress(meta.pinnedIp),
  };
}

export function createServerManagementService<TServices>(deps: ServerManagementDeps<TServices>): ServerManagementService {
  const mutex = deps.mutex ?? new Mutex();

  const ringOrUnavailable = (): SecretsKeyring => {
    if (deps.ring === null) {
      // Not configured: management needs SERVER_SECRETS_KEY (the runbook's first step).
      throw new ApiFailure("service_unavailable", "Server management is not set up on this backend.");
    }
    return deps.ring;
  };

  const pin = async (host: string): Promise<string> => {
    try {
      return await resolveAllowedAddress(host, deps.lookup);
    } catch (err) {
      if (err instanceof AddressRefusedError) throw refusedAddress();
      throw err;
    }
  };

  const requireMeta = async (publicId: string): Promise<ConnectionMeta> => {
    const meta = await getConnectionMetaByPublicId(deps.db, publicId);
    if (meta === undefined) throw new ServerNotFoundError();
    return meta;
  };

  /** The opened tokens, or undefined when this backend cannot open them. */
  const openTokens = async (ring: SecretsKeyring, meta: ConnectionMeta) => {
    try {
      const connection = await getConnection(deps.db, ring, meta.serverId);
      return connection === undefined ? undefined : { apiToken: connection.apiToken, frmToken: connection.frmToken };
    } catch (err) {
      if (err instanceof SecretsError) return undefined;
      throw err;
    }
  };

  /** The view of a stored connection, from metadata. Tokens are opened only to show their last 4 characters, and
   *  never for a refused address or without a key (then the row is "unreadable"). */
  const viewFor = async (meta: ConnectionMeta): Promise<ServerConnectionView> => {
    const openable = deps.ring !== null && isAllowedAddress(meta.pinnedIp);
    return viewOf(meta, openable ? await openTokens(deps.ring as SecretsKeyring, meta) : undefined);
  };

  const connectionOf = (
    meta: Pick<ConnectionMeta, "serverId" | "publicId" | "displayName">,
    fields: { host: string; pinnedIp: string; apiPort: number; frmPort: number; apiToken: string; frmToken?: string },
  ): ServerConnection => ({ serverId: meta.serverId, publicId: meta.publicId, displayName: meta.displayName, ...fields });

  return {
    canManage(userId) {
      const operator = deps.getOperatorUserId();
      return operator !== undefined && operator === userId;
    },

    async testCandidate(input) {
      const pinnedIp = await pin(input.host);
      return deps.testConnection({ pinnedIp, apiPort: input.apiPort, frmPort: input.frmPort, apiToken: input.apiToken, frmToken: input.frmToken });
    },

    async testSaved(publicId) {
      const ring = ringOrUnavailable();
      const meta = await requireMeta(publicId);
      // The host must still resolve to allowed addresses; the test then uses the STORED pinned address
      // (what the backend really connects to), never a fresh answer for the name.
      await pin(meta.host);
      // A stored address that is not allowed is never connected to, not even to test it.
      if (!isAllowedAddress(meta.pinnedIp)) throw refusedAddress();
      const tokens = await openTokens(ring, meta);
      if (tokens === undefined) throw new ApiFailure("connection_unreadable", UNREADABLE_MESSAGE);
      return deps.testConnection({ pinnedIp: meta.pinnedIp, apiPort: meta.apiPort, frmPort: meta.frmPort, ...tokens });
    },

    async get(publicId) {
      return viewFor(await requireMeta(publicId));
    },

    async list() {
      const metas = await listConnectionMetas(deps.db);
      // One at a time: at most MAX_LOCAL_SERVERS rows, each opened only to show the last 4 characters.
      const views: ServerConnectionView[] = [];
      for (const meta of metas) views.push(await viewFor(meta));
      return views;
    },

    create(actorUserId, input) {
      return mutex.run(async () => {
        const ring = ringOrUnavailable();
        // While the servers still come from the environment and none is stored, adding one would make the
        // database win at the next restart and silently drop them: the import comes first.
        if ((deps.configuredServerEnvNames?.() ?? []).length > 0 && (await countConnections(deps.db)) === 0) {
          throw new ApiFailure(
            "import_required",
            "Servers are still configured in the environment. Import them first (npm run admin -- import-servers; see the servers runbook), then add more.",
          );
        }
        const pinnedIp = await pin(input.host);
        const test = await deps.testConnection({ pinnedIp, apiPort: input.apiPort, frmPort: input.frmPort, apiToken: input.apiToken, frmToken: input.frmToken });
        if (!test.ok) throw testFailure(test);

        const serverId = await withTransaction(deps.db, async (client) => {
          // Serialises the count and the insert across processes and instances; released at COMMIT.
          await client.query(TAKE_ADVISORY_LOCK);
          if ((await countConnections(client)) >= MAX_LOCAL_SERVERS) {
            throw new ApiFailure("server_limit_reached", `At most ${MAX_LOCAL_SERVERS} servers can be added.`);
          }
          if ((await findServerByPublicId(client, input.id)) !== undefined) {
            throw new ApiFailure("server_exists", "A server with that id already exists.");
          }
          // Creates the row, or revives a removed one under this id (its memberships were deleted at removal).
          const row = await upsertConfiguredServer(client, { publicId: input.id, displayName: input.displayName });
          const outcome = await createConnection(client, ring, row.id, {
            host: input.host,
            pinnedIp,
            apiPort: input.apiPort,
            frmPort: input.frmPort,
            apiToken: input.apiToken,
            frmToken: input.frmToken,
          });
          if (outcome !== "created") {
            throw new ApiFailure("server_exists", "A server with that id already exists.");
          }
          // The operator owns what they add. actorUserId null: the audit event below records who did it.
          const member = await addMember(client, { serverId: row.id, userId: actorUserId, role: "owner", actorUserId: null });
          if (member === "unknown_server_or_user") throw new Error("could not seed the owner of a new server");
          await recordAuditEvent(client, { action: "server.created", actorUserId, serverId: row.id });
          return row.id;
        });

        const connection = connectionOf(
          { serverId, publicId: input.id, displayName: input.displayName },
          { host: input.host, pinnedIp, apiPort: input.apiPort, frmPort: input.frmPort, apiToken: input.apiToken, frmToken: input.frmToken },
        );
        await deps.runtime.replace(deps.build(connection));
        return viewOf(
          { publicId: input.id, displayName: input.displayName, host: input.host, pinnedIp, apiPort: input.apiPort, frmPort: input.frmPort, frmTokenSet: input.frmToken !== undefined },
          { apiToken: input.apiToken, frmToken: input.frmToken },
        );
      });
    },

    update(actorUserId, publicId, patch) {
      return mutex.run(async () => {
        const ring = ringOrUnavailable();
        const meta = await requireMeta(publicId);
        const touchesConnection =
          patch.host !== undefined ||
          patch.apiPort !== undefined ||
          patch.frmPort !== undefined ||
          patch.apiToken !== undefined ||
          patch.frmToken !== undefined;

        // A rename alone changes nothing about how the backend connects: no lookup, no test, pollers keep running.
        if (!touchesConnection) {
          const displayName = patch.displayName ?? meta.displayName;
          if (!(await renameServer(deps.db, publicId, displayName, { actorUserId }))) throw new ServerNotFoundError();
          deps.runtime.rename(publicId, displayName);
          const renamed = { ...meta, displayName };
          return viewOf(renamed, await openTokens(ring, renamed));
        }

        const host = patch.host ?? meta.host;
        const pinnedIp = await pin(host);
        const opened = await openTokens(ring, meta);
        let apiToken: string;
        let frmToken: string | undefined;
        if (opened === undefined) {
          // The repair path: the stored tokens cannot be opened, so the operator sends both again.
          if (patch.apiToken === undefined || patch.frmToken === undefined) {
            throw new ApiFailure("connection_unreadable", UNREADABLE_MESSAGE);
          }
          apiToken = patch.apiToken;
          frmToken = patch.frmToken ?? undefined;
        } else {
          apiToken = patch.apiToken ?? opened.apiToken;
          frmToken = patch.frmToken === undefined ? opened.frmToken : (patch.frmToken ?? undefined);
        }
        const apiPort = patch.apiPort ?? meta.apiPort;
        const frmPort = patch.frmPort ?? meta.frmPort;

        const test = await deps.testConnection({ pinnedIp, apiPort, frmPort, apiToken, frmToken });
        if (!test.ok) throw testFailure(test);

        const connectionPatch: ConnectionPatch = { ...patch, pinnedIp };
        const updated = await updateConnection(deps.db, ring, meta.serverId, connectionPatch, { actorUserId });
        if (!updated) throw new ServerNotFoundError();

        const displayName = patch.displayName ?? meta.displayName;
        await deps.runtime.replace(
          deps.build(connectionOf({ serverId: meta.serverId, publicId, displayName }, { host, pinnedIp, apiPort, frmPort, apiToken, frmToken })),
        );
        return viewOf({ publicId, displayName, host, pinnedIp, apiPort, frmPort, frmTokenSet: frmToken !== undefined }, { apiToken, frmToken });
      });
    },

    remove(actorUserId, publicId) {
      return mutex.run(async () => {
        // No keyring needed: an unreadable or keyless row must still be removable.
        await requireMeta(publicId);
        // The row and its tokens and memberships go in one transaction; then the pollers stop.
        const removed = await softDeleteServer(deps.db, publicId, { actorUserId });
        if (!removed) throw new ServerNotFoundError();
        await deps.runtime.remove(publicId);
      });
    },
  };
}
