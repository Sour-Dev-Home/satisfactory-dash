import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";
import { withTransaction } from "../../platform/db/transaction.js";
import { createAccountServers } from "../servers/accountServers.js";
import { addMember, leaveServer } from "../servers/repositories/memberRepository.js";
import { ensureServer, insertSelfServeServer, upsertConfiguredServer } from "../servers/repositories/serverRepository.js";
import { createAccountDeletion } from "./accountDeletion.js";
import { createSession, newSessionId } from "./repositories/sessionRepository.js";
import { createUser } from "./repositories/userRepository.js";

// Fresh-eyes edges for ADR-0047 (#311) against a real Postgres: the 10-minute boundary, two deletions racing, the push
// queue cascade, what the audit rows hold, leaving and re-joining, a revived server after its name was cleared.
const available = dbTestsAvailable();

describe.skipIf(!available)("account deletion edges (database)", () => {
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
  const user = async () => (await createUser(pool, { displayName: `Secret Name ${++n}` })).id;
  const sessionSecondsAgo = async (userId: string, seconds: number) => {
    const { idHash } = newSessionId();
    await createSession(pool, { idHash, userId, ttlSeconds: 8 * 3600 });
    await admin.query(`UPDATE identity.sessions SET created_at = now() - make_interval(secs => $2) WHERE id_hash = $1`, [idHash, seconds]);
    return idHash;
  };
  const selfServe = async (ownerId: string, name = `Mine ${++n}`) =>
    withTransaction(pool, async (client) => {
      const server = await insertSelfServeServer(client, { publicId: `ed-${++n}`, displayName: name, createdByUserId: ownerId });
      await addMember(client, { serverId: server.id, userId: ownerId, role: "owner", actorUserId: ownerId });
      return server;
    });
  const service = () => createAccountDeletion({ db: pool, servers: createAccountServers() });

  it("the 10-minute window: just inside is fresh, just outside is reauth_required", async () => {
    const [a, b] = [await user(), await user()];
    await expect(service().deleteAccount({ userId: a, sessionIdHash: await sessionSecondsAgo(a, 605) })).resolves.toEqual({ outcome: "reauth_required" });
    await expect(service().deleteAccount({ userId: b, sessionIdHash: await sessionSecondsAgo(b, 595) })).resolves.toMatchObject({ outcome: "deleted" });
    expect(await rows("SELECT 1 FROM identity.users WHERE id = $1", [a])).toHaveLength(1);
  });

  it("an expired (not revoked) session is not fresh either", async () => {
    const me = await user();
    const hash = await sessionSecondsAgo(me, 5);
    await admin.query("UPDATE identity.sessions SET expires_at = now() - interval '1 second' WHERE id_hash = $1", [hash]);
    await expect(service().deleteAccount({ userId: me, sessionIdHash: hash })).resolves.toEqual({ outcome: "reauth_required" });
  });

  it("two deletions of the same account at once (two tabs, or the CLI and a tab): one deleted, the other not_found, no error", async () => {
    const me = await user();
    await selfServe(me);
    await selfServe(me);
    const hash = await sessionSecondsAgo(me, 1);
    // Separate services: separate mutexes, so only the database serialises them.
    const results = await Promise.all([service().deleteAccount({ userId: me, sessionIdHash: hash }), service().deleteAccount({ userId: me })]);
    expect(results.map((r) => r.outcome).sort()).toEqual(["deleted", "not_found"]);
    const deleted = results.find((r) => r.outcome === "deleted");
    expect(deleted).toMatchObject({ serversDeleted: 2 });
    expect(await rows("SELECT 1 FROM audit.audit_events WHERE action = 'account.deleted' AND actor_user_id = $1", [me])).toHaveLength(1);
    expect(await rows("SELECT 1 FROM audit.audit_events WHERE action = 'server.deleted' AND actor_user_id = $1", [me])).toHaveLength(2);
  });

  it("the push cascade: queued pushes for the user's subscriptions go with them, the alert event and other users' queue stay", async () => {
    const [me, other] = [await user(), await user()];
    const theirs = await selfServe(other);
    await addMember(pool, { serverId: theirs.id, userId: me, role: "viewer", actorUserId: other });
    const subscribe = async (userId: string) =>
      (
        await admin.query(
          `INSERT INTO alerts.push_subscriptions (user_id, endpoint_enc, p256dh_enc, auth_enc, key_id, endpoint_host, endpoint_hash)
           VALUES ($1, $2, $2, $2, 'k1', 'push.example', $3) RETURNING id`,
          [userId, randomBytes(40), randomBytes(32)],
        )
      ).rows[0].id as string;
    const [mySub, theirSub] = [await subscribe(me), await subscribe(other)];
    const event = (
      await admin.query(
        `INSERT INTO alerts.alert_events (server_id, kind, severity, subject, transition, at) VALUES ($1, 'power', 'warning', 's', 'fired', now()) RETURNING id`,
        [theirs.id],
      )
    ).rows[0].id as string;
    await admin.query("INSERT INTO alerts.outbox (event_id, push_subscription_id) VALUES ($1, $2), ($1, $3)", [event, mySub, theirSub]);

    await expect(service().deleteAccount({ userId: me })).resolves.toMatchObject({ outcome: "deleted", pushSubscriptions: 1 });
    expect(await rows("SELECT push_subscription_id::text AS p FROM alerts.outbox WHERE event_id = $1", [event])).toEqual([{ p: theirSub }]);
    expect(await rows("SELECT 1 FROM alerts.alert_events WHERE id = $1", [event])).toHaveLength(1);
  });

  it("audit rows written by a deletion hold ids, reasons and counts, never a name", async () => {
    const me = await user();
    const mine = await selfServe(me, "Zebra Factory Name");
    await service().deleteAccount({ userId: me });
    const text = JSON.stringify(await rows("SELECT action, actor_user_id, server_id, detail FROM audit.audit_events WHERE actor_user_id = $1 OR server_id = $2", [me, mine.id]));
    expect(text).not.toContain("Zebra Factory Name");
    expect(text).not.toContain("Secret Name");
    expect(text).not.toContain("@");
  });

  it("leave, then be invited again: the old opt-in is gone, the new membership works, and each leave is audited", async () => {
    const [owner, member] = [await user(), await user()];
    const s = await upsertConfiguredServer(pool, { publicId: `ed-${++n}`, displayName: "Shared" });
    await addMember(pool, { serverId: s.id, userId: owner, role: "owner", actorUserId: null });
    await addMember(pool, { serverId: s.id, userId: member, role: "admin", actorUserId: owner });
    await admin.query("INSERT INTO alerts.push_optins (server_id, user_id) VALUES ($1, $2)", [s.id, member]);
    await expect(leaveServer(pool, { publicId: s.publicId, userId: member })).resolves.toBe("left");
    await expect(leaveServer(pool, { publicId: s.publicId, userId: member })).resolves.toBe("not_member");
    await expect(addMember(pool, { serverId: s.id, userId: member, role: "viewer", actorUserId: owner })).resolves.toBe("added");
    expect(await rows("SELECT 1 FROM alerts.push_optins WHERE server_id = $1 AND user_id = $2", [s.id, member])).toEqual([]);
    await expect(leaveServer(pool, { publicId: s.publicId, userId: member })).resolves.toBe("left");
    expect(await rows("SELECT detail FROM audit.audit_events WHERE action = 'member_left' AND server_id = $1 ORDER BY id", [s.id])).toEqual([
      { detail: { userId: member, role: "admin" } },
      { detail: { userId: member, role: "viewer" } },
    ]);
  });

  it("an account-deleted server's id can be revived by an import with the imported name", async () => {
    const me = await user();
    const mine = await selfServe(me, "Typed By Person");
    await service().deleteAccount({ userId: me });
    const revived = await ensureServer(pool, { publicId: mine.publicId, displayName: "Imported" });
    expect(revived.displayName).toBe("Imported");
    expect(await rows("SELECT display_name, deleted_at, created_via FROM servers.servers WHERE id = $1", [mine.id])).toEqual([
      { display_name: "Imported", deleted_at: null, created_via: "operator" },
    ]);
  });
});
