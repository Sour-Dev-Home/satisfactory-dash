import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";
import { withTransaction } from "../../platform/db/transaction.js";
import { createAccountServers } from "../servers/accountServers.js";
import { addMember, transferOwnership } from "../servers/repositories/memberRepository.js";
import { PURGED_TABLES, insertSelfServeServer, upsertConfiguredServer } from "../servers/repositories/serverRepository.js";
import { createAccountDeletion } from "./accountDeletion.js";
import { OPERATOR_SUBJECT } from "./authenticator.js";
import { createSession, hashSessionId, newSessionId } from "./repositories/sessionRepository.js";
import { createUser, ensureLocalUser } from "./repositories/userRepository.js";

// ADR-0047 against a real Postgres, as satis_app: what deleting an account deletes, keeps and clears.
const available = dbTestsAvailable();

describe.skipIf(!available)("account deletion (database)", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let admin: pg.Pool;
  let n = 0;

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

  const rows = async (sql: string, params: unknown[] = []) => (await admin.query(sql, params)).rows;
  const user = async () => (await createUser(pool, { displayName: `person-${++n}` })).id;
  /** A session for the user, started `minutesAgo` minutes ago; returns its id hash. */
  const session = async (userId: string, minutesAgo = 0) => {
    const { idHash } = newSessionId();
    await createSession(pool, { idHash, userId, ttlSeconds: 8 * 3600 });
    if (minutesAgo > 0) await admin.query(`UPDATE identity.sessions SET created_at = now() - make_interval(mins => $2) WHERE id_hash = $1`, [idHash, minutesAgo]);
    return idHash;
  };
  const selfServe = async (ownerId: string) =>
    withTransaction(pool, async (client) => {
      const server = await insertSelfServeServer(client, { publicId: `ss-${++n}`, displayName: `Mine ${n}`, createdByUserId: ownerId });
      await addMember(client, { serverId: server.id, userId: ownerId, role: "owner", actorUserId: ownerId });
      return server;
    });
  const operatorServer = async (ownerId: string) => {
    const server = await upsertConfiguredServer(pool, { publicId: `op-${++n}`, displayName: `Operator ${n}` });
    await addMember(pool, { serverId: server.id, userId: ownerId, role: "owner", actorUserId: null });
    return server;
  };
  const pushSubscription = async (userId: string) =>
    admin.query(
      `INSERT INTO alerts.push_subscriptions (user_id, endpoint_enc, p256dh_enc, auth_enc, key_id, endpoint_host, endpoint_hash)
       VALUES ($1, $2, $2, $2, 'k1', 'push.example', $3)`,
      [userId, randomBytes(40), randomBytes(32)],
    );
  const runtime = () => ({ remove: vi.fn(async () => true) });
  const deletion = (rt = runtime()) => ({ rt, service: createAccountDeletion({ db: pool, servers: createAccountServers({ runtime: rt }) }) });
  const exists = async (table: string, column: string, id: string) => (await rows(`SELECT 1 FROM ${table} WHERE ${column} = $1`, [id])).length > 0;

  it("deletes the user row with its identities, sessions, memberships, push data; removes owned self-serve servers; keeps the audit trail", async () => {
    const me = await user();
    const other = await user();
    await admin.query("INSERT INTO identity.auth_identities (user_id, provider, provider_subject) VALUES ($1, 'google', $2)", [me, `sub-${n}`]);
    const fresh = await session(me);
    await session(me, 60);
    const mine = await selfServe(me);
    await admin.query("INSERT INTO agents.agent_credentials (server_id, secret_hash, agent_version) VALUES ($1, $2, '1.0.0')", [mine.id, randomBytes(32)]);
    await admin.query("INSERT INTO map.world_layers (server_id, layer, hash, observed_at, truncated, count, data) VALUES ($1, 'rails', 'h', now(), false, 1, '[]'::jsonb)", [mine.id]);
    await admin.query("INSERT INTO alerts.push_optins (server_id, user_id) VALUES ($1, $2)", [mine.id, me]);
    // A server someone else owns, where I am a viewer: it stays, my membership and opt-in go, theirs stay.
    const theirs = await selfServe(other);
    await addMember(pool, { serverId: theirs.id, userId: me, role: "viewer", actorUserId: other });
    await admin.query("INSERT INTO alerts.push_optins (server_id, user_id) VALUES ($1, $2), ($1, $3)", [theirs.id, me, other]);
    await pushSubscription(me);
    const loginsBefore = await rows("SELECT id FROM audit.audit_events WHERE actor_user_id = $1 OR detail->>'userId' = $1::text", [me]);

    const { rt, service } = deletion();
    await expect(service.deleteAccount({ userId: me, sessionIdHash: fresh })).resolves.toEqual({
      outcome: "deleted",
      serversDeleted: 1,
      membershipsLeft: 1,
      pushSubscriptions: 1,
    });

    for (const [table, column] of [
      ["identity.users", "id"],
      ["identity.auth_identities", "user_id"],
      ["identity.sessions", "user_id"],
      ["servers.server_members", "user_id"],
      ["alerts.push_subscriptions", "user_id"],
      ["alerts.push_optins", "user_id"],
    ] as const) {
      expect(await exists(table, column, me), table).toBe(false);
    }
    // My server: soft-deleted, name cleared, purged, creator column nulled by the foreign key.
    expect(await rows("SELECT display_name, deleted_at IS NOT NULL AS removed, created_by_user_id FROM servers.servers WHERE id = $1", [mine.id])).toEqual([
      { display_name: null, removed: true, created_by_user_id: null },
    ]);
    for (const table of [...PURGED_TABLES, "servers.server_members"]) {
      expect(await rows(`SELECT 1 FROM ${table} WHERE server_id = $1`, [mine.id]), table).toEqual([]);
    }
    expect(rt.remove.mock.calls).toEqual([[mine.publicId]]);
    // Their server: untouched but for my membership and opt-in.
    expect(await rows("SELECT user_id::text, role FROM servers.server_members WHERE server_id = $1", [theirs.id])).toEqual([{ user_id: other, role: "owner" }]);
    expect(await rows("SELECT user_id::text FROM alerts.push_optins WHERE server_id = $1", [theirs.id])).toEqual([{ user_id: other }]);
    expect(await rows("SELECT display_name, deleted_at FROM servers.servers WHERE id = $1", [theirs.id])).toEqual([{ display_name: theirs.displayName, deleted_at: null }]);
    // The audit trail: every earlier row naming my random id is kept, plus the two new ones (ids and counts only).
    const after = await rows("SELECT id FROM audit.audit_events WHERE actor_user_id = $1 OR detail->>'userId' = $1::text", [me]);
    expect(after.length).toBe(loginsBefore.length + 2);
    expect(await rows("SELECT actor_user_id::text AS actor, detail FROM audit.audit_events WHERE action = 'server.deleted' AND server_id = $1", [mine.id])).toEqual([
      { actor: me, detail: { reason: "account_deleted" } },
    ]);
    expect(await rows("SELECT actor_user_id::text AS actor, server_id, detail FROM audit.audit_events WHERE action = 'account.deleted' AND actor_user_id = $1", [me])).toEqual([
      { actor: me, server_id: null, detail: { userId: me, serversDeleted: 1, membershipsLeft: 1, pushSubscriptions: 1 } },
    ]);
    // Done once: a second request finds no account.
    await expect(service.deleteAccount({ userId: me })).resolves.toEqual({ outcome: "not_found" });
  });

  it("removes servers by CURRENT ownership, not by creator", async () => {
    const [creator, newOwner] = [await user(), await user()];
    const server = await selfServe(creator);
    await addMember(pool, { serverId: server.id, userId: newOwner, role: "admin", actorUserId: creator });
    expect(await transferOwnership(pool, { serverId: server.id, fromUserId: creator, toUserId: newOwner })).toBe("transferred");

    const { service } = deletion();
    await expect(service.deleteAccount({ userId: creator })).resolves.toMatchObject({ outcome: "deleted", serversDeleted: 0, membershipsLeft: 1 });
    expect(await rows("SELECT deleted_at, created_by_user_id FROM servers.servers WHERE id = $1", [server.id])).toEqual([{ deleted_at: null, created_by_user_id: null }]);
    await expect(service.deleteAccount({ userId: newOwner })).resolves.toMatchObject({ outcome: "deleted", serversDeleted: 1 });
    expect((await rows("SELECT deleted_at FROM servers.servers WHERE id = $1", [server.id]))[0]!.deleted_at).not.toBeNull();
  });

  it("an owned operator-created server blocks it: operator_servers with the list, and nothing changes", async () => {
    const me = await user();
    const op = await operatorServer(me);
    const mine = await selfServe(me);
    const { rt, service } = deletion();
    await expect(service.deleteAccount({ userId: me, sessionIdHash: await session(me) })).resolves.toEqual({
      outcome: "operator_servers",
      servers: [{ id: op.publicId, displayName: op.displayName }],
    });
    expect(await exists("identity.users", "id", me)).toBe(true);
    expect(await rows("SELECT public_id, display_name, deleted_at FROM servers.servers WHERE id = ANY($1) ORDER BY public_id", [[op.id, mine.id]])).toEqual([
      { public_id: op.publicId, display_name: op.displayName, deleted_at: null },
      { public_id: mine.publicId, display_name: mine.displayName, deleted_at: null },
    ]);
    expect(rt.remove).not.toHaveBeenCalled();
    expect(await rows("SELECT 1 FROM audit.audit_events WHERE action IN ('account.deleted', 'server.deleted') AND actor_user_id = $1", [me])).toEqual([]);
  });

  it("refuses the operator's own account, whatever it owns", async () => {
    const operator = await ensureLocalUser(pool, { subject: OPERATOR_SUBJECT, displayName: "operator" });
    const { service } = deletion();
    await expect(service.deleteAccount({ userId: operator.id })).resolves.toEqual({ outcome: "operator_account" });
    await expect(service.deleteAccount({ userId: operator.id, sessionIdHash: await session(operator.id) })).resolves.toEqual({ outcome: "operator_account" });
    expect(await exists("identity.users", "id", operator.id)).toBe(true);
  });

  it("needs a sign-in within the last 10 minutes on the request's own session; the CLI (no session) does not", async () => {
    const me = await user();
    const mine = await selfServe(me);
    const { service } = deletion();
    const stale = await session(me, 11);
    const revoked = await session(me);
    await admin.query("UPDATE identity.sessions SET revoked_at = now() WHERE id_hash = $1", [revoked]);
    const someoneElses = await session(await user());
    for (const sessionIdHash of [stale, revoked, someoneElses, hashSessionId("x".repeat(43))]) {
      await expect(service.deleteAccount({ userId: me, sessionIdHash })).resolves.toEqual({ outcome: "reauth_required" });
    }
    expect(await exists("identity.users", "id", me)).toBe(true);
    expect((await rows("SELECT deleted_at FROM servers.servers WHERE id = $1", [mine.id]))[0]!.deleted_at).toBeNull();
    // Nine minutes is still fresh.
    await expect(service.deleteAccount({ userId: me, sessionIdHash: await session(me, 9) })).resolves.toMatchObject({ outcome: "deleted", serversDeleted: 1 });

    const viaCli = await user();
    await session(viaCli, 600);
    await expect(service.deleteAccount({ userId: viaCli })).resolves.toMatchObject({ outcome: "deleted" });
  });

  it("an unknown account is not_found", async () => {
    await expect(deletion().service.deleteAccount({ userId: "00000000-0000-4000-8000-000000000000" })).resolves.toEqual({ outcome: "not_found" });
  });

  it("the ownerless trigger still guards the user-row delete: a stray owned server makes the commit fail and keeps everything", async () => {
    const me = await user();
    const op = await operatorServer(me);
    // A port that skips the servers' part, to show the database itself refuses an ownerless live server.
    const service = createAccountDeletion({
      db: pool,
      servers: { exclusive: (work) => work(), removeOwnedServers: async () => ({ outcome: "removed", removed: [] }), afterCommit: async () => {} },
    });
    await expect(service.deleteAccount({ userId: me })).rejects.toMatchObject({ constraint: "server_members_never_ownerless" });
    expect(await exists("identity.users", "id", me)).toBe(true);
    expect(await rows("SELECT role FROM servers.server_members WHERE server_id = $1 AND user_id = $2", [op.id, me])).toEqual([{ role: "owner" }]);
  });
});
