import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../../test-support/testDb.js";
import type { TestDatabase } from "../../../../test-support/testDb.js";
import { createUser } from "../../identity/repositories/userRepository.js";
import {
  findServerByPublicId,
  listServersForUser,
  softDeleteServer,
  upsertConfiguredServer,
} from "./serverRepository.js";
import {
  addMember as addMemberAudited,
  getMemberRole,
  removeMember as removeMemberAudited,
  setMemberRole as setMemberRoleAudited,
  transferOwnership,
} from "./memberRepository.js";

// The repository requires an explicit actor (null = the system). Most tests here don't care who
// acted, so these default it; the audit tests below pass one explicitly.
type WithOptionalActor<F extends (db: never, input: never) => unknown> = (
  db: Parameters<F>[0],
  input: Omit<Parameters<F>[1], "actorUserId"> & { actorUserId?: string | null },
) => ReturnType<F>;
const addMember: WithOptionalActor<typeof addMemberAudited> = (db, input) => addMemberAudited(db, { actorUserId: null, ...input });
const setMemberRole: WithOptionalActor<typeof setMemberRoleAudited> = (db, input) =>
  setMemberRoleAudited(db, { actorUserId: null, ...input });
const removeMember: WithOptionalActor<typeof removeMemberAudited> = (db, input) =>
  removeMemberAudited(db, { actorUserId: null, ...input });

// Runs as satis_app against a real Postgres. (The identity repository is used only to make users.)
const available = dbTestsAvailable();

describe.skipIf(!available)("server repositories against a real Postgres", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let admin: pg.Pool;

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

  const users = async (n: number) => Promise.all(Array.from({ length: n }, (_, i) => createUser(pool, { displayName: `user-${i}` })));

  describe("the registry", () => {
    it("registers a configured server, and re-registering is idempotent and refreshes the name", async () => {
      const first = await upsertConfiguredServer(pool, { publicId: "reg-1", displayName: "First name" });
      expect(first).toMatchObject({ publicId: "reg-1", displayName: "First name", hostingMode: "self" });
      const again = await upsertConfiguredServer(pool, { publicId: "reg-1", displayName: "Renamed" });
      expect(again.id).toBe(first.id);
      expect(again.displayName).toBe("Renamed");
      expect(await findServerByPublicId(pool, "reg-1")).toEqual(again);
    });

    it("refuses an id the shared ServerIdSchema would refuse (the table's CHECK)", async () => {
      await expect(upsertConfiguredServer(pool, { publicId: "Bad Id", displayName: "x" })).rejects.toMatchObject({ code: "23514" });
    });

    it("soft delete removes every membership, so re-registering the id never revives old access", async () => {
      const [owner, member] = await users(2);
      const server = await upsertConfiguredServer(pool, { publicId: "revive-1", displayName: "Revive" });
      await addMember(pool, { serverId: server.id, userId: owner.id, role: "owner" });
      await addMember(pool, { serverId: server.id, userId: member.id, role: "admin" });
      expect(await softDeleteServer(pool, "revive-1")).toBe(true);
      expect((await admin.query("SELECT 1 FROM servers.server_members WHERE server_id = $1", [server.id])).rows).toEqual([]);
      const again = await upsertConfiguredServer(pool, { publicId: "revive-1", displayName: "Revive" });
      expect(again.id).toBe(server.id);
      expect(await getMemberRole(pool, { publicId: "revive-1", userId: owner.id })).toBeUndefined();
      expect(await getMemberRole(pool, { publicId: "revive-1", userId: member.id })).toBeUndefined();
      expect((await listServersForUser(pool, owner.id)).map((s) => s.publicId)).not.toContain("revive-1");
      // A startup upsert that meets a soft-deleted configured id undeletes it with ONLY the
      // bootstrap owner: the old owner's seat is free, so the new owner can be added.
      const [bootstrap] = await users(1);
      expect(await addMember(pool, { serverId: again.id, userId: bootstrap.id, role: "owner" })).toBe("added");
      expect(await getMemberRole(pool, { publicId: "revive-1", userId: bootstrap.id })).toBe("owner");
      expect(await getMemberRole(pool, { publicId: "revive-1", userId: owner.id })).toBeUndefined();
    });

    it("an unknown or soft-deleted server is not found, and re-registering brings it back", async () => {
      expect(await findServerByPublicId(pool, "nope")).toBeUndefined();
      const server = await upsertConfiguredServer(pool, { publicId: "soft-1", displayName: "Soft" });
      expect(await softDeleteServer(pool, "soft-1")).toBe(true);
      expect(await softDeleteServer(pool, "soft-1")).toBe(false);
      expect(await findServerByPublicId(pool, "soft-1")).toBeUndefined();
      expect((await upsertConfiguredServer(pool, { publicId: "soft-1", displayName: "Soft" })).id).toBe(server.id);
      expect(await findServerByPublicId(pool, "soft-1")).toBeDefined();
    });
  });

  describe("membership and authorization lookups", () => {
    it("a member has their role; a non-member, an unknown server and a deleted server all look the same (undefined)", async () => {
      const [owner, stranger] = await users(2);
      const server = await upsertConfiguredServer(pool, { publicId: "auth-1", displayName: "A" });
      expect(await addMember(pool, { serverId: server.id, userId: owner.id, role: "owner" })).toBe("added");
      expect(await getMemberRole(pool, { publicId: "auth-1", userId: owner.id })).toBe("owner");
      expect(await getMemberRole(pool, { publicId: "auth-1", userId: stranger.id })).toBeUndefined();
      expect(await getMemberRole(pool, { publicId: "no-such", userId: owner.id })).toBeUndefined();
      await softDeleteServer(pool, "auth-1");
      expect(await getMemberRole(pool, { publicId: "auth-1", userId: owner.id })).toBeUndefined();
    });

    it("IDOR: user B cannot see or list user A's server, whatever public id they ask for", async () => {
      const [a, b] = await users(2);
      const sa = await upsertConfiguredServer(pool, { publicId: "idor-a", displayName: "A's" });
      const sb = await upsertConfiguredServer(pool, { publicId: "idor-b", displayName: "B's" });
      await addMember(pool, { serverId: sa.id, userId: a.id, role: "owner" });
      await addMember(pool, { serverId: sb.id, userId: b.id, role: "owner" });
      expect(await getMemberRole(pool, { publicId: "idor-a", userId: b.id })).toBeUndefined();
      expect(await getMemberRole(pool, { publicId: "idor-b", userId: a.id })).toBeUndefined();
      expect((await listServersForUser(pool, a.id)).map((s) => s.publicId)).toEqual(["idor-a"]);
      expect((await listServersForUser(pool, b.id)).map((s) => s.publicId)).toEqual(["idor-b"]);
    });

    it("lists a user's servers with their role, ordered by name, without deleted ones", async () => {
      const [u] = await users(1);
      const zed = await upsertConfiguredServer(pool, { publicId: "list-z", displayName: "Zed" });
      const amy = await upsertConfiguredServer(pool, { publicId: "list-a", displayName: "Amy" });
      const gone = await upsertConfiguredServer(pool, { publicId: "list-g", displayName: "Gone" });
      await addMember(pool, { serverId: zed.id, userId: u.id, role: "viewer" });
      await addMember(pool, { serverId: amy.id, userId: u.id, role: "admin" });
      await addMember(pool, { serverId: gone.id, userId: u.id, role: "owner" });
      await softDeleteServer(pool, "list-g");
      expect(await listServersForUser(pool, u.id)).toEqual([
        { publicId: "list-a", displayName: "Amy", role: "admin" },
        { publicId: "list-z", displayName: "Zed", role: "viewer" },
      ]);
      expect(await listServersForUser(pool, "00000000-0000-4000-8000-000000000000")).toEqual([]);
    });
  });

  describe("adding, changing and removing members", () => {
    it("reports why an add was refused, from the database's own constraints", async () => {
      const [owner, second, member] = await users(3);
      const server = await upsertConfiguredServer(pool, { publicId: "add-1", displayName: "Add" });
      expect(await addMember(pool, { serverId: server.id, userId: owner.id, role: "owner" })).toBe("added");
      expect(await addMember(pool, { serverId: server.id, userId: second.id, role: "owner" })).toBe("owner_exists");
      expect(await addMember(pool, { serverId: server.id, userId: member.id, role: "viewer" })).toBe("added");
      expect(await addMember(pool, { serverId: server.id, userId: member.id, role: "admin" })).toBe("already_member");
      expect(await addMember(pool, { serverId: server.id, userId: "00000000-0000-4000-8000-000000000000", role: "viewer" })).toBe("unknown_server_or_user");
      expect(await addMember(pool, { serverId: "00000000-0000-4000-8000-000000000000", userId: member.id, role: "viewer" })).toBe("unknown_server_or_user");
    });

    it("racing owner inserts: exactly one owner results", async () => {
      const racers = await users(6);
      const server = await upsertConfiguredServer(pool, { publicId: "race-1", displayName: "Race" });
      const results = await Promise.all(racers.map((u) => addMember(pool, { serverId: server.id, userId: u.id, role: "owner" })));
      expect(results.filter((r) => r === "added")).toHaveLength(1);
      expect(results.filter((r) => r === "owner_exists")).toHaveLength(5);
      expect((await admin.query("SELECT count(*)::int AS n FROM servers.server_members WHERE server_id = $1 AND role = 'owner'", [server.id])).rows[0].n).toBe(1);
    });

    it("changes an admin or viewer's role, but never the owner's", async () => {
      const [owner, member] = await users(2);
      const server = await upsertConfiguredServer(pool, { publicId: "role-1", displayName: "Role" });
      await addMember(pool, { serverId: server.id, userId: owner.id, role: "owner" });
      await addMember(pool, { serverId: server.id, userId: member.id, role: "viewer" });
      expect(await setMemberRole(pool, { serverId: server.id, userId: member.id, role: "admin" })).toBe("changed");
      expect(await getMemberRole(pool, { publicId: "role-1", userId: member.id })).toBe("admin");
      expect(await setMemberRole(pool, { serverId: server.id, userId: member.id, role: "admin" })).toBe("unchanged");
      expect(await setMemberRole(pool, { serverId: server.id, userId: owner.id, role: "viewer" })).toBe("not_found");
      expect(await getMemberRole(pool, { publicId: "role-1", userId: owner.id })).toBe("owner");
      expect(await setMemberRole(pool, { serverId: server.id, userId: "00000000-0000-4000-8000-000000000000", role: "admin" })).toBe("not_found");
    });

    it("removes a non-owner member, but never the owner", async () => {
      const [owner, member] = await users(2);
      const server = await upsertConfiguredServer(pool, { publicId: "rm-1", displayName: "Rm" });
      await addMember(pool, { serverId: server.id, userId: owner.id, role: "owner" });
      await addMember(pool, { serverId: server.id, userId: member.id, role: "viewer" });
      expect(await removeMember(pool, { serverId: server.id, userId: owner.id })).toBe(false);
      expect(await removeMember(pool, { serverId: server.id, userId: member.id })).toBe(true);
      expect(await removeMember(pool, { serverId: server.id, userId: member.id })).toBe(false);
      expect(await getMemberRole(pool, { publicId: "rm-1", userId: owner.id })).toBe("owner");
    });
  });

  describe("every membership change is audited, in the same statement or transaction", () => {
    const auditFor = async (serverId: string) =>
      (await admin.query("SELECT action, actor_user_id, detail FROM audit.audit_events WHERE server_id = $1 ORDER BY id", [serverId])).rows;

    it("writes one row per successful change, with ids and roles only, and none for a refused one", async () => {
      const [owner, member, actor] = await users(3);
      const server = await upsertConfiguredServer(pool, { publicId: "aud-1", displayName: "Aud" });
      await addMember(pool, { serverId: server.id, userId: owner.id, role: "owner" }); // the system: no actor
      await addMember(pool, { serverId: server.id, userId: member.id, role: "viewer", actorUserId: actor.id });
      await setMemberRole(pool, { serverId: server.id, userId: member.id, role: "admin", actorUserId: actor.id });
      await removeMember(pool, { serverId: server.id, userId: member.id, actorUserId: actor.id });
      expect(await auditFor(server.id)).toEqual([
        { action: "member_added", actor_user_id: null, detail: { userId: owner.id, role: "owner" } },
        { action: "member_added", actor_user_id: actor.id, detail: { userId: member.id, role: "viewer" } },
        { action: "member_role_changed", actor_user_id: actor.id, detail: { userId: member.id, role: "admin" } },
        { action: "member_removed", actor_user_id: actor.id, detail: { userId: member.id, role: "admin" } },
      ]);
      // Refusals leave no trace: a duplicate, a second owner, an owner role change, an owner removal,
      // a removal that matches nobody.
      const before = (await auditFor(server.id)).length;
      expect(await addMember(pool, { serverId: server.id, userId: owner.id, role: "owner" })).toBe("already_member");
      expect(await addMember(pool, { serverId: server.id, userId: actor.id, role: "owner" })).toBe("owner_exists");
      expect(await setMemberRole(pool, { serverId: server.id, userId: owner.id, role: "viewer" })).toBe("not_found");
      expect(await removeMember(pool, { serverId: server.id, userId: owner.id })).toBe(false);
      expect(await removeMember(pool, { serverId: server.id, userId: member.id })).toBe(false);
      expect((await auditFor(server.id)).length).toBe(before);
    });

    it("a role update that changes nothing writes no audit row, and says so", async () => {
      const [owner, member, actor] = await users(3);
      const server = await upsertConfiguredServer(pool, { publicId: "aud-3", displayName: "Aud3" });
      await addMember(pool, { serverId: server.id, userId: owner.id, role: "owner" });
      await addMember(pool, { serverId: server.id, userId: member.id, role: "viewer" });
      const roleRows = async () => (await auditFor(server.id)).filter((r) => r.action === "member_role_changed");
      expect(await setMemberRole(pool, { serverId: server.id, userId: member.id, role: "viewer", actorUserId: actor.id })).toBe("unchanged");
      expect(await roleRows()).toHaveLength(0);
      expect(await setMemberRole(pool, { serverId: server.id, userId: member.id, role: "admin", actorUserId: actor.id })).toBe("changed");
      expect(await setMemberRole(pool, { serverId: server.id, userId: member.id, role: "admin", actorUserId: actor.id })).toBe("unchanged");
      expect(await roleRows()).toHaveLength(1); // only the real change
      expect(await getMemberRole(pool, { publicId: "aud-3", userId: member.id })).toBe("admin");
    });

    it("records an ownership transfer with the old owner as actor, and nothing when it is refused", async () => {
      const [owner, admin2, outsider] = await users(3);
      const server = await upsertConfiguredServer(pool, { publicId: "aud-2", displayName: "Aud2" });
      await addMember(pool, { serverId: server.id, userId: owner.id, role: "owner" });
      await addMember(pool, { serverId: server.id, userId: admin2.id, role: "admin" });
      expect(await transferOwnership(pool, { serverId: server.id, fromUserId: owner.id, toUserId: outsider.id })).toBe("target_not_member");
      expect(await transferOwnership(pool, { serverId: server.id, fromUserId: admin2.id, toUserId: owner.id })).toBe("not_owner");
      expect((await auditFor(server.id)).map((r) => r.action)).toEqual(["member_added", "member_added"]);
      expect(await transferOwnership(pool, { serverId: server.id, fromUserId: owner.id, toUserId: admin2.id })).toBe("transferred");
      expect((await auditFor(server.id)).at(-1)).toEqual({
        action: "ownership_transferred",
        actor_user_id: owner.id,
        detail: { toUserId: admin2.id },
      });
    });
  });

  describe("transferOwnership", () => {
    const setup = async (publicId: string) => {
      const [owner, admin2, viewer, outsider] = await users(4);
      const server = await upsertConfiguredServer(pool, { publicId, displayName: publicId });
      await addMember(pool, { serverId: server.id, userId: owner.id, role: "owner" });
      await addMember(pool, { serverId: server.id, userId: admin2.id, role: "admin" });
      await addMember(pool, { serverId: server.id, userId: viewer.id, role: "viewer" });
      return { server, owner, admin2, viewer, outsider };
    };
    const ownersOf = async (serverId: string) =>
      (await admin.query("SELECT user_id FROM servers.server_members WHERE server_id = $1 AND role = 'owner'", [serverId])).rows.map((r) => r.user_id);

    it("swaps the owner and the target in one step; the old owner becomes an admin", async () => {
      const { server, owner, admin2 } = await setup("tr-1");
      expect(await transferOwnership(pool, { serverId: server.id, fromUserId: owner.id, toUserId: admin2.id })).toBe("transferred");
      expect(await ownersOf(server.id)).toEqual([admin2.id]);
      expect(await getMemberRole(pool, { publicId: "tr-1", userId: owner.id })).toBe("admin");
    });

    it("a viewer can be promoted straight to owner", async () => {
      const { server, owner, viewer } = await setup("tr-2");
      expect(await transferOwnership(pool, { serverId: server.id, fromUserId: owner.id, toUserId: viewer.id })).toBe("transferred");
      expect(await getMemberRole(pool, { publicId: "tr-2", userId: viewer.id })).toBe("owner");
    });

    it("refuses, changing nothing, when the caller is not the owner", async () => {
      const { server, owner, admin2, viewer } = await setup("tr-3");
      expect(await transferOwnership(pool, { serverId: server.id, fromUserId: admin2.id, toUserId: viewer.id })).toBe("not_owner");
      expect(await ownersOf(server.id)).toEqual([owner.id]);
      expect(await getMemberRole(pool, { publicId: "tr-3", userId: viewer.id })).toBe("viewer");
    });

    it("refuses, rolling the demotion back, when the target is not a member: the owner is still the owner", async () => {
      const { server, owner, outsider } = await setup("tr-4");
      expect(await transferOwnership(pool, { serverId: server.id, fromUserId: owner.id, toUserId: outsider.id })).toBe("target_not_member");
      expect(await ownersOf(server.id)).toEqual([owner.id]);
      expect(await getMemberRole(pool, { publicId: "tr-4", userId: owner.id })).toBe("owner");
    });

    it("transferring to yourself is refused and changes nothing", async () => {
      const { server, owner } = await setup("tr-5");
      expect(await transferOwnership(pool, { serverId: server.id, fromUserId: owner.id, toUserId: owner.id })).toBe("same_user");
      expect(await ownersOf(server.id)).toEqual([owner.id]);
    });

    it("concurrent transfers never leave zero or two owners", async () => {
      const { server, owner, admin2, viewer } = await setup("tr-6");
      const results = await Promise.all([
        transferOwnership(pool, { serverId: server.id, fromUserId: owner.id, toUserId: admin2.id }),
        transferOwnership(pool, { serverId: server.id, fromUserId: owner.id, toUserId: viewer.id }),
      ]);
      expect(results.filter((r) => r === "transferred")).toHaveLength(1);
      expect(results.filter((r) => r === "not_owner")).toHaveLength(1);
      expect(await ownersOf(server.id)).toHaveLength(1);
    });
  });
});
