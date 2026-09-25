import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../../test-support/testDb.js";
import type { TestDatabase } from "../../../../test-support/testDb.js";
import { createSecretsKeyring } from "../../../platform/secrets/secrets.js";
import { deleteConnection, getConnection, getConnectionSummary, listConnections, saveConnection, updateConnection } from "./connectionRepository.js";
import { softDeleteServer, upsertConfiguredServer } from "./serverRepository.js";

const available = dbTestsAvailable();

const API_TOKEN = "api-token-abcdefghij1234";
const FRM_TOKEN = "frm-token-klmnopqrst5678";
const input = { host: "gaming-pc.lan", pinnedIp: "192.168.1.20", apiPort: 7777, frmPort: 8080, apiToken: API_TOKEN, frmToken: FRM_TOKEN };

// Runs as satis_app against a real Postgres (the migration is applied by createTestDatabase).
describe.skipIf(!available)("server connections against a real Postgres", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let admin: pg.Pool;
  const oldKey = randomBytes(32);
  const ringK1 = createSecretsKeyring("k1", new Map([["k1", oldKey]]));
  const newKey = randomBytes(32);
  const ringK2 = createSecretsKeyring("k2", new Map([["k2", newKey], ["k1", oldKey]]));
  // The rotated ring after k1 is retired: it can open only what k2 sealed.
  const onlyK2 = createSecretsKeyring("k2", new Map([["k2", newKey]]));
  let counter = 0;

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 6 });
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.end();
    await db?.drop();
  });

  const newServer = async () => upsertConfiguredServer(pool, { publicId: `conn-${++counter}`, displayName: "Conn" });
  const rawRow = async (serverId: string) =>
    (await admin.query("SELECT * FROM servers.server_connections WHERE server_id = $1", [serverId])).rows[0];

  it("defaults a server to the 'local' kind", async () => {
    const server = await newServer();
    expect(server.connectionKind).toBe("local");
  });

  it("saves, reads back and summarises a connection; the table holds ciphertext only", async () => {
    const server = await newServer();
    expect(await saveConnection(pool, ringK1, server.id, input)).toBe(true);
    expect(await getConnection(pool, ringK1, server.id)).toMatchObject({ ...input, publicId: server.publicId, serverId: server.id });
    expect(await getConnectionSummary(pool, ringK1, server.id)).toMatchObject({ apiTokenSet: true, apiTokenLast4: "1234", frmTokenSet: true, frmTokenLast4: "5678" });
    const raw = await rawRow(server.id);
    expect(raw.key_id).toBe("k1");
    expect(Buffer.from(raw.api_token_enc).includes(Buffer.from(API_TOKEN))).toBe(false);
    expect(Buffer.from(raw.frm_token_enc).includes(Buffer.from(FRM_TOKEN))).toBe(false);
  });

  it("saving again replaces the row (one connection per server)", async () => {
    const server = await newServer();
    await saveConnection(pool, ringK1, server.id, input);
    await saveConnection(pool, ringK1, server.id, { ...input, host: "other.lan", frmToken: undefined });
    const connection = await getConnection(pool, ringK1, server.id);
    expect(connection?.host).toBe("other.lan");
    expect(connection?.frmToken).toBeUndefined();
    expect((await admin.query("SELECT 1 FROM servers.server_connections WHERE server_id = $1", [server.id])).rowCount).toBe(1);
  });

  it("stores an IPv6 pinned address and reads it back as text", async () => {
    const server = await newServer();
    await saveConnection(pool, ringK1, server.id, { ...input, pinnedIp: "::1" });
    expect((await getConnection(pool, ringK1, server.id))?.pinnedIp).toBe("::1");
  });

  it("refuses to save for an unknown, deleted or agent-kind server, writing nothing", async () => {
    expect(await saveConnection(pool, ringK1, "00000000-0000-4000-8000-000000000000", input)).toBe(false);
    const agent = await newServer();
    await admin.query("UPDATE servers.servers SET connection_kind = 'agent' WHERE id = $1", [agent.id]);
    expect(await saveConnection(pool, ringK1, agent.id, input)).toBe(false);
    const gone = await newServer();
    await softDeleteServer(pool, gone.publicId);
    expect(await saveConnection(pool, ringK1, gone.id, input)).toBe(false);
    for (const id of [agent.id, gone.id]) expect(await rawRow(id)).toBeUndefined();
  });

  it("an edit re-seals BOTH tokens with the current key, so a row never mixes keys", async () => {
    const server = await newServer();
    await saveConnection(pool, ringK1, server.id, input);
    expect(await updateConnection(pool, ringK2, server.id, { apiToken: "new-api-token-zzzz9999" })).toBe(true);
    const raw = await rawRow(server.id);
    expect(raw.key_id).toBe("k2");
    // The FRM token was not in the patch, yet with k1 retired the whole row still opens.
    const connection = await getConnection(pool, onlyK2, server.id);
    expect(connection).toMatchObject({ apiToken: "new-api-token-zzzz9999", frmToken: FRM_TOKEN, host: "gaming-pc.lan" });
    await expect(getConnection(pool, ringK1, server.id)).rejects.toThrow("Could not decrypt");
  });

  it("an edit changes only the fields given, and null clears the FRM token", async () => {
    const server = await newServer();
    await saveConnection(pool, ringK1, server.id, input);
    await updateConnection(pool, ringK1, server.id, { apiPort: 7778, frmToken: null });
    expect(await getConnection(pool, ringK1, server.id)).toMatchObject({ apiPort: 7778, frmPort: 8080, host: "gaming-pc.lan", apiToken: API_TOKEN, frmToken: undefined });
    expect((await rawRow(server.id)).frm_token_enc).toBeNull();
  });

  it("an edit reports false when there is no connection or the server is deleted", async () => {
    const server = await newServer();
    expect(await updateConnection(pool, ringK1, server.id, { apiPort: 1 })).toBe(false);
    await saveConnection(pool, ringK1, server.id, input);
    await softDeleteServer(pool, server.publicId);
    expect(await updateConnection(pool, ringK1, server.id, { apiPort: 1 })).toBe(false);
  });

  it("concurrent edits both apply and leave one consistent key", async () => {
    const server = await newServer();
    await saveConnection(pool, ringK1, server.id, input);
    await Promise.all([
      updateConnection(pool, ringK2, server.id, { apiPort: 7001 }),
      updateConnection(pool, ringK2, server.id, { frmPort: 8001 }),
    ]);
    expect(await getConnection(pool, ringK2, server.id)).toMatchObject({ apiPort: 7001, frmPort: 8001, apiToken: API_TOKEN, frmToken: FRM_TOKEN });
  });

  it("deleting a connection, or soft-deleting its server, wipes the encrypted tokens", async () => {
    const one = await newServer();
    await saveConnection(pool, ringK1, one.id, input);
    expect(await deleteConnection(pool, one.id)).toBe(true);
    expect(await deleteConnection(pool, one.id)).toBe(false);
    expect(await rawRow(one.id)).toBeUndefined();

    const two = await newServer();
    await saveConnection(pool, ringK1, two.id, input);
    expect(await softDeleteServer(pool, two.publicId)).toBe(true);
    expect(await rawRow(two.id)).toBeUndefined();
  });

  it("the table's constraints refuse bad ports, a network as the pinned address and a bad key id", async () => {
    const server = await newServer();
    const insert = (over: Record<string, unknown>) => {
      const v = { host: "h", ip: "10.0.0.5", api: 7777, frm: 8080, key: "k1", ...over };
      return pool.query(
        `INSERT INTO servers.server_connections (server_id, host, pinned_ip, api_port, frm_port, api_token_enc, key_id)
         VALUES ($1, $2, $3::inet, $4, $5, $6, $7)`,
        [server.id, v.host, v.ip, v.api, v.frm, Buffer.alloc(40, 1), v.key],
      );
    };
    await expect(insert({ api: 0 })).rejects.toMatchObject({ code: "23514" });
    await expect(insert({ frm: 65536 })).rejects.toMatchObject({ code: "23514" });
    await expect(insert({ ip: "10.0.0.0/24" })).rejects.toMatchObject({ code: "23514" });
    await expect(insert({ key: "bad key!" })).rejects.toMatchObject({ code: "23514" });
    await expect(insert({ host: "" })).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query(
      `INSERT INTO servers.server_connections (server_id, host, pinned_ip, api_port, frm_port, api_token_enc, key_id)
       VALUES ($1, 'h', '10.0.0.5', 1, 2, $2, 'k1')`,
      [server.id, Buffer.alloc(5)],
    )).rejects.toMatchObject({ code: "23514" });
    expect(await rawRow(server.id)).toBeUndefined();
  });

  it("listConnections opens what it can and reports rows the ring cannot open", async () => {
    const readable = await newServer();
    const stranded = await newServer();
    await saveConnection(pool, ringK2, readable.id, input);
    await saveConnection(pool, ringK1, stranded.id, input);
    const withoutRing = await listConnections(pool, null);
    expect(withoutRing.connections).toEqual([]);
    expect(withoutRing.unreadable.map((u) => u.serverId)).toEqual(expect.arrayContaining([readable.id, stranded.id]));
    const full = await listConnections(pool, ringK2);
    expect(full.connections.map((c) => c.serverId)).toEqual(expect.arrayContaining([readable.id, stranded.id]));
    expect(full.unreadable).toEqual([]);
    // With k1 retired, the k1 row is reported (by key id), the k2 row still opens.
    const partial = await listConnections(pool, onlyK2);
    expect(partial.connections.map((c) => c.serverId)).toContain(readable.id);
    expect(partial.unreadable.find((u) => u.serverId === stranded.id)).toMatchObject({ keyId: "k1" });
    expect(partial.unreadable.map((u) => u.serverId)).not.toContain(readable.id);
  });
});
