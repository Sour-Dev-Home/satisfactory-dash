import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";
import { ApiFailure, ForbiddenError, RateLimitedError, ServerNotFoundError } from "../../platform/errorResponse.js";
import { createLogger } from "../../platform/logger.js";
import { createUser } from "../identity/repositories/userRepository.js";
import { enrolledServerIds } from "../agents/index.js";
import { addMember, getMemberRole, transferOwnership } from "./repositories/memberRepository.js";
import { PURGED_TABLES, findServerByPublicId, softDeleteServer, upsertConfiguredServer } from "./repositories/serverRepository.js";
import { randomBytes } from "node:crypto";
import { Mutex } from "../../platform/mutex.js";
import { createSecretsKeyring } from "../../platform/secrets/secrets.js";
import { releaseAgentServer } from "../agents/services/releaseAgent.js";
import { createServerManagementService } from "./serverManagement.js";
import { ServerRuntime } from "./serverRuntime.js";
import { addUnlessRemoved } from "./runtimeGuard.js";
import { createPendingServerSweeper } from "./pendingServerSweeper.js";
import { NOT_SELF_SERVE, createSelfServeService } from "./selfServe.js";
import type { SelfServeDeps } from "./selfServe.js";

// #526 (ADR-0046 task 4) against a real Postgres: the owner's rename and remove, the caps by creator, C5 from the rows, and
// the C4 pending-server sweep.
const available = dbTestsAvailable();
const silent = createLogger({ level: "silent" }, { write: () => {} });

describe.skipIf(!available)("self-serve owner actions, creator caps and the pending sweep (database)", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let admin: pg.Pool;
  let n = 0;

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 10 });
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.end();
    await db?.drop();
  });

  const user = async () => (await createUser(pool, { displayName: `owner-${++n}` })).id;
  const runtime = () => ({ rename: vi.fn(() => true), remove: vi.fn(async () => true) });
  const service = (caps: Partial<SelfServeDeps["config"]> = {}, extra: Partial<SelfServeDeps> = {}) =>
    createSelfServeService({
      db: pool,
      config: { maxServersPerAccount: 2, maxServersTotal: 1000, maxPendingPerAccount: 2, createsPerDay: 100, ...caps },
      isOperator: () => false,
      enrolledServerIds,
      attachRuntime: async () => {},
      runtime: runtime(),
      ...extra,
    });
  const failureOf = async (p: Promise<unknown>): Promise<unknown> => p.then(() => undefined, (err: unknown) => err);
  const uuidOf = async (publicId: string) =>
    ((await admin.query("SELECT id FROM servers.servers WHERE public_id = $1", [publicId])).rows[0] as { id: string }).id;
  const row = async (publicId: string) =>
    (await admin.query("SELECT display_name, deleted_at, created_by_user_id::text AS creator FROM servers.servers WHERE public_id = $1", [publicId]))
      .rows[0] as { display_name: string | null; deleted_at: Date | null; creator: string | null };
  const auditOf = async (serverUuid: string) =>
    (await admin.query("SELECT action, actor_user_id::text AS actor, detail FROM audit.audit_events WHERE server_id = $1 ORDER BY id", [serverUuid])).rows as {
      action: string;
      actor: string | null;
      detail: Record<string, unknown>;
    }[];
  const enrol = async (serverUuid: string) =>
    admin.query("INSERT INTO agents.agent_credentials (server_id, secret_hash, agent_version) VALUES ($1, decode(md5(random()::text) || md5(random()::text), 'hex'), '0.1.0')", [serverUuid]);
  const ageBy = async (publicId: string, interval: string) =>
    admin.query(`UPDATE servers.servers SET created_at = now() - interval '${interval}' WHERE public_id = $1`, [publicId]);

  describe("the owner's rename", () => {
    it("renames their self-serve server, audits the field name only, and renames the runtime entry", async () => {
      const owner = await user();
      const rt = runtime();
      const svc = service({}, { runtime: rt });
      const created = await svc.create(owner, { displayName: "Before" });
      await expect(svc.renameAsOwner(owner, created.id, "Private New Name")).resolves.toEqual({ id: created.id, displayName: "Private New Name", kind: "agent" });
      expect((await row(created.id)).display_name).toBe("Private New Name");
      expect(rt.rename).toHaveBeenCalledWith(created.id, "Private New Name");
      const audit = await auditOf(await uuidOf(created.id));
      expect(audit.at(-1)).toEqual({ action: "server.updated", actor: owner, detail: { fields: ["displayName"] } });
      expect(JSON.stringify(audit)).not.toContain("Private");
    });

    it("refuses an admin or viewer of it (403) and an unknown or removed server (404), changing nothing", async () => {
      const owner = await user();
      const helper = await user();
      const svc = service();
      const created = await svc.create(owner, { displayName: "Kept" });
      await addMember(pool, { serverId: await uuidOf(created.id), userId: helper, role: "admin", actorUserId: null });
      expect(await failureOf(svc.renameAsOwner(helper, created.id, "Taken"))).toBeInstanceOf(ForbiddenError);
      expect(await failureOf(svc.renameAsOwner(await user(), created.id, "Taken"))).toBeInstanceOf(ForbiddenError);
      expect(await failureOf(svc.renameAsOwner(owner, "no-such-server", "Taken"))).toBeInstanceOf(ServerNotFoundError);
      expect((await row(created.id)).display_name).toBe("Kept");
    });

    it("leaves an operator-created server to the operator rule: NOT_SELF_SERVE, nothing written", async () => {
      const owner = await user();
      const operatorServer = await upsertConfiguredServer(pool, { publicId: `op-rename-${++n}`, displayName: "Op" });
      await addMember(pool, { serverId: operatorServer.id, userId: owner, role: "owner", actorUserId: null });
      const before = (await auditOf(operatorServer.id)).length;
      await expect(service().renameAsOwner(owner, operatorServer.publicId, "Mine now")).resolves.toBe(NOT_SELF_SERVE);
      expect((await row(operatorServer.publicId)).display_name).toBe("Op");
      expect(await auditOf(operatorServer.id)).toHaveLength(before);
    });
  });

  describe("the owner's remove", () => {
    it("purges everything the soft delete clears (the credential included), audits ids only, drops the runtime entry, and never revives the id", async () => {
      const owner = await user();
      const rt = runtime();
      const svc = service({}, { runtime: rt });
      const created = await svc.create(owner, { displayName: "Doomed" });
      const uuid = await uuidOf(created.id);
      await enrol(uuid);
      await admin.query("INSERT INTO map.world_layers (server_id, layer, hash, observed_at, truncated, count, data) VALUES ($1, 'rails', 'h', now(), false, 1, '[]'::jsonb)", [uuid]);
      await admin.query("INSERT INTO alerts.push_optins (server_id, user_id) VALUES ($1, $2)", [uuid, owner]);

      await expect(svc.removeAsOwner(owner, created.id)).resolves.toBe("removed");
      expect((await row(created.id)).deleted_at).not.toBeNull();
      // ADR-0047 amendment: the owner's remove clears the name too.
      expect((await row(created.id)).display_name).toBeNull();
      for (const table of [...PURGED_TABLES, "servers.server_members", "servers.server_connections"]) {
        expect((await admin.query(`SELECT 1 FROM ${table} WHERE server_id = $1`, [uuid])).rowCount, table).toBe(0);
      }
      expect(rt.remove).toHaveBeenCalledWith(created.id);
      expect((await auditOf(uuid)).filter((e) => e.action === "server.deleted")).toEqual([{ action: "server.deleted", actor: owner, detail: { reason: "owner_removed" } }]);
      expect(JSON.stringify(await auditOf(uuid))).not.toContain("Doomed");
      // Gone for the owner, and a second remove is a 404.
      expect(await getMemberRole(pool, { publicId: created.id, userId: owner })).toBeUndefined();
      expect(await failureOf(svc.removeAsOwner(owner, created.id))).toBeInstanceOf(ServerNotFoundError);
      // A self-serve create can never revive it (plain INSERT, unique violation).
      expect(await failureOf(service({}, { generateId: () => created.id }).create(await user(), { displayName: "Again" }))).toMatchObject({ code: "23505" });
    });

    it("refuses an admin of it (403); an operator server is NOT_SELF_SERVE and stays", async () => {
      const owner = await user();
      const helper = await user();
      const svc = service();
      const created = await svc.create(owner, { displayName: "Stays" });
      await addMember(pool, { serverId: await uuidOf(created.id), userId: helper, role: "admin", actorUserId: null });
      expect(await failureOf(svc.removeAsOwner(helper, created.id))).toBeInstanceOf(ForbiddenError);
      expect((await row(created.id)).deleted_at).toBeNull();

      const operatorServer = await upsertConfiguredServer(pool, { publicId: `op-remove-${++n}`, displayName: "Op" });
      await addMember(pool, { serverId: operatorServer.id, userId: owner, role: "owner", actorUserId: null });
      await expect(svc.removeAsOwner(owner, operatorServer.publicId)).resolves.toBe(NOT_SELF_SERVE);
      expect((await row(operatorServer.publicId)).deleted_at).toBeNull();
    });

    it("frees the creator's C1 slot", async () => {
      const owner = await user();
      const svc = service({ maxServersPerAccount: 1, maxPendingPerAccount: 1 });
      const first = await svc.create(owner, { displayName: "One" });
      expect(await failureOf(svc.create(owner, { displayName: "Two" }))).toMatchObject({ code: "server_limit_reached" });
      await svc.removeAsOwner(owner, first.id);
      await svc.create(owner, { displayName: "Two" });
    });
  });

  describe("caps by creator (#525's security review)", () => {
    it("records the creator, and a transfer of ownership does not free the creator's C1 or C3 slot", async () => {
      const creator = await user();
      const other = await user();
      const svc = service({ maxServersPerAccount: 2, maxPendingPerAccount: 1 });
      const created = await svc.create(creator, { displayName: "Handed over" });
      expect((await row(created.id)).creator).toBe(creator);
      const uuid = await uuidOf(created.id);
      await addMember(pool, { serverId: uuid, userId: other, role: "admin", actorUserId: null });
      expect(await transferOwnership(pool, { serverId: uuid, fromUserId: creator, toUserId: other })).toBe("transferred");
      // C3: the pending server still counts for its creator, though someone else owns it now.
      const pending = await failureOf(svc.create(creator, { displayName: "Next" }));
      expect(pending).toBeInstanceOf(ApiFailure);
      expect((pending as ApiFailure).code).toBe("server_limit_reached");
      // C1 too, once it has enrolled.
      await enrol(uuid);
      await svc.create(creator, { displayName: "Second" });
      expect(await failureOf(svc.create(creator, { displayName: "Third" }))).toMatchObject({ code: "server_limit_reached" });
      // The new owner did not create it, so it uses none of their slots.
      await svc.create(other, { displayName: "Their own" });
    });

    it("the migration's back-fill takes the `server.created` actor first, then the current owner", async () => {
      const creator = await user();
      const svc = service();
      const byAudit = await svc.create(creator, { displayName: "Audit" });
      const byOwner = await svc.create(await user(), { displayName: "Owner" });
      const ownerOfSecond = (await admin.query("SELECT user_id::text AS u FROM servers.server_members m JOIN servers.servers s ON s.id = m.server_id WHERE s.public_id = $1", [byOwner.id])).rows[0] as { u: string };
      // As before the column existed: no creator, and for the second no `server.created` row either (the trail is
      // append-only for the app role, so this uses the migrator's connection, as the migration does).
      await admin.query("UPDATE servers.servers SET created_by_user_id = NULL WHERE public_id = ANY($1)", [[byAudit.id, byOwner.id]]);
      await admin.query("DELETE FROM audit.audit_events WHERE server_id = $1 AND action = 'server.created'", [await uuidOf(byOwner.id)]);
      const file = fileURLToPath(new URL("../../../migrations/1791676800000_self_serve_creator.sql", import.meta.url));
      const backfill = /UPDATE servers\.servers s[\s\S]*?;/.exec(readFileSync(file, "utf8"))![0];
      await admin.query(backfill);
      expect((await row(byAudit.id)).creator).toBe(creator);
      expect((await row(byOwner.id)).creator).toBe(ownerOfSecond.u);
    });
  });

  describe("C5 from the rows (#525's security review)", () => {
    it("counts creations in the last 24 hours, removed ones included, across a restart (a new service instance)", async () => {
      const owner = await user();
      const first = service({ createsPerDay: 2, maxServersPerAccount: 1, maxPendingPerAccount: 1 });
      // Create and remove twice: C1 never blocks, only the churn is counted.
      for (let i = 0; i < 2; i++) {
        const created = await first.create(owner, { displayName: `Churn ${i}` });
        await first.removeAsOwner(owner, created.id);
      }
      const restarted = service({ createsPerDay: 2, maxServersPerAccount: 1, maxPendingPerAccount: 1 });
      const refused = await failureOf(restarted.create(owner, { displayName: "Third" }));
      expect(refused).toBeInstanceOf(RateLimitedError);
      expect((refused as RateLimitedError).retryAfterSeconds).toBeGreaterThan(23 * 3600);
      expect((refused as RateLimitedError).retryAfterSeconds).toBeLessThanOrEqual(24 * 3600);
      // Another account has its own allowance.
      await restarted.create(await user(), { displayName: "Someone else" });
      // Creations older than 24 hours leave the window.
      await admin.query("UPDATE servers.servers SET created_at = now() - interval '25 hours' WHERE created_by_user_id = $1", [owner]);
      await restarted.create(owner, { displayName: "Next day" });
    });

    it("Retry-After is when a slot frees, not when the oldest creation leaves (more rows than the limit, e.g. after the limit was lowered)", async () => {
      const owner = await user();
      const wide = service({ createsPerDay: 5, maxServersPerAccount: 10, maxPendingPerAccount: 10 });
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) ids.push((await wide.create(owner, { displayName: `S${i}` })).id);
      await ageBy(ids[0]!, "23 hours");
      await ageBy(ids[1]!, "12 hours");
      // Limit now 2: three rows in the window. A slot frees when only ONE row remains, i.e. when the middle one (12 h old) leaves.
      const narrow = service({ createsPerDay: 2, maxServersPerAccount: 10, maxPendingPerAccount: 10 });
      const refused = (await failureOf(narrow.create(owner, { displayName: "More" }))) as RateLimitedError;
      expect(refused).toBeInstanceOf(RateLimitedError);
      expect(refused.retryAfterSeconds).toBeGreaterThan(11.9 * 3600);
      expect(refused.retryAfterSeconds).toBeLessThanOrEqual(12 * 3600);
    });

    it("a refused create (a cap) is not counted: no row is written", async () => {
      const owner = await user();
      const svc = service({ createsPerDay: 2, maxServersPerAccount: 1, maxPendingPerAccount: 1 });
      const created = await svc.create(owner, { displayName: "One" });
      for (let i = 0; i < 3; i++) expect(await failureOf(svc.create(owner, { displayName: "Refused" }))).toMatchObject({ code: "server_limit_reached" });
      await svc.removeAsOwner(owner, created.id);
      await svc.create(owner, { displayName: "Two" });
    });
  });

  describe("runtime races (#526 security review L1, L2)", () => {
    const ring = createSecretsKeyring("k1", new Map([["k1", randomBytes(32)]]));
    const management = (operatorId: string, mutex: Mutex, runtime: ServerRuntime<string>) =>
      createServerManagementService({
        db: pool,
        ring,
        runtime,
        build: (c) => ({ id: c.publicId, displayName: c.displayName, services: "polled", workers: [] }),
        testConnection: async () => ({ ok: true, api: { ok: true }, frm: { ok: true } }),
        getOperatorUserId: () => operatorId,
        lookup: async () => ["127.0.0.1"],
        mutex,
        releaseAgent: releaseAgentServer,
      });
    const localBody = { host: "localhost", apiPort: 7777, frmPort: 8080, apiToken: "api-token-abcdefgh1234", frmToken: "frm-token-abcdefgh5678" };

    it("L1: the operator cannot switch a self-serve server to local (agent-only), even one they own; nothing changes", async () => {
      const operatorId = await user();
      const runtime = new ServerRuntime<string>();
      const created = await service({}, { isOperator: (id) => id === operatorId }).create(operatorId, { displayName: "Mine" });
      runtime.add({ id: created.id, displayName: "Mine", services: "agent", workers: [], kind: "agent" });
      const err = await failureOf(management(operatorId, new Mutex(), runtime).switchToLocal(operatorId, created.id, localBody));
      expect(err).toBeInstanceOf(ForbiddenError);
      const uuid = await uuidOf(created.id);
      expect((await admin.query("SELECT connection_kind FROM servers.servers WHERE id = $1", [uuid])).rows[0]).toEqual({ connection_kind: "agent" });
      expect((await admin.query("SELECT 1 FROM servers.server_connections WHERE server_id = $1", [uuid])).rowCount).toBe(0);
      expect(runtime.get(created.id)).toBe("agent");
    });

    it("L1: the owner's remove waits for the shared management mutex, so it never interleaves with an operator change", async () => {
      const owner = await user();
      const mutex = new Mutex();
      const svc = service({}, { mutex });
      const created = await svc.create(owner, { displayName: "Waits" });
      let release!: () => void;
      const held = mutex.run(() => new Promise<void>((resolve) => (release = resolve)));
      const removing = svc.removeAsOwner(owner, created.id);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect((await row(created.id)).deleted_at).toBeNull(); // still queued behind the held mutex
      release();
      await held;
      await expect(removing).resolves.toBe("removed");
      expect((await row(created.id)).deleted_at).not.toBeNull();
    });

    it("L2: a server removed while its post-commit attach runs is left with no runtime entry; a live one keeps its entry", async () => {
      const owner = await user();
      const runtime = new ServerRuntime<string>();
      const isLive = async (id: string) => (await findServerByPublicId(pool, id)) !== undefined;
      const attach = (removeFirst: boolean) => async (publicId: string) => {
        await addUnlessRemoved({
          publicId,
          runtime,
          add: async () => {
            // The removal commits (and its own runtime remove finds nothing yet) before the attach adds the entry.
            if (removeFirst) {
              await softDeleteServer(pool, publicId);
              await runtime.remove(publicId);
            }
            await runtime.replace({ id: publicId, displayName: "X", services: "agent", workers: [], kind: "agent" });
          },
          isLive,
        });
      };
      const errors: unknown[] = [];
      const onAttachError = (_id: string, err: unknown) => errors.push(err);
      const removed = await service({}, { attachRuntime: attach(true), onAttachError }).create(owner, { displayName: "Racing" });
      expect(runtime.get(removed.id)).toBeUndefined();
      const live = await service({}, { attachRuntime: attach(false), onAttachError }).create(await user(), { displayName: "Live" });
      expect(runtime.get(live.id)).toBe("agent");
      expect(errors).toEqual([]); // the entry was added and then removed by the guard, not skipped by a failure
    });

    it("L2: without the guard the same race leaves the deleted server's entry behind (what the guard fixes)", async () => {
      const runtime = new ServerRuntime<string>();
      const created = await service({}, {
        attachRuntime: async (publicId) => {
          await softDeleteServer(pool, publicId);
          await runtime.remove(publicId);
          await runtime.replace({ id: publicId, displayName: "X", services: "agent", workers: [], kind: "agent" });
        },
      }).create(await user(), { displayName: "Unguarded" });
      expect(runtime.get(created.id)).toBe("agent");
    });
  });

  describe("the C4 pending sweep", () => {
    const sweeper = (extra: { batchSize?: number; removeRuntime?: (id: string) => Promise<unknown> } = {}) => {
      const counters: { metric: string; amount: number }[] = [];
      const sweep = createPendingServerSweeper({
        db: pool,
        logger: silent,
        ttlHours: 24,
        enrolledServerIds,
        removeRuntime: extra.removeRuntime ?? (async () => true),
        batchSize: extra.batchSize,
        metrics: { recordHistogram: () => {}, recordCounter: (metric, _labels, amount) => counters.push({ metric, amount: amount ?? 1 }) },
      });
      return { sweep, counters };
    };
    /** Removes the older pending servers other tests left, so each sweep test sees only its own candidates. */
    const clearOlderPending = () => admin.query("UPDATE servers.servers SET created_at = now() WHERE created_via = 'self_serve' AND deleted_at IS NULL");

    it("removes a never-enrolled self-serve server just past the TTL and keeps one just inside it", async () => {
      await clearOlderPending();
      const svc = service();
      const inside = await svc.create(await user(), { displayName: "Inside" });
      const past = await svc.create(await user(), { displayName: "Past" });
      await ageBy(inside.id, "24 hours - 1 minute");
      await ageBy(past.id, "24 hours 1 minute");
      const removed: string[] = [];
      const { sweep, counters } = sweeper({ removeRuntime: async (id) => removed.push(id) });
      await expect(sweep.sweep()).resolves.toEqual({ swept: 1, skipped: 0 });
      expect((await row(inside.id)).deleted_at).toBeNull();
      expect((await row(past.id)).deleted_at).not.toBeNull();
      // ADR-0047 amendment: the sweep clears the removed server's name; the kept one keeps its own.
      expect((await row(past.id)).display_name).toBeNull();
      expect((await row(inside.id)).display_name).toBe("Inside");
      expect(removed).toEqual([past.id]);
      expect(counters).toEqual([{ metric: "satis.servers.pending_swept", amount: 1 }]);
      const uuid = await uuidOf(past.id);
      expect((await auditOf(uuid)).filter((e) => e.action === "server.deleted")).toEqual([{ action: "server.deleted", actor: null, detail: { reason: "never_enrolled" } }]);
      for (const table of [...PURGED_TABLES, "servers.server_members"]) {
        expect((await admin.query(`SELECT 1 FROM ${table} WHERE server_id = $1`, [uuid])).rowCount, table).toBe(0);
      }
      // Idempotent: nothing left to do.
      await expect(sweep.sweep()).resolves.toEqual({ swept: 0, skipped: 0 });
      expect(counters).toHaveLength(1);
    });

    it("never sweeps a server that has enrolled (revoked or not) or an operator-created one, however old", async () => {
      await clearOlderPending();
      const svc = service();
      const enrolled = await svc.create(await user(), { displayName: "Enrolled" });
      const revoked = await svc.create(await user(), { displayName: "Revoked" });
      await enrol(await uuidOf(enrolled.id));
      await enrol(await uuidOf(revoked.id));
      await admin.query("UPDATE agents.agent_credentials SET revoked_at = now() WHERE server_id = $1", [await uuidOf(revoked.id)]);
      const operatorServer = await upsertConfiguredServer(pool, { publicId: `op-old-${++n}`, displayName: "Op" });
      await admin.query("UPDATE servers.servers SET connection_kind = 'agent' WHERE id = $1", [operatorServer.id]);
      for (const id of [enrolled.id, revoked.id, operatorServer.publicId]) await ageBy(id, "30 days");
      await expect(sweeper().sweep.sweep()).resolves.toEqual({ swept: 0, skipped: 0 });
      for (const id of [enrolled.id, revoked.id, operatorServer.publicId]) expect((await row(id)).deleted_at).toBeNull();
    });

    it("re-checks under the row lock: a candidate that enrolled after it was listed is skipped", async () => {
      await clearOlderPending();
      const created = await service().create(await user(), { displayName: "Late enrol" });
      await ageBy(created.id, "25 hours");
      const uuid = await uuidOf(created.id);
      // The agents check runs inside the sweep's transaction, after the lock: enrol just before it answers.
      const sweep = createPendingServerSweeper({
        db: pool,
        logger: silent,
        ttlHours: 24,
        enrolledServerIds: async (client, ids) => {
          await enrol(uuid);
          return enrolledServerIds(client, ids);
        },
        removeRuntime: async () => true,
        metrics: { recordHistogram: () => {}, recordCounter: () => {} },
      });
      await expect(sweep.sweep()).resolves.toEqual({ swept: 0, skipped: 1 });
      expect((await row(created.id)).deleted_at).toBeNull();
    });

    it("is bounded per run, oldest first", async () => {
      await clearOlderPending();
      const svc = service();
      const older = await svc.create(await user(), { displayName: "Older" });
      const newer = await svc.create(await user(), { displayName: "Newer" });
      await ageBy(older.id, "3 days");
      await ageBy(newer.id, "2 days");
      const { sweep } = sweeper({ batchSize: 1 });
      await expect(sweep.sweep()).resolves.toEqual({ swept: 1, skipped: 0 });
      expect((await row(older.id)).deleted_at).not.toBeNull();
      expect((await row(newer.id)).deleted_at).toBeNull();
      await expect(sweep.sweep()).resolves.toEqual({ swept: 1, skipped: 0 });
      expect((await row(newer.id)).deleted_at).not.toBeNull();
    });
  });
});
