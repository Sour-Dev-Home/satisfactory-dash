import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";
import { createUser } from "../identity/repositories/userRepository.js";
import { registerConfiguredServers } from "./registerConfiguredServers.js";
import { getMemberRole, transferOwnership } from "./repositories/memberRepository.js";
import { listServersForUser, softDeleteServer } from "./repositories/serverRepository.js";

// Runs as satis_app against a real Postgres (Docker is needed, so this runs in CI).
const available = dbTestsAvailable();

describe.skipIf(!available)("registering the configured servers at startup", () => {
  let db: TestDatabase;
  let pool: pg.Pool;

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 4 });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  const servers = [
    { id: "home", displayName: "Home base" },
    { id: "second", displayName: "Second" },
  ];

  it("creates each server and makes the bootstrap user its owner; a restart changes nothing", async () => {
    const operator = await createUser(pool, { displayName: "operator" });
    expect(await registerConfiguredServers(pool, servers, operator.id)).toEqual({ registered: 2 });
    expect(await getMemberRole(pool, { publicId: "home", userId: operator.id })).toBe("owner");
    await registerConfiguredServers(pool, servers, operator.id);
    expect((await listServersForUser(pool, operator.id)).map((s) => [s.publicId, s.role])).toEqual([
      ["home", "owner"],
      ["second", "owner"],
    ]);
  });

  it("never re-adds the operator as a second owner after ownership moved to someone else", async () => {
    const [operator, other] = await Promise.all([createUser(pool, { displayName: "op2" }), createUser(pool, { displayName: "other" })]);
    await registerConfiguredServers(pool, [{ id: "moved", displayName: "Moved" }], operator.id);
    const { rows } = await pool.query("SELECT id FROM servers.servers WHERE public_id = 'moved'");
    await pool.query("INSERT INTO servers.server_members (server_id, user_id, role) VALUES ($1, $2, 'viewer')", [rows[0].id, other.id]);
    expect(await transferOwnership(pool, { serverId: rows[0].id, fromUserId: operator.id, toUserId: other.id })).toBe("transferred");
    await registerConfiguredServers(pool, [{ id: "moved", displayName: "Moved" }], operator.id); // a restart
    expect(await getMemberRole(pool, { publicId: "moved", userId: other.id })).toBe("owner");
    expect(await getMemberRole(pool, { publicId: "moved", userId: operator.id })).toBe("admin");
  });

  it("a server that was deleted and is named in config again is registered afresh, owned by the bootstrap user", async () => {
    const operator = await createUser(pool, { displayName: "op3" });
    await registerConfiguredServers(pool, [{ id: "revived", displayName: "Revived" }], operator.id);
    await softDeleteServer(pool, "revived");
    expect(await getMemberRole(pool, { publicId: "revived", userId: operator.id })).toBeUndefined();
    await registerConfiguredServers(pool, [{ id: "revived", displayName: "Revived" }], operator.id);
    expect(await getMemberRole(pool, { publicId: "revived", userId: operator.id })).toBe("owner");
  });
});
