import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";
import { createSecretsKeyring } from "../../platform/secrets/secrets.js";
import { createUser } from "../identity/repositories/userRepository.js";
import { ImportError, MAX_LOCAL_SERVERS, importServers } from "./importServers.js";
import type { ImportableServer } from "./importServers.js";
import { loadDatabaseServers } from "./loadDatabaseServers.js";
import { getConnection } from "./repositories/connectionRepository.js";
import { getMemberRole } from "./repositories/memberRepository.js";
import { findServerByPublicId } from "./repositories/serverRepository.js";
import { ServerRuntime } from "./serverRuntime.js";

const available = dbTestsAvailable();
// These tests store LAN addresses (the flows are what matters), so they run with LAN allowed; the amendment-1 default
// (loopback only) is covered by the unit tests.
const LAN_OK = { allowLan: true };
const ring = createSecretsKeyring("k1", new Map([["k1", randomBytes(32)]]));

const configured = (id: string, over: Partial<ImportableServer["config"]> = {}): ImportableServer => ({
  id,
  displayName: `Name ${id}`,
  config: {
    host: "192.168.1.20",
    apiPort: 7777,
    apiToken: `api-token-for-${id}-12345`,
    apiAllowSelfSignedCert: true,
    frmPort: 8080,
    frmToken: "frm-token-12345678",
    requestTimeoutMs: 5000,
    ...over,
  },
});
const resolve = async (host: string) => host;

// Runs as satis_app against a real Postgres.
describe.skipIf(!available)("import-servers and database precedence against a real Postgres", () => {
  let db: TestDatabase;
  let pool: pg.Pool;

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 6 });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("imports, encrypted, and a second run changes nothing (the database wins, names are kept)", async () => {
    const result = await importServers(pool, ring, [configured("imp-a"), configured("imp-b")], resolve, LAN_OK);
    expect(result.imported).toEqual(["imp-a", "imp-b"]);
    const row = await findServerByPublicId(pool, "imp-a");
    expect(await getConnection(pool, ring, row!.id)).toMatchObject({ host: "192.168.1.20", apiPort: 7777, apiToken: "api-token-for-imp-a-12345" });

    await pool.query("UPDATE servers.servers SET display_name = 'Renamed in the app' WHERE public_id = 'imp-a'");
    const again = await importServers(pool, ring, [configured("imp-a", { apiPort: 9999 }), configured("imp-b")], resolve, LAN_OK);
    expect(again).toMatchObject({ imported: [], skipped: ["imp-a", "imp-b"] });
    expect((await findServerByPublicId(pool, "imp-a"))?.displayName).toBe("Renamed in the app");
    expect((await getConnection(pool, ring, row!.id))?.apiPort).toBe(7777);
  });

  it("rolls the whole import back when one server is refused", async () => {
    await expect(
      importServers(pool, ring, [configured("rb-a"), configured("rb-b", { apiToken: "" })], resolve, LAN_OK),
    ).rejects.toThrow(ImportError);
    expect(await findServerByPublicId(pool, "rb-a")).toBeUndefined();
  });

  it("refuses to go over the cap, leaving nothing behind", async () => {
    const existing = (await pool.query("SELECT count(*)::int AS n FROM servers.server_connections")).rows[0].n as number;
    const many = Array.from({ length: MAX_LOCAL_SERVERS - existing + 1 }, (_, i) => configured(`cap-${i}`));
    await expect(importServers(pool, ring, many, resolve, LAN_OK)).rejects.toThrow(/limit of 8/);
    expect(await findServerByPublicId(pool, "cap-0")).toBeUndefined();
  });

  it("loadDatabaseServers serves the stored servers, replaces the config ones and seeds the operator as owner", async () => {
    const operator = await createUser(pool, { displayName: "operator" });
    const runtime = new ServerRuntime<string>([
      { id: "from-config", displayName: "Config", services: "config", workers: [] },
    ]);
    const result = await loadDatabaseServers({
      db: pool,
      ring,
      runtime,
      operatorUserId: operator.id, policy: LAN_OK,
      build: (c) => ({ id: c.publicId, displayName: c.displayName, services: c.apiToken, workers: [] }),
    });
    expect(result.usingDatabase).toBe(true);
    expect(result.unreadable).toEqual([]);
    expect(runtime.has("from-config")).toBe(false);
    expect(runtime.has("imp-a")).toBe(true);
    expect(runtime.get("imp-a")).toBe("api-token-for-imp-a-12345");
    expect(await getMemberRole(pool, { publicId: "imp-a", userId: operator.id })).toBe("owner");
    // A second load is idempotent.
    await expect(
      loadDatabaseServers({ db: pool, ring, runtime, operatorUserId: operator.id, policy: LAN_OK, build: (c) => ({ id: c.publicId, displayName: c.displayName, services: c.apiToken, workers: [] }) }),
    ).resolves.toMatchObject({ usingDatabase: true });
  });

  it("with no keyring the stored rows are reported unreadable, not skipped", async () => {
    const operator = await createUser(pool, { displayName: "operator-2" });
    const result = await loadDatabaseServers({
      db: pool,
      ring: null,
      runtime: new ServerRuntime<string>(),
      operatorUserId: operator.id, policy: LAN_OK,
      build: () => {
        throw new Error("nothing should be built");
      },
    });
    expect(result.usingDatabase).toBe(true);
    expect(result.loaded).toEqual([]);
    expect(result.unreadable.map((u) => u.publicId)).toEqual(expect.arrayContaining(["imp-a", "imp-b"]));
  });
});
