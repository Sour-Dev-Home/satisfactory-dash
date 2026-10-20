import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";
import { createSecretsKeyring } from "../../platform/secrets/secrets.js";
import { createUser } from "../identity/repositories/userRepository.js";
import { Mutex } from "../../platform/mutex.js";
import { loadDatabaseServers } from "./loadDatabaseServers.js";
import { addMember, getMemberRole, removeMember, setMemberRole, transferOwnership } from "./repositories/memberRepository.js";
import { saveConnection } from "./repositories/connectionRepository.js";
import { softDeleteServer, upsertConfiguredServer } from "./repositories/serverRepository.js";
import { createServerManagementService } from "./serverManagement.js";
import { ServerRuntime } from "./serverRuntime.js";

// #311: the database refuses to leave a live server without an owner, wherever the write comes from.
const available = dbTestsAvailable();
const ring = createSecretsKeyring("k1", new Map([["k1", randomBytes(32)]]));

/** What pg reports for the trigger's error: the SQLSTATE, the constraint and the stable message. */
const OWNERLESS = { code: "23514", constraint: "server_members_never_ownerless", message: "ownerless_server" };

describe.skipIf(!available)("a live server is never ownerless (database trigger)", () => {
  let db: TestDatabase;
  let app: pg.Pool;
  let admin: pg.Pool;
  let n = 0;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = new pg.Pool({ connectionString: db.appUrl, max: 6 });
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
  }, 60_000);

  afterAll(async () => {
    await app?.end();
    await admin?.end();
    await db?.drop();
  });

  const user = async () => (await createUser(app, { displayName: `user-${++n}` })).id;
  /** A live server with an owner and optionally other members. */
  const serverWith = async (owner: string, others: { userId: string; role: "admin" | "viewer" }[] = []) => {
    const server = await upsertConfiguredServer(app, { publicId: `nov-${++n}`, displayName: "S" });
    await addMember(app, { serverId: server.id, userId: owner, role: "owner", actorUserId: null });
    for (const o of others) await addMember(app, { serverId: server.id, userId: o.userId, role: o.role, actorUserId: null });
    return server;
  };
  const userExists = async (id: string) => (await admin.query("SELECT 1 FROM identity.users WHERE id = $1", [id])).rows.length === 1;

  it("refuses to delete the account of a live server's owner (the cascade fires the trigger) and changes nothing", async () => {
    const owner = await user();
    const server = await serverWith(owner);
    await expect(admin.query("DELETE FROM identity.users WHERE id = $1", [owner])).rejects.toMatchObject(OWNERLESS);
    expect(await userExists(owner)).toBe(true);
    expect(await getMemberRole(app, { publicId: server.publicId, userId: owner })).toBe("owner");
  });

  it("refuses a direct delete of the owner row, and a demotion with no new owner", async () => {
    const owner = await user();
    const server = await serverWith(owner);
    await expect(app.query("DELETE FROM servers.server_members WHERE server_id = $1 AND user_id = $2", [server.id, owner])).rejects.toMatchObject(OWNERLESS);
    await expect(app.query("UPDATE servers.server_members SET role = 'admin' WHERE server_id = $1 AND user_id = $2", [server.id, owner])).rejects.toMatchObject(OWNERLESS);
    expect(await getMemberRole(app, { publicId: server.publicId, userId: owner })).toBe("owner");
  });

  it("defers the check to commit: a transaction may pass through an ownerless moment if it ends with an owner", async () => {
    const [owner, other] = [await user(), await user()];
    const server = await serverWith(owner, [{ userId: other, role: "viewer" }]);
    const client = await app.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM servers.server_members WHERE server_id = $1 AND user_id = $2", [server.id, owner]);
      await client.query("UPDATE servers.server_members SET role = 'owner' WHERE server_id = $1 AND user_id = $2", [server.id, other]);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    expect(await getMemberRole(app, { publicId: server.publicId, userId: other })).toBe("owner");
    // The same transaction without the promotion fails at COMMIT.
    const failing = await app.connect();
    try {
      await failing.query("BEGIN");
      await failing.query("DELETE FROM servers.server_members WHERE server_id = $1 AND user_id = $2", [server.id, other]);
      await expect(failing.query("COMMIT")).rejects.toMatchObject(OWNERLESS);
    } finally {
      failing.release();
    }
    expect(await getMemberRole(app, { publicId: server.publicId, userId: other })).toBe("owner");
  });

  it("lets the account go once its owned server was handed over, and when it only has non-owner memberships", async () => {
    const [owner, heir, viewer] = [await user(), await user(), await user()];
    const server = await serverWith(owner, [{ userId: heir, role: "admin" }, { userId: viewer, role: "viewer" }]);
    await expect(transferOwnership(app, { serverId: server.id, fromUserId: owner, toUserId: heir })).resolves.toBe("transferred");
    await admin.query("DELETE FROM identity.users WHERE id = $1", [owner]);
    await admin.query("DELETE FROM identity.users WHERE id = $1", [viewer]);
    expect(await getMemberRole(app, { publicId: server.publicId, userId: heir })).toBe("owner");
  });

  it("lets the owner's account go when the server was soft-deleted or hard-deleted", async () => {
    const [a, b] = [await user(), await user()];
    const soft = await serverWith(a);
    await expect(softDeleteServer(app, soft.publicId)).resolves.toBe(true);
    await admin.query("DELETE FROM identity.users WHERE id = $1", [a]);
    const hard = await serverWith(b);
    await admin.query("DELETE FROM servers.servers WHERE id = $1", [hard.id]);
    await admin.query("DELETE FROM identity.users WHERE id = $1", [b]);
    expect(await userExists(a)).toBe(false);
    expect(await userExists(b)).toBe(false);
  });

  it("keeps the existing operations working: removeMember, setMemberRole, transferOwnership (with an audit row)", async () => {
    const [owner, admin1, viewer] = [await user(), await user(), await user()];
    const server = await serverWith(owner, [{ userId: admin1, role: "admin" }, { userId: viewer, role: "viewer" }]);
    await expect(setMemberRole(app, { serverId: server.id, userId: viewer, role: "admin", actorUserId: owner })).resolves.toBe("changed");
    await expect(removeMember(app, { serverId: server.id, userId: viewer, actorUserId: owner })).resolves.toBe(true);
    await expect(removeMember(app, { serverId: server.id, userId: owner, actorUserId: owner })).resolves.toBe(false); // owner is protected
    await expect(transferOwnership(app, { serverId: server.id, fromUserId: owner, toUserId: admin1 })).resolves.toBe("transferred");
    expect(await getMemberRole(app, { publicId: server.publicId, userId: admin1 })).toBe("owner");
    expect(await getMemberRole(app, { publicId: server.publicId, userId: owner })).toBe("admin");
  });

  it("a server created by server management gets its owner in the same transaction, so the check passes", async () => {
    const operator = await user();
    const service = createServerManagementService({
      db: app,
      ring,
      runtime: new ServerRuntime<string>(),
      build: (c) => ({ id: c.publicId, displayName: c.displayName, services: c.apiToken, workers: [] }),
      testConnection: async () => ({ ok: true, api: { ok: true }, frm: { ok: true } }),
      getOperatorUserId: () => operator,
      lookup: async () => ["192.168.1.20"],
      policy: { allowLan: true },
      mutex: new Mutex(),
    });
    const view = await service.create(operator, {
      id: "nov-created", displayName: "Created", host: "192.168.1.20", apiPort: 7777, frmPort: 8080,
      apiToken: "api-token-abcdefgh1234", frmToken: "frm-token-abcdefgh5678",
    });
    expect(view.id).toBe("nov-created");
    expect(await getMemberRole(app, { publicId: "nov-created", userId: operator })).toBe("owner");
    await expect(admin.query("DELETE FROM identity.users WHERE id = $1", [operator])).rejects.toMatchObject(OWNERLESS);
  });

  it("the startup seed only adds owners, still works, and reports each seeded server with source startup_seed", async () => {
    const operator = await user();
    const server = await upsertConfiguredServer(app, { publicId: "nov-seeded", displayName: "Seeded" });
    await saveConnection(app, ring, server.id, {
      host: "192.168.1.20", pinnedIp: "192.168.1.20", apiPort: 7777, frmPort: 8080,
      apiToken: "api-token-abcdefgh1234", frmToken: "frm-token-abcdefgh5678",
    });
    const load = () =>
      loadDatabaseServers({
        db: app, ring, runtime: new ServerRuntime<string>(), operatorUserId: operator, policy: { allowLan: true },
        build: (c) => ({ id: c.publicId, displayName: c.displayName, services: c.apiToken, workers: [] }),
      });
    expect((await load()).ownershipSeeded).toEqual(["nov-seeded"]);
    expect(await getMemberRole(app, { publicId: "nov-seeded", userId: operator })).toBe("owner");
    const audit = (await admin.query("SELECT detail FROM audit.audit_events WHERE server_id = $1 AND action = 'member_added'", [server.id])).rows;
    expect(audit).toEqual([{ detail: { userId: operator, role: "owner", source: "startup_seed" } }]);
    // A second start changes nothing and reports nothing.
    expect((await load()).ownershipSeeded).toEqual([]);
  });

  // Fresh-eyes additions (test hunt).
  it("a second owner is refused by the one-owner index, and a non-owner leaving a live server is fine", async () => {
    const [owner, other, leaver] = [await user(), await user(), await user()];
    const server = await serverWith(owner, [{ userId: leaver, role: "admin" }]);
    await expect(addMember(app, { serverId: server.id, userId: other, role: "owner", actorUserId: null })).resolves.toBe("owner_exists");
    await admin.query("DELETE FROM identity.users WHERE id = $1", [leaver]);
    expect(await getMemberRole(app, { publicId: server.publicId, userId: owner })).toBe("owner");
  });

  it("concurrent transfers from the same owner: exactly one wins, the server keeps exactly one owner", async () => {
    const [owner, x, y] = [await user(), await user(), await user()];
    const server = await serverWith(owner, [{ userId: x, role: "admin" }, { userId: y, role: "admin" }]);
    const results = await Promise.all([
      transferOwnership(app, { serverId: server.id, fromUserId: owner, toUserId: x }),
      transferOwnership(app, { serverId: server.id, fromUserId: owner, toUserId: y }),
    ]);
    expect([...results].sort()).toEqual(["not_owner", "transferred"]);
    const owners = (await admin.query("SELECT user_id FROM servers.server_members WHERE server_id = $1 AND role = 'owner'", [server.id])).rows;
    expect(owners).toHaveLength(1);
  });

  it("concurrent: removing the owner's account while a transfer runs never leaves a live server ownerless", async () => {
    const [owner, heir] = [await user(), await user()];
    const server = await serverWith(owner, [{ userId: heir, role: "admin" }]);
    const settled = await Promise.allSettled([
      transferOwnership(app, { serverId: server.id, fromUserId: owner, toUserId: heir }),
      admin.query("DELETE FROM identity.users WHERE id = $1", [owner]),
    ]);
    expect(settled).toHaveLength(2);
    const owners = (await admin.query("SELECT 1 FROM servers.server_members WHERE server_id = $1 AND role = 'owner'", [server.id])).rows;
    expect(owners).toHaveLength(1);
  });

  it("the startup seed does not take over a server that already has another owner, and reports nothing", async () => {
    const [operator, realOwner] = [await user(), await user()];
    const server = await upsertConfiguredServer(app, { publicId: "nov-owned", displayName: "Owned" });
    await addMember(app, { serverId: server.id, userId: realOwner, role: "owner", actorUserId: null });
    await saveConnection(app, ring, server.id, {
      host: "192.168.1.21", pinnedIp: "192.168.1.21", apiPort: 7777, frmPort: 8080,
      apiToken: "api-token-abcdefgh1234", frmToken: "frm-token-abcdefgh5678",
    });
    const res = await loadDatabaseServers({
      db: app, ring, runtime: new ServerRuntime<string>(), operatorUserId: operator, policy: { allowLan: true },
      build: (c) => ({ id: c.publicId, displayName: c.displayName, services: c.apiToken, workers: [] }),
    });
    expect(res.ownershipSeeded).not.toContain("nov-owned");
    expect(await getMemberRole(app, { publicId: "nov-owned", userId: realOwner })).toBe("owner");
  });

  // Found by the #311 test hunt: the trigger once fired on `UPDATE OF role` only, so re-pointing the owner row at
  // another server left the old live server ownerless. It now fires on `server_id` too.
  it("refuses moving the owner row to another server (UPDATE SET server_id)", async () => {
    const [a, b] = [await user(), await user()];
    const from = await serverWith(a);
    const to = await upsertConfiguredServer(app, { publicId: `nov-to-${++n}`, displayName: "To" });
    await addMember(app, { serverId: to.id, userId: b, role: "viewer", actorUserId: null });
    await expect(
      app.query("UPDATE servers.server_members SET server_id = $1 WHERE server_id = $2 AND user_id = $3", [to.id, from.id, a]),
    ).rejects.toMatchObject(OWNERLESS);
  });
});
