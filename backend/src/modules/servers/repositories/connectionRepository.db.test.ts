import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../../test-support/testDb.js";
import type { TestDatabase } from "../../../../test-support/testDb.js";
import { createSecretsKeyring } from "../../../platform/secrets/secrets.js";
import type { SecretsKeyring } from "../../../platform/secrets/secrets.js";
import { listConnections } from "./connectionRepository.js";
import { softDeleteServer, upsertConfiguredServer } from "./serverRepository.js";

const available = dbTestsAvailable();

const API_TOKEN = "api-token-abcdefghij1234";
const FRM_TOKEN = "frm-token-klmnopqrst5678";

// Runs as satis_app against a real Postgres (the migration is applied by createTestDatabase).
// ADR-0066 build PR 6: the write paths are gone; what stays is the read behind `verify-secrets` (the restore drill), the
// table's constraints and the soft delete's wipe. Rows are stored here as the retired `saveConnection` stored them.
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
  /** Stores a 'local' server's connection the way the retired write path did (context `<id>:local:<field>`). */
  const store = async (ring: SecretsKeyring, serverId: string, pinnedIp = "192.168.1.20") => {
    const api = ring.seal(API_TOKEN, `${serverId}:local:api`);
    const frm = ring.seal(FRM_TOKEN, `${serverId}:local:frm`);
    await pool.query(
      `INSERT INTO servers.server_connections (server_id, host, pinned_ip, api_port, frm_port, api_token_enc, frm_token_enc, key_id)
       VALUES ($1, 'gaming-pc.lan', $2::inet, 7777, 8080, $3, $4, $5)`,
      [serverId, pinnedIp, api.data, frm.data, api.keyId],
    );
  };

  it("defaults a server to the 'local' kind", async () => {
    const server = await newServer();
    expect(server.connectionKind).toBe("local");
  });

  it("reads a stored connection back with both tokens opened; the table holds ciphertext only", async () => {
    const server = await newServer();
    await store(ringK1, server.id);
    const list = await listConnections(pool, ringK1);
    expect(list.connections.find((c) => c.serverId === server.id)).toMatchObject({
      publicId: server.publicId,
      host: "gaming-pc.lan",
      pinnedIp: "192.168.1.20",
      apiPort: 7777,
      frmPort: 8080,
      apiToken: API_TOKEN,
      frmToken: FRM_TOKEN,
    });
    const raw = await rawRow(server.id);
    expect(raw.key_id).toBe("k1");
    expect(Buffer.from(raw.api_token_enc).includes(Buffer.from(API_TOKEN))).toBe(false);
    expect(Buffer.from(raw.frm_token_enc).includes(Buffer.from(FRM_TOKEN))).toBe(false);
  });

  it("reads an IPv6 pinned address back as text", async () => {
    const server = await newServer();
    await store(ringK1, server.id, "::1");
    expect((await listConnections(pool, ringK1)).connections.find((c) => c.serverId === server.id)?.pinnedIp).toBe("::1");
  });

  it("soft-deleting a server wipes its encrypted tokens, and the list never shows it", async () => {
    const server = await newServer();
    await store(ringK1, server.id);
    expect(await softDeleteServer(pool, server.publicId)).toBe(true);
    expect(await rawRow(server.id)).toBeUndefined();
    expect((await listConnections(pool, ringK1)).connections.map((c) => c.serverId)).not.toContain(server.id);
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
    await store(ringK2, readable.id);
    await store(ringK1, stranded.id);
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
