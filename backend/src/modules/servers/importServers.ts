import { withTransaction } from "../../platform/db/transaction.js";
import type { SecretsKeyring } from "../../platform/secrets/secrets.js";
import { countConnections, createConnection } from "./repositories/connectionRepository.js";
import { ensureServer } from "./repositories/serverRepository.js";

/** ADR-0030 decision 2: the operator may manage at most this many local servers. */
export const MAX_LOCAL_SERVERS = 8;

/** The request timeout every database-stored server uses (it is not stored per server). */
const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

/** A configured server (the servers file or the single-server env), in the shape the gameserver
 *  module's `ConfiguredServer` already has. Declared here so this module needs no import from it. */
export interface ImportableServer {
  id: string;
  displayName: string;
  config: {
    host: string;
    apiPort: number;
    apiToken?: string;
    apiAllowSelfSignedCert: boolean;
    frmPort: number;
    frmToken?: string;
    requestTimeoutMs: number;
  };
}

export interface ImportResult {
  /** Public ids created in the database. */
  imported: string[];
  /** Public ids that already had a connection in the database: left exactly as they are (the database wins). */
  skipped: string[];
  /** Settings that are not stored, by server id. Never a value. */
  warnings: string[];
}

/** A reason the import cannot proceed. The message names a server id and a setting, never a value. */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

/**
 * `npm run admin -- import-servers`: copies the configured servers into the database, tokens
 * encrypted, in ONE transaction (any refusal rolls everything back). Idempotent: a server that
 * already has a connection is skipped and never overwritten, so it is safe to run twice and it
 * never undoes an edit made in the app; an existing server row keeps its display name.
 *
 * `resolvePinnedIp` turns the configured host into the address to pin (the CLI resolves the host
 * and checks that it is loopback or private; a plain address is returned as is).
 */
export async function importServers(
  pool: Parameters<typeof withTransaction>[0],
  ring: SecretsKeyring,
  servers: ImportableServer[],
  resolvePinnedIp: (host: string) => Promise<string>,
): Promise<ImportResult> {
  const result: ImportResult = { imported: [], skipped: [], warnings: [] };
  return withTransaction(pool, async (client) => {
    for (const server of servers) {
      const { config } = server;
      if (config.apiToken === undefined || config.apiToken.trim() === "") {
        throw new ImportError(`Server "${server.id}" has no API token; the database requires one (SATISFACTORY_API_TOKEN or "apiToken").`);
      }
      if (!config.apiAllowSelfSignedCert) {
        throw new ImportError(
          `Server "${server.id}" verifies the game server's TLS certificate ("verifyApiCertificate" or SATISFACTORY_API_REJECT_UNAUTHORIZED), which the database does not store yet. Remove the setting to import it.`,
        );
      }
      if (config.requestTimeoutMs !== DEFAULT_REQUEST_TIMEOUT_MS) {
        result.warnings.push(`Server "${server.id}": its custom request timeout is not stored; the default (${DEFAULT_REQUEST_TIMEOUT_MS} ms) applies.`);
      }
      let pinnedIp: string;
      try {
        pinnedIp = await resolvePinnedIp(config.host);
      } catch {
        throw new ImportError(`Server "${server.id}": its host could not be resolved to a loopback or private address.`);
      }
      const row = await ensureServer(client, { publicId: server.id, displayName: server.displayName });
      const outcome = await createConnection(client, ring, row.id, {
        host: config.host,
        pinnedIp,
        apiPort: config.apiPort,
        frmPort: config.frmPort,
        apiToken: config.apiToken,
        // A blank FRM_AUTH_TOKEN means "no token".
        frmToken: config.frmToken === undefined || config.frmToken === "" ? undefined : config.frmToken,
      });
      if (outcome === "not_local_server") {
        throw new ImportError(`Server "${server.id}" exists but is not a local server, so it cannot take a connection.`);
      }
      (outcome === "created" ? result.imported : result.skipped).push(server.id);
    }
    if ((await countConnections(client)) > MAX_LOCAL_SERVERS) {
      throw new ImportError(`That would exceed the limit of ${MAX_LOCAL_SERVERS} local servers.`);
    }
    return result;
  });
}
