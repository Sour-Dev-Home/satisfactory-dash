import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";
import { disableUserAdmin } from "../identity/accountAdmin.js";
import { createUser } from "../identity/repositories/userRepository.js";
import { addMember } from "./repositories/memberRepository.js";
import { upsertConfiguredServer } from "./repositories/serverRepository.js";
import { listServersAdmin, removeServerAdmin } from "./serverAdmin.js";

// #516 / ADR-0046: the operator's CLI commands against a real Postgres, as satis_app.
const available = dbTestsAvailable();

describe.skipIf(!available)("operator server commands against a real Postgres", () => {
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

  const makeServer = async (ownerId: string | null) => {
    const server = await upsertConfiguredServer(pool, { publicId: `adm-${++n}`, displayName: `Admin ${n}` });
    if (ownerId !== null) await addMember(pool, { serverId: server.id, userId: ownerId, role: "owner", actorUserId: null });
    return server;
  };
  const enrol = async (serverId: string, tag: number) => {
    await admin.query("INSERT INTO agents.agent_credentials (server_id, secret_hash, agent_version, last_seen_at) VALUES ($1, $2, '1.0.0', now())", [serverId, Buffer.alloc(32, tag)]);
  };
  const rows = async (sql: string, params: unknown[]) => (await admin.query(sql, params)).rows;

  it("remove-server deletes a server the operator is not a member of, audits it with no actor, and a re-created id starts empty", async () => {
    const owner = await createUser(pool, { displayName: "someone" });
    const server = await makeServer(owner.id);
    await admin.query("INSERT INTO map.world_layers (server_id, layer, hash, observed_at, truncated, count, data) VALUES ($1, 'rails', 'h', now(), false, 1, '[]'::jsonb)", [server.id]);
    await admin.query("INSERT INTO alerts.push_optins (server_id, user_id) VALUES ($1, $2)", [server.id, owner.id]);
    await enrol(server.id, 1);

    expect(await removeServerAdmin(pool, server.publicId)).toBe(true);
    expect(await removeServerAdmin(pool, server.publicId)).toBe(false);
    expect(await removeServerAdmin(pool, "no-such-server")).toBe(false);

    const audit = await rows("SELECT actor_user_id, server_id, detail FROM audit.audit_events WHERE action = 'server.deleted' AND server_id = $1", [server.id]);
    expect(audit).toEqual([{ actor_user_id: null, server_id: server.id, detail: {} }]);
    // ADR-0047 amendment: remove-server clears the name; the row keeps only its ids.
    expect(await rows("SELECT display_name FROM servers.servers WHERE id = $1", [server.id])).toEqual([{ display_name: null }]);
    const again = await upsertConfiguredServer(pool, { publicId: server.publicId, displayName: "Again" });
    expect(again.id).toBe(server.id);
    expect(again.displayName).toBe("Again");
    for (const table of ["map.world_layers", "alerts.push_optins", "agents.agent_credentials", "servers.server_members"]) {
      expect(await rows(`SELECT 1 FROM ${table} WHERE server_id = $1`, [server.id]), table).toEqual([]);
    }
    await removeServerAdmin(pool, server.publicId);
  });

  it("list-servers shows live servers with ids and numbers only, and not a removed one", async () => {
    const owner = await createUser(pool, { displayName: "list-owner" });
    const live = await makeServer(owner.id);
    const gone = await makeServer(null);
    await enrol(live.id, 2);
    await admin.query(
      "INSERT INTO telemetry.power_samples (server_id, session, circuit, at, production_mw, consumption_mw, capacity_mw, battery_pct, fuse_tripped) VALUES ($1, 1, 1, now(), 1, 1, 1, 0, false)",
      [live.id],
    );
    await removeServerAdmin(pool, gone.publicId);

    const listed = await listServersAdmin(pool);
    const row = listed.find((r) => r.publicId === live.publicId);
    expect(row).toMatchObject({ displayName: live.displayName, ownerUserId: owner.id, enrolled: true });
    expect(row?.lastSeenAt).not.toBeNull();
    expect(row?.powerRows).toBe(1);
    expect(listed.some((r) => r.publicId === gone.publicId)).toBe(false);
    expect(JSON.stringify(listed)).not.toMatch(/@|list-owner/);
  });

  it("disable-user revokes the agent credentials and unspent codes of the live servers the account owns, and nothing else", async () => {
    const victim = await createUser(pool, { displayName: "abuser" });
    const other = await createUser(pool, { displayName: "bystander" });
    const owned = await makeServer(victim.id);
    const ownedRemoved = await makeServer(victim.id);
    const notOwned = await makeServer(other.id);
    const memberOnly = await makeServer(other.id);
    await addMember(pool, { serverId: memberOnly.id, userId: victim.id, role: "viewer", actorUserId: null });
    for (const [i, s] of [owned, notOwned, memberOnly].entries()) await enrol(s.id, 10 + i);
    await admin.query("INSERT INTO agents.enrollment_codes (server_id, code_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [owned.id, Buffer.alloc(32, 40)]);
    await admin.query("INSERT INTO agents.enrollment_codes (server_id, code_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [notOwned.id, Buffer.alloc(32, 41)]);
    await removeServerAdmin(pool, ownedRemoved.publicId);

    expect(await disableUserAdmin(pool, victim.id)).toMatchObject({ found: true, agentsRevoked: 1 });

    const revoked = async (id: string) => (await rows("SELECT revoked_at FROM agents.agent_credentials WHERE server_id = $1", [id]))[0]?.revoked_at;
    expect(await revoked(owned.id)).not.toBeNull();
    expect(await revoked(notOwned.id)).toBeNull();
    expect(await revoked(memberOnly.id)).toBeNull();
    expect(await rows("SELECT 1 FROM agents.enrollment_codes WHERE server_id = $1", [owned.id])).toEqual([]);
    expect(await rows("SELECT 1 FROM agents.enrollment_codes WHERE server_id = $1", [notOwned.id])).toHaveLength(1);
    // The server and its data stay (the owner enrols again after re-enabling).
    expect(await rows("SELECT 1 FROM servers.servers WHERE id = $1 AND deleted_at IS NULL", [owned.id])).toHaveLength(1);
    const audit = await rows("SELECT detail FROM audit.audit_events WHERE action = 'user.disabled' AND detail->>'userId' = $1", [victim.id]);
    expect(audit).toEqual([{ detail: { userId: victim.id, sessionsRevoked: 0, agentsRevoked: 1 } }]);
  });
});
