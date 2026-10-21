import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";
import { createUser } from "../identity/repositories/userRepository.js";
import { addMember, getMemberRole, leaveServer } from "./repositories/memberRepository.js";
import { softDeleteServer, upsertConfiguredServer } from "./repositories/serverRepository.js";

// ADR-0047 decision 4 against a real Postgres, as satis_app: one statement removes the caller's own non-owner membership
// and their push opt-in for that server, with `member_left`.
const available = dbTestsAvailable();

describe.skipIf(!available)("leaving a server (database)", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let admin: pg.Pool;
  let n = 0;

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 4 });
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.end();
    await db?.drop();
  });

  const rows = async (sql: string, params: unknown[]) => (await admin.query(sql, params)).rows;
  const user = async () => (await createUser(pool, { displayName: `member-${++n}` })).id;
  const server = async () => {
    const owner = await user();
    const s = await upsertConfiguredServer(pool, { publicId: `lv-${++n}`, displayName: "Shared" });
    await addMember(pool, { serverId: s.id, userId: owner, role: "owner", actorUserId: null });
    return { ...s, owner };
  };
  const optIn = (serverId: string, userId: string) => admin.query("INSERT INTO alerts.push_optins (server_id, user_id) VALUES ($1, $2)", [serverId, userId]);

  it("a viewer or admin leaves: the membership and their opt-in go, audited; nobody else's", async () => {
    const s = await server();
    const [viewer, adminUser] = [await user(), await user()];
    await addMember(pool, { serverId: s.id, userId: viewer, role: "viewer", actorUserId: s.owner });
    await addMember(pool, { serverId: s.id, userId: adminUser, role: "admin", actorUserId: s.owner });
    await optIn(s.id, viewer);
    await optIn(s.id, s.owner);
    // An opt-in on ANOTHER server stays.
    const elsewhere = await server();
    await addMember(pool, { serverId: elsewhere.id, userId: viewer, role: "viewer", actorUserId: elsewhere.owner });
    await optIn(elsewhere.id, viewer);

    await expect(leaveServer(pool, { publicId: s.publicId, userId: viewer })).resolves.toBe("left");
    await expect(leaveServer(pool, { publicId: s.publicId, userId: adminUser })).resolves.toBe("left");
    expect(await getMemberRole(pool, { publicId: s.publicId, userId: viewer })).toBeUndefined();
    expect(await rows("SELECT user_id::text FROM servers.server_members WHERE server_id = $1", [s.id])).toEqual([{ user_id: s.owner }]);
    expect(await rows("SELECT user_id::text FROM alerts.push_optins WHERE server_id = $1", [s.id])).toEqual([{ user_id: s.owner }]);
    expect(await rows("SELECT 1 FROM alerts.push_optins WHERE server_id = $1 AND user_id = $2", [elsewhere.id, viewer])).toHaveLength(1);
    expect(await rows("SELECT actor_user_id::text AS actor, detail FROM audit.audit_events WHERE action = 'member_left' AND server_id = $1 ORDER BY id", [s.id])).toEqual([
      { actor: viewer, detail: { userId: viewer, role: "viewer" } },
      { actor: adminUser, detail: { userId: adminUser, role: "admin" } },
    ]);
    // Leaving twice: no longer a member.
    await expect(leaveServer(pool, { publicId: s.publicId, userId: viewer })).resolves.toBe("not_member");
  });

  it("the owner is the last owner: refused, and nothing changes (no audit row)", async () => {
    const s = await server();
    await optIn(s.id, s.owner);
    await expect(leaveServer(pool, { publicId: s.publicId, userId: s.owner })).resolves.toBe("last_owner");
    expect(await getMemberRole(pool, { publicId: s.publicId, userId: s.owner })).toBe("owner");
    expect(await rows("SELECT 1 FROM alerts.push_optins WHERE server_id = $1", [s.id])).toHaveLength(1);
    expect(await rows("SELECT 1 FROM audit.audit_events WHERE action = 'member_left' AND server_id = $1", [s.id])).toEqual([]);
  });

  it("a non-member, an unknown id and a removed server are all not_member", async () => {
    const s = await server();
    const stranger = await user();
    await expect(leaveServer(pool, { publicId: s.publicId, userId: stranger })).resolves.toBe("not_member");
    await expect(leaveServer(pool, { publicId: "no-such-server", userId: stranger })).resolves.toBe("not_member");
    await softDeleteServer(pool, s.publicId);
    await expect(leaveServer(pool, { publicId: s.publicId, userId: s.owner })).resolves.toBe("not_member");
  });
});
