import { isIP } from "node:net";
import { z } from "zod";
import { parseFirst, parseRows } from "../../../platform/db/rows.js";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { withTransaction } from "../../../platform/db/transaction.js";
import { SecretsError } from "../../../platform/secrets/secrets.js";
import type { SecretsKeyring } from "../../../platform/secrets/secrets.js";

/**
 * How to reach a local server (ADR-0030): host, the pinned address, ports and the two game tokens.
 * The tokens are sealed by platform/secrets before they reach SQL and opened only here, so the
 * database (and any backup of it) holds ciphertext only.
 *
 * The AES-GCM context that binds a sealed value to its place is built in ONE function
 * (`tokenContext`), from the row's own server id and connection kind and the field name, never
 * from request input: a token copied to another server, or the API token swapped into the FRM
 * column, fails to open.
 *
 * Errors and logs from this file never carry a token, a key or a ciphertext.
 */

export interface ServerConnection {
  /** Internal server uuid. Never sent to clients. */
  serverId: string;
  publicId: string;
  /** What the operator typed (hostname or address). */
  host: string;
  /** The address the backend connects to; validated by the address guard (a later PR), re-checked on every connect. */
  pinnedIp: string;
  apiPort: number;
  frmPort: number;
  apiToken: string;
  /** FRM can run without a token. */
  frmToken?: string;
}

/** The write-only view (ADR-0030): whether a token is set and its last 4 characters, never the token. */
export interface ServerConnectionSummary {
  serverId: string;
  publicId: string;
  host: string;
  pinnedIp: string;
  apiPort: number;
  frmPort: number;
  apiTokenSet: true;
  apiTokenLast4: string | null;
  frmTokenSet: boolean;
  frmTokenLast4: string | null;
}

export interface ConnectionInput {
  host: string;
  pinnedIp: string;
  apiPort: number;
  frmPort: number;
  apiToken: string;
  frmToken?: string;
}

/** Fields an edit may change. `frmToken: null` clears the FRM token; `undefined` keeps it. */
export interface ConnectionPatch {
  host?: string;
  pinnedIp?: string;
  apiPort?: number;
  frmPort?: number;
  apiToken?: string;
  frmToken?: string | null;
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

/** Only local servers have a connection row (agent servers are reached through their agent). */
const LOCAL_KIND = "local";

/** Long enough that showing the end reveals little; shorter tokens show no suffix at all. */
const LAST4_MIN_TOKEN_LENGTH = 12;
const last4 = (token: string): string | null => (token.length >= LAST4_MIN_TOKEN_LENGTH ? token.slice(-4) : null);

const ConnectionRowSchema = z.object({
  server_id: z.string(),
  public_id: z.string(),
  connection_kind: z.string(),
  host: z.string(),
  pinned_ip: z.string().refine((value) => isIP(value) !== 0),
  api_port: z.number().int(),
  frm_port: z.number().int(),
  api_token_enc: z.instanceof(Buffer),
  frm_token_enc: z.instanceof(Buffer).nullable(),
  key_id: z.string(),
});
type ConnectionRow = z.output<typeof ConnectionRowSchema>;

// Whole statements, never assembled from pieces (the SQL guard, ADR-0025 decision 2).
const LIST_LIVE = `
  SELECT c.server_id, s.public_id, s.connection_kind, c.host, host(c.pinned_ip) AS pinned_ip,
         c.api_port, c.frm_port, c.api_token_enc, c.frm_token_enc, c.key_id
  FROM servers.server_connections c
  JOIN servers.servers s ON s.id = c.server_id
  WHERE s.deleted_at IS NULL
  ORDER BY s.public_id`;

const SELECT_ONE = `
  SELECT c.server_id, s.public_id, s.connection_kind, c.host, host(c.pinned_ip) AS pinned_ip,
         c.api_port, c.frm_port, c.api_token_enc, c.frm_token_enc, c.key_id
  FROM servers.server_connections c
  JOIN servers.servers s ON s.id = c.server_id
  WHERE s.deleted_at IS NULL AND c.server_id = $1`;

const SELECT_ONE_FOR_UPDATE = `
  SELECT c.server_id, s.public_id, s.connection_kind, c.host, host(c.pinned_ip) AS pinned_ip,
         c.api_port, c.frm_port, c.api_token_enc, c.frm_token_enc, c.key_id
  FROM servers.server_connections c
  JOIN servers.servers s ON s.id = c.server_id
  WHERE s.deleted_at IS NULL AND c.server_id = $1
  FOR UPDATE OF c`;

function openRow(ring: SecretsKeyring, row: ConnectionRow): ServerConnection {
  const connection: ServerConnection = {
    serverId: row.server_id,
    publicId: row.public_id,
    host: row.host,
    pinnedIp: row.pinned_ip,
    apiPort: row.api_port,
    frmPort: row.frm_port,
    apiToken: ring.open(row.key_id, row.api_token_enc, tokenContext(row.server_id, row.connection_kind, "api")),
  };
  if (row.frm_token_enc !== null) {
    connection.frmToken = ring.open(row.key_id, row.frm_token_enc, tokenContext(row.server_id, row.connection_kind, "frm"));
  }
  return connection;
}

/** Every live connection, opened where possible. A row that cannot be opened is reported (never
 *  silently skipped) so readiness can say so; the caller logs only its key id. */
export async function listConnections(db: Queryable, ring: SecretsKeyring | null): Promise<ConnectionList> {
  const result = await db.query(LIST_LIVE);
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

/** One server's connection with its tokens opened (for the poller and the test connection).
 *  Undefined when there is none. Throws SecretsError if the stored value cannot be opened. */
export async function getConnection(db: Queryable, ring: SecretsKeyring, serverId: string): Promise<ServerConnection | undefined> {
  const row = await selectRow(db, serverId, false);
  return row === undefined ? undefined : openRow(ring, row);
}

/** The write-only view for API responses: no token, only "set" and the last 4 characters. */
export async function getConnectionSummary(
  db: Queryable,
  ring: SecretsKeyring,
  serverId: string,
): Promise<ServerConnectionSummary | undefined> {
  const connection = await getConnection(db, ring, serverId);
  if (connection === undefined) return undefined;
  const { apiToken, frmToken, ...rest } = connection;
  return {
    ...rest,
    apiTokenSet: true,
    apiTokenLast4: last4(apiToken),
    frmTokenSet: frmToken !== undefined,
    frmTokenLast4: frmToken === undefined ? null : last4(frmToken),
  };
}

async function selectRow(db: Queryable, serverId: string, lock: boolean): Promise<ConnectionRow | undefined> {
  const result = await db.query(lock ? SELECT_ONE_FOR_UPDATE : SELECT_ONE, [serverId]);
  return parseFirst(ConnectionRowSchema, result.rows, "servers.selectConnection");
}

const UPSERT = `
  INSERT INTO servers.server_connections
    (server_id, host, pinned_ip, api_port, frm_port, api_token_enc, frm_token_enc, key_id)
  SELECT s.id, $2, $3::inet, $4, $5, $6, $7, $8
  FROM servers.servers s
  WHERE s.id = $1 AND s.deleted_at IS NULL AND s.connection_kind = 'local'
  ON CONFLICT (server_id) DO UPDATE SET
    host = EXCLUDED.host, pinned_ip = EXCLUDED.pinned_ip, api_port = EXCLUDED.api_port,
    frm_port = EXCLUDED.frm_port, api_token_enc = EXCLUDED.api_token_enc,
    frm_token_enc = EXCLUDED.frm_token_enc, key_id = EXCLUDED.key_id, updated_at = now()
  RETURNING server_id`;

/**
 * Creates or replaces a local server's connection, sealing both tokens with the ring's current key.
 * False when the server is unknown, deleted or not a 'local' server (nothing is written then).
 * The input is trusted to be validated already (the address guard and the schema are the callers').
 */
export async function saveConnection(
  db: Queryable,
  ring: SecretsKeyring,
  serverId: string,
  input: ConnectionInput,
): Promise<boolean> {
  // Only 'local' servers can take a connection row (the INSERT's WHERE enforces it), so the
  // context's kind is that constant here; reads use the row's own kind and would reject a mismatch.
  const api = ring.seal(input.apiToken, tokenContext(serverId, LOCAL_KIND, "api"));
  const frm = input.frmToken === undefined ? undefined : ring.seal(input.frmToken, tokenContext(serverId, LOCAL_KIND, "frm"));
  const result = await db.query(UPSERT, [
    serverId,
    input.host,
    input.pinnedIp,
    input.apiPort,
    input.frmPort,
    api.data,
    frm?.data ?? null,
    api.keyId,
  ]);
  return result.rows.length > 0;
}

const UPDATE = `
  UPDATE servers.server_connections
  SET host = $2, pinned_ip = $3::inet, api_port = $4, frm_port = $5,
      api_token_enc = $6, frm_token_enc = $7, key_id = $8, updated_at = now()
  WHERE server_id = $1
  RETURNING server_id`;

/**
 * An edit. Both tokens share one key id, so the row is locked, both are opened with the key that
 * sealed them and BOTH are sealed again with the current key: an edit of one token never leaves
 * the row with two keys. False when there is no connection to edit.
 */
export async function updateConnection(
  pool: Parameters<typeof withTransaction>[0],
  ring: SecretsKeyring,
  serverId: string,
  patch: ConnectionPatch,
): Promise<boolean> {
  return withTransaction(pool, async (client) => {
    const row = await selectRow(client, serverId, true);
    if (row === undefined) return false;
    // Open only what the patch does not replace: a row sealed by a retired key can still be repaired
    // by supplying its tokens afresh.
    const apiToken =
      patch.apiToken ?? ring.open(row.key_id, row.api_token_enc, tokenContext(row.server_id, row.connection_kind, "api"));
    let frmToken: string | undefined;
    if (patch.frmToken === undefined) {
      frmToken =
        row.frm_token_enc === null
          ? undefined
          : ring.open(row.key_id, row.frm_token_enc, tokenContext(row.server_id, row.connection_kind, "frm"));
    } else {
      frmToken = patch.frmToken ?? undefined;
    }
    const api = ring.seal(apiToken, tokenContext(row.server_id, row.connection_kind, "api"));
    const frm = frmToken === undefined ? undefined : ring.seal(frmToken, tokenContext(row.server_id, row.connection_kind, "frm"));
    await client.query(UPDATE, [
      serverId,
      patch.host ?? row.host,
      patch.pinnedIp ?? row.pinned_ip,
      patch.apiPort ?? row.api_port,
      patch.frmPort ?? row.frm_port,
      api.data,
      frm?.data ?? null,
      api.keyId,
    ]);
    return true;
  });
}

/** Removes the connection row, wiping the encrypted tokens. False when there was none. */
export async function deleteConnection(db: Queryable, serverId: string): Promise<boolean> {
  const result = await db.query("DELETE FROM servers.server_connections WHERE server_id = $1 RETURNING server_id", [serverId]);
  return result.rows.length > 0;
}
