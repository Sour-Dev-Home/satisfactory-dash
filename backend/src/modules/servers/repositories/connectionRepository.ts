import { isIP } from "node:net";
import { z } from "zod";
import { parseRows } from "../../../platform/db/rows.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { timedQuery } from "../../../platform/db/timedQuery.js";
import { SecretsError } from "../../../platform/secrets/secrets.js";
import type { SecretsKeyring } from "../../../platform/secrets/secrets.js";

/**
 * The stored connections of the retired direct-poll servers (ADR-0030): host, the pinned address, ports and the two
 * game tokens, sealed by platform/secrets so the database (and any backup of it) holds ciphertext only.
 *
 * ADR-0066 build PR 6: nothing reaches a game server directly any more, so every write path and every read but one is
 * gone. What stays is `listConnections`, for the `verify-secrets` admin command that the backup restore drill runs
 * (`runbooks/backups.md`): it proves a restored database's sealed tokens open with the backed-up key. The table and this
 * read go in build PR 10, which drops the table. Rows are still deleted by a server's soft delete and at its enrolment
 * (serverRepository.ts).
 *
 * The AES-GCM context that binds a sealed value to its place is built in ONE function (`tokenContext`), from the row's
 * own server id and connection kind and the field name: a token copied to another server, or the API token swapped into
 * the FRM column, fails to open.
 *
 * Errors and logs from this file never carry a token, a key or a ciphertext.
 */

export interface ServerConnection {
  /** Internal server uuid. Never sent to clients. */
  serverId: string;
  publicId: string;
  displayName: string;
  /** What the operator typed (hostname or address). */
  host: string;
  /** The address the backend connected to. */
  pinnedIp: string;
  apiPort: number;
  frmPort: number;
  apiToken: string;
  /** FRM can run without a token. */
  frmToken?: string;
  /** When the row was last written (ISO 8601). */
  updatedAt?: string;
}

export interface UnreadableConnection {
  serverId: string;
  publicId: string;
  /** The key id stored with the row (not secret), for the operator's log line. */
  keyId: string;
}

export interface ConnectionList {
  connections: ServerConnection[];
  /** Rows this process cannot open: no keyring, an unknown key id, or a value that fails to open. */
  unreadable: UnreadableConnection[];
}

type TokenField = "api" | "frm";

/** The single place the sealing context is built. `connectionKind` comes from the server row. */
function tokenContext(serverId: string, connectionKind: string, field: TokenField): string {
  return `${serverId}:${connectionKind}:${field}`;
}

const ConnectionRowSchema = z.object({
  server_id: z.string(),
  public_id: z.string(),
  display_name: z.string(),
  connection_kind: z.string(),
  host: z.string(),
  pinned_ip: z.string().refine((value) => isIP(value) !== 0),
  api_port: z.number().int(),
  frm_port: z.number().int(),
  api_token_enc: z.instanceof(Buffer),
  frm_token_enc: z.instanceof(Buffer).nullable(),
  key_id: z.string(),
  updated_at: z.date().optional(),
});
type ConnectionRow = z.output<typeof ConnectionRowSchema>;

// A whole statement, never assembled from pieces (the SQL guard, ADR-0025 decision 2).
const LIST_LIVE = `
  SELECT c.server_id, s.public_id, s.display_name, s.connection_kind, c.host, host(c.pinned_ip) AS pinned_ip,
         c.api_port, c.frm_port, c.api_token_enc, c.frm_token_enc, c.key_id, c.updated_at
  FROM servers.server_connections c
  JOIN servers.servers s ON s.id = c.server_id
  WHERE s.deleted_at IS NULL
  ORDER BY s.public_id`;

function openRow(ring: SecretsKeyring, row: ConnectionRow): ServerConnection {
  const connection: ServerConnection = {
    serverId: row.server_id,
    publicId: row.public_id,
    displayName: row.display_name,
    host: row.host,
    pinnedIp: row.pinned_ip,
    apiPort: row.api_port,
    frmPort: row.frm_port,
    apiToken: ring.open(row.key_id, row.api_token_enc, tokenContext(row.server_id, row.connection_kind, "api")),
  };
  if (row.frm_token_enc !== null) {
    connection.frmToken = ring.open(row.key_id, row.frm_token_enc, tokenContext(row.server_id, row.connection_kind, "frm"));
  }
  if (row.updated_at !== undefined) connection.updatedAt = row.updated_at.toISOString();
  return connection;
}

/** Every live connection, opened where possible. A row that cannot be opened is reported (never
 *  silently skipped) so `verify-secrets` can say so; the caller logs only its key id. */
export async function listConnections(db: Queryable, ring: SecretsKeyring | null): Promise<ConnectionList> {
  const result = await timedQuery(db, "servers.listConnections", LIST_LIVE);
  const rows = parseRows(ConnectionRowSchema, result.rows, "servers.listConnections");
  const list: ConnectionList = { connections: [], unreadable: [] };
  for (const row of rows) {
    const unreadable = { serverId: row.server_id, publicId: row.public_id, keyId: row.key_id };
    if (ring === null || !ring.hasKey(row.key_id)) {
      list.unreadable.push(unreadable);
      continue;
    }
    try {
      list.connections.push(openRow(ring, row));
    } catch (err) {
      if (!(err instanceof SecretsError)) throw err;
      list.unreadable.push(unreadable);
    }
  }
  return list;
}
