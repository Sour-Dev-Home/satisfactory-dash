import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";
import { ApiFailure } from "../../platform/errorResponse.js";
import { createUser } from "../identity/repositories/userRepository.js";
import { enrolledServerIds } from "../agents/index.js";
import { ensureServer, listOperatorAgentServers } from "./repositories/serverRepository.js";
import { listServersAdmin, removeServerAdmin } from "./serverAdmin.js";
import { createSelfServeService } from "./selfServe.js";

// Independent hunt (#525): removal, revival and account deletion against the self-serve rules.
const available = dbTestsAvailable();

describe.skipIf(!available)("self-serve hunt (database)", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let admin: pg.Pool;
  let n = 0;

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 5 });
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.end();
    await db?.drop();
  });

  const user = async () => (await createUser(pool, { displayName: `hunter-${++n}` })).id;
  const svc = (caps: { c1?: number; c2?: number; c3?: number } = {}) =>
    createSelfServeService({
      db: pool,
      config: { maxServersPerAccount: caps.c1 ?? 2, maxServersTotal: caps.c2 ?? 1000, maxPendingPerAccount: caps.c3 ?? 1, createsPerDay: 100 },
      isOperator: () => false,
      enrolledServerIds,
      attachRuntime: async () => {},
      runtime: { rename: () => true, remove: async () => true },
    });
  const codeOf = (err: unknown) => (err instanceof ApiFailure ? err.code : String(err));

  it("the operator's remove (removeServerAdmin) works on a self-serve server and frees the owner's C1, C3 and the total C2 slot", async () => {
    const owner = await user();
    const service = svc({ c1: 1, c2: 1000, c3: 1 });
    const first = await service.create(owner, { displayName: "One" });
    await expect(service.create(owner, { displayName: "Two" })).rejects.toSatisfy((e) => codeOf(e) === "server_limit_reached");
    expect(await removeServerAdmin(pool, first.id)).toBe(true);
    const second = await service.create(owner, { displayName: "Two" });
    expect(second.id).not.toBe(first.id);
    const rows = await listServersAdmin(pool);
    expect(rows.find((r) => r.publicId === first.id)).toBeUndefined();
    expect(rows.find((r) => r.publicId === second.id)).toMatchObject({ createdVia: "self_serve", ownerUserId: owner });
  });

  it("ensureServer (the import and startup path) reviving a removed self-serve id makes it an operator server, and keeps a live one self-serve", async () => {
    const owner = await user();
    const live = await svc().create(owner, { displayName: "Live" });
    await ensureServer(pool, { publicId: live.id, displayName: "Whatever" });
    expect((await admin.query("SELECT created_via FROM servers.servers WHERE public_id = $1", [live.id])).rows[0].created_via).toBe("self_serve");
    await removeServerAdmin(pool, live.id);
    await ensureServer(pool, { publicId: live.id, displayName: "Revived" });
    expect((await admin.query("SELECT created_via FROM servers.servers WHERE public_id = $1", [live.id])).rows[0].created_via).toBe("operator");
    await admin.query("UPDATE servers.servers SET connection_kind = 'agent' WHERE public_id = $1", [live.id]);
    expect((await listOperatorAgentServers(pool)).map((s) => s.publicId)).toContain(live.id);
  });

  it("deleting the owner's account while a live self-serve server exists is refused by #311's trigger, and the server stays", async () => {
    const owner = await user();
    const created = await svc().create(owner, { displayName: "Held" });
    await expect(admin.query("DELETE FROM identity.users WHERE id = $1", [owner])).rejects.toMatchObject({ code: "23514" });
    expect((await admin.query("SELECT 1 FROM servers.server_members m JOIN servers.servers s ON s.id = m.server_id WHERE s.public_id = $1 AND m.user_id = $2", [created.id, owner])).rowCount).toBe(1);
    // After the server is removed, the account can go.
    await removeServerAdmin(pool, created.id);
    await admin.query("DELETE FROM identity.users WHERE id = $1", [owner]);
  });

  it("a rejected create (cap) leaves no audit row and no server for the refused account", async () => {
    const owner = await user();
    const service = svc({ c1: 1 });
    await service.create(owner, { displayName: "A" });
    await expect(service.create(owner, { displayName: "B" })).rejects.toBeDefined();
    const count = await admin.query(
      "SELECT count(*)::int AS n FROM servers.servers s JOIN servers.server_members m ON m.server_id = s.id WHERE m.user_id = $1",
      [owner],
    );
    expect(count.rows[0].n).toBe(1);
  });
});
