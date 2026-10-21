import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../test-support/testDb.js";
import type { TestDatabase } from "../../../test-support/testDb.js";
import { ApiFailure } from "../../platform/errorResponse.js";
import { createLogger } from "../../platform/logger.js";
import { UserRateLimiter } from "../../platform/userRateLimiter.js";
import { createUser } from "../identity/repositories/userRepository.js";
import { enrolledServerIds } from "../agents/index.js";
import { createAgentsService } from "../agents/services/agentsService.js";
import { createEnrollmentService } from "../agents/services/enrollmentService.js";
import { addMember, getMemberRole } from "./repositories/memberRepository.js";
import {
  countSelfServeServers,
  findServerByPublicId,
  listAgentServers,
  listOperatorAgentServers,
  softDeleteServer,
  upsertConfiguredServer,
} from "./repositories/serverRepository.js";
import { listServersAdmin } from "./serverAdmin.js";
import { createSelfServeService } from "./selfServe.js";
import type { SelfServeDeps } from "./selfServe.js";

// ADR-0046 (#525): self-serve creation against a real Postgres: the caps under the management lock, the plain INSERT, the
// owner in the same transaction, the audit row, and the database trigger that refuses an ownerless self-serve server.
const available = dbTestsAvailable();
const silent = createLogger({ level: "silent" }, { write: () => {} });
const OWNERLESS = { code: "23514", constraint: "servers_self_serve_has_owner", message: "ownerless_server" };

describe.skipIf(!available)("self-serve agent servers (database)", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let admin: pg.Pool;
  let operator: string;
  let n = 0;
  const attached: string[] = [];

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 10 });
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
    operator = (await createUser(pool, { displayName: "operator" })).id;
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.end();
    await db?.drop();
  });

  const user = async () => (await createUser(pool, { displayName: `player-${++n}` })).id;
  const total = () => countSelfServeServers(pool);
  const service = (caps: Partial<SelfServeDeps["config"]> = {}, extra: Partial<SelfServeDeps> = {}) =>
    createSelfServeService({
      db: pool,
      config: { maxServersPerAccount: 2, maxServersTotal: 1000, maxPendingPerAccount: 1, createsPerDay: 100, ...caps },
      isOperator: (id) => id === operator,
      enrolledServerIds,
      attachRuntime: async (publicId) => {
        attached.push(publicId);
      },
      runtime: { rename: () => true, remove: async () => true },
      ...extra,
    });
  const create = (svc: ReturnType<typeof service>, actor: string, displayName = `World ${++n}`) => svc.create(actor, { displayName });
  const failureOf = async (p: Promise<unknown>): Promise<unknown> => p.then(() => undefined, (err: unknown) => err);
  const codeOf = (err: unknown) => (err instanceof ApiFailure ? err.code : String(err));
  const row = async (publicId: string) =>
    (await admin.query("SELECT id, connection_kind, created_via, deleted_at FROM servers.servers WHERE public_id = $1", [publicId])).rows[0] as
      | { id: string; connection_kind: string; created_via: string; deleted_at: Date | null }
      | undefined;
  /** Marks a server as enrolled the way enrolment does: a credential row (no real secret needed here). */
  const enrol = async (serverUuid: string) =>
    admin.query("INSERT INTO agents.agent_credentials (server_id, secret_hash, agent_version) VALUES ($1, decode(md5(random()::text) || md5(random()::text), 'hex'), '0.1.0')", [serverUuid]);

  describe("create", () => {
    it("creates an `agent`, `self_serve` server with a generated 20-character id, the caller as owner, one audit row (ids only), then attaches its runtime", async () => {
      const owner = await user();
      const created = await create(service(), owner, "Secret Name Of My World");
      expect(created).toMatchObject({ displayName: "Secret Name Of My World", kind: "agent" });
      expect(created.id).toMatch(/^[a-z2-7]{20}$/);
      const stored = await row(created.id);
      expect(stored).toMatchObject({ connection_kind: "agent", created_via: "self_serve", deleted_at: null });
      expect(await getMemberRole(pool, { publicId: created.id, userId: owner })).toBe("owner");
      // No host and no tokens: an agent server has no connection row.
      expect((await admin.query("SELECT 1 FROM servers.server_connections WHERE server_id = $1", [stored!.id])).rowCount).toBe(0);
      const audit = (await admin.query("SELECT action, actor_user_id::text AS actor, detail FROM audit.audit_events WHERE server_id = $1 ORDER BY id", [stored!.id])).rows;
      // The membership's own row (written by addMember) and the create's, in one transaction.
      expect(audit).toEqual([
        { action: "member_added", actor: null, detail: { role: "owner", userId: owner } },
        { action: "server.created", actor: owner, detail: { via: "self_serve" } },
      ]);
      // No personal data: ids and codes only, never the display name.
      expect(JSON.stringify(audit)).not.toContain("Secret");
      expect(attached).toContain(created.id);
    });

    it("reports a failed runtime attach instead of failing the create (the server exists; its first snapshot attaches it)", async () => {
      const reported: string[] = [];
      const svc = service({}, { attachRuntime: async () => Promise.reject(new Error("no")), onAttachError: (id) => reported.push(id) });
      const created = await create(svc, await user());
      expect(reported).toEqual([created.id]);
      expect(await findServerByPublicId(pool, created.id)).toBeDefined();
    });

    it("a failure after the INSERT leaves no server behind (one transaction)", async () => {
      const before = await total();
      const ghost = randomUUID(); // no such account: the owner membership fails after the server row is inserted
      const err = await failureOf(create(service(), ghost, "Ghost world"));
      expect(err).toBeInstanceOf(Error);
      expect(await total()).toBe(before);
      expect((await admin.query("SELECT 1 FROM servers.servers WHERE display_name = 'Ghost world'")).rowCount).toBe(0);
    });

    it("never revives a removed server's id: a generated id that exists (even soft-deleted) is refused, and the old row stays removed", async () => {
      const owner = await user();
      const first = await create(service(), owner);
      expect(await softDeleteServer(pool, first.id)).toBe(true);
      const before = await total();
      const err = await failureOf(create(service({}, { generateId: () => first.id }), await user()));
      expect(err).toMatchObject({ code: "23505" }); // a unique violation from the plain INSERT, never an upsert
      expect((await row(first.id))!.deleted_at).not.toBeNull();
      expect((await admin.query("SELECT 1 FROM servers.server_members m JOIN servers.servers s ON s.id = m.server_id WHERE s.public_id = $1", [first.id])).rowCount).toBe(0);
      expect(await total()).toBe(before);
      // An operator-created removed id is not revived either.
      const operatorServer = await upsertConfiguredServer(pool, { publicId: `op-removed-${++n}`, displayName: "Old" });
      await softDeleteServer(pool, operatorServer.publicId);
      expect(await failureOf(create(service({}, { generateId: () => operatorServer.publicId }), await user()))).toMatchObject({ code: "23505" });
      expect((await row(operatorServer.publicId))!.deleted_at).not.toBeNull();
    });

    it("an operator path that revives a removed self-serve id makes it an operator server", async () => {
      const created = await create(service(), await user());
      await softDeleteServer(pool, created.id);
      await upsertConfiguredServer(pool, { publicId: created.id, displayName: "Operator's now" });
      expect((await row(created.id))!.created_via).toBe("operator");
    });
  });

  describe("caps", () => {
    it("C1: n servers per account allowed, the n+1th refused with server_limit_reached", async () => {
      const owner = await user();
      const svc = service({ maxServersPerAccount: 3, maxPendingPerAccount: 3 });
      for (let i = 0; i < 3; i++) await create(svc, owner);
      expect(codeOf(await failureOf(create(svc, owner)))).toBe("server_limit_reached");
      // A removed server frees its slot.
      const [oldest] = (await admin.query("SELECT s.public_id FROM servers.servers s JOIN servers.server_members m ON m.server_id = s.id WHERE m.user_id = $1 ORDER BY s.created_at LIMIT 1", [owner])).rows as { public_id: string }[];
      await softDeleteServer(pool, oldest!.public_id);
      await create(svc, owner);
    });

    it("C3: n never-enrolled servers per account allowed, the n+1th refused naming the pending one; enrolling frees it", async () => {
      const owner = await user();
      const svc = service({ maxServersPerAccount: 2, maxPendingPerAccount: 1 });
      const first = await create(svc, owner, "Pending One");
      const refused = await failureOf(create(svc, owner));
      expect(codeOf(refused)).toBe("server_limit_reached");
      expect((refused as Error).message).toContain('"Pending One"');
      await enrol((await row(first.id))!.id);
      await create(svc, owner);
    });

    it("C3 counts a revoked credential as enrolled (ever enrolled, not online)", async () => {
      const owner = await user();
      const svc = service({ maxServersPerAccount: 2, maxPendingPerAccount: 1 });
      const first = await create(svc, owner);
      const uuid = (await row(first.id))!.id;
      await enrol(uuid);
      await admin.query("UPDATE agents.agent_credentials SET revoked_at = now() WHERE server_id = $1", [uuid]);
      await create(svc, owner);
    });

    it("C2: n live self-serve servers in total allowed, the n+1th refused, whoever asks", async () => {
      const cap = (await total()) + 2;
      const svc = service({ maxServersTotal: cap });
      await create(svc, await user());
      await create(svc, await user());
      const refused = await failureOf(create(svc, await user()));
      expect(codeOf(refused)).toBe("server_limit_reached");
      expect((refused as Error).message).toMatch(/full/);
    });

    it("an operator-created server is counted by neither C1 nor C2", async () => {
      const owner = await user();
      const operatorServer = await upsertConfiguredServer(pool, { publicId: `op-owned-${++n}`, displayName: "Operator's" });
      await admin.query("UPDATE servers.servers SET connection_kind = 'agent' WHERE id = $1", [operatorServer.id]);
      const before = await total();
      await addMember(pool, { serverId: operatorServer.id, userId: owner, role: "owner", actorUserId: null });
      expect(await total()).toBe(before);
      // C1 = 1: the operator server this account owns does not use the slot, and C2 = before + 1 is still open.
      await create(service({ maxServersPerAccount: 1, maxPendingPerAccount: 1, maxServersTotal: before + 1 }), owner);
    });

    it("the operator's account is exempt from C1, C2 and C3", async () => {
      const full = await total();
      const svc = service({ maxServersPerAccount: 1, maxPendingPerAccount: 1, maxServersTotal: Math.max(full, 1) });
      for (let i = 0; i < 3; i++) await create(svc, operator);
      expect(await total()).toBe(full + 3);
    });

    it("concurrent creates by one account cannot pass C1 (or C3) together", async () => {
      const owner = await user();
      const svc = service({ maxServersPerAccount: 2, maxPendingPerAccount: 2 });
      const results = await Promise.allSettled(Array.from({ length: 6 }, () => create(svc, owner)));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
      for (const r of results.filter((x) => x.status === "rejected")) expect(codeOf((r as PromiseRejectedResult).reason)).toBe("server_limit_reached");
      const pendingOnly = service({ maxServersPerAccount: 2, maxPendingPerAccount: 1 });
      const other = await user();
      const pending = await Promise.allSettled(Array.from({ length: 4 }, () => create(pendingOnly, other)));
      expect(pending.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    });

    it("concurrent creates by many accounts cannot pass C2 together", async () => {
      const cap = (await total()) + 2;
      const svc = service({ maxServersTotal: cap });
      const players = await Promise.all(Array.from({ length: 6 }, () => user()));
      const results = await Promise.allSettled(players.map((p) => create(svc, p)));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
      expect(await total()).toBe(cap);
    });
  });

  describe("the database trigger (#311's rule for a new self-serve server)", () => {
    const insertSelfServe = (client: pg.Pool | pg.PoolClient, publicId: string) =>
      client.query("INSERT INTO servers.servers (public_id, display_name, connection_kind, created_via) VALUES ($1, 'T', 'agent', 'self_serve') RETURNING id", [publicId]);

    it("refuses a self-serve server committed with no owner, and leaves nothing", async () => {
      const publicId = `trig-${++n}`;
      await expect(insertSelfServe(pool, publicId)).rejects.toMatchObject(OWNERLESS);
      expect(await row(publicId)).toBeUndefined();
      // An admin or viewer is not an owner.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await insertSelfServe(client, `trig-${++n}`);
        await addMember(client, { serverId: (rows[0] as { id: string }).id, userId: await user(), role: "admin", actorUserId: null });
        await expect(client.query("COMMIT")).rejects.toMatchObject(OWNERLESS);
      } finally {
        client.release();
      }
    });

    it("allows the commit once the owner is added in the same transaction, and a server removed in it", async () => {
      const owner = await user();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await insertSelfServe(client, `trig-${++n}`);
        await addMember(client, { serverId: (rows[0] as { id: string }).id, userId: owner, role: "owner", actorUserId: null });
        await client.query("COMMIT");
        await client.query("BEGIN");
        await insertSelfServe(client, `trig-${++n}`);
        await client.query("UPDATE servers.servers SET deleted_at = now() WHERE public_id = $1", [`trig-${n}`]);
        await client.query("COMMIT");
      } finally {
        client.release();
      }
    });

    it("leaves operator-created servers exempt (the startup seed gives them an owner)", async () => {
      const publicId = `trig-op-${++n}`;
      await pool.query("INSERT INTO servers.servers (public_id, display_name) VALUES ($1, 'Op')", [publicId]);
      expect((await row(publicId))!.created_via).toBe("operator");
    });

    it("refuses a created_via outside the two values", async () => {
      await expect(pool.query("INSERT INTO servers.servers (public_id, display_name, created_via) VALUES ($1, 'X', 'player')", [`bad-${++n}`])).rejects.toMatchObject({ code: "23514" });
    });
  });

  describe("after the create", () => {
    it("the owner gets an enrolment code through the existing agent settings, and enrols; the server stays self-serve", async () => {
      const owner = await user();
      const created = await create(service(), owner);
      // canManage false: the owner is not the operator; an agent server's code is the owner's or admin's to create.
      const agents = createAgentsService({ db: pool, canManage: () => false, limiter: new UserRateLimiter({ max: 100, windowMs: 60_000 }) });
      const { code } = await agents.createEnrollmentCode(created.id, owner);
      expect(code).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
      const enrollment = createEnrollmentService({
        db: pool,
        cadence: () => ({ statusSeconds: 5, powerSeconds: 5, factorySeconds: 30 }),
        logger: silent,
        attachAgentRuntime: async () => {},
      });
      await expect(enrollment.enroll(code, "0.1.0")).resolves.toMatchObject({ serverId: created.id });
      expect(await row(created.id)).toMatchObject({ connection_kind: "agent", created_via: "self_serve" });
      expect(await enrolledServerIds(pool, [(await row(created.id))!.id])).toEqual(new Set([(await row(created.id))!.id]));
    });

    it("the managed list shows operator-created agent servers only; the startup load and list-servers see every one", async () => {
      const created = await create(service(), await user());
      const operatorAgent = await upsertConfiguredServer(pool, { publicId: `op-agent-${++n}`, displayName: "Op agent" });
      await admin.query("UPDATE servers.servers SET connection_kind = 'agent' WHERE id = $1", [operatorAgent.id]);
      const managed = (await listOperatorAgentServers(pool)).map((s) => s.publicId);
      expect(managed).toContain(operatorAgent.publicId);
      expect(managed).not.toContain(created.id);
      const loaded = (await listAgentServers(pool)).map((s) => s.publicId);
      expect(loaded).toEqual(expect.arrayContaining([created.id, operatorAgent.publicId]));
      const adminRows = await listServersAdmin(pool);
      expect(adminRows.find((r) => r.publicId === created.id)?.createdVia).toBe("self_serve");
      expect(adminRows.find((r) => r.publicId === operatorAgent.publicId)?.createdVia).toBe("operator");
    });
  });
});
