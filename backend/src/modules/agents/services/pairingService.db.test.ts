import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../../test-support/testDb.js";
import type { TestDatabase } from "../../../../test-support/testDb.js";
import { ApiFailure, ForbiddenError } from "../../../platform/errorResponse.js";
import { createLogger } from "../../../platform/logger.js";
import { createBackgroundRecorder } from "../../../platform/metrics/index.js";
import { createUser } from "../../identity/repositories/userRepository.js";
import { createSelfServeService } from "../../servers/index.js";
import { addMember } from "../../servers/repositories/memberRepository.js";
import { softDeleteServer, upsertConfiguredServer } from "../../servers/repositories/serverRepository.js";
import { enrolledServerIds, findActiveAgent, sha256 } from "../repositories/agentRepository.js";
import { PAIRING_RETENTION_AFTER_EXPIRY_HOURS } from "../repositories/pairingRepository.js";
import { PairingSweeper } from "./pairingSweeper.js";
import { createPairingService, displayNameFor } from "./pairingService.js";
import type { PairingService, PairingServiceDeps } from "./pairingService.js";

const available = dbTestsAvailable();
const silent = createLogger({ level: "silent" }, { write: () => {} });
const CADENCE = { statusSeconds: 5, powerSeconds: 5, factorySeconds: 30 };

const failureOf = async (work: Promise<unknown>): Promise<unknown> => work.then(() => undefined, (err: unknown) => err);
const codeOf = (err: unknown): string => (err instanceof ApiFailure ? err.code : String(err));
const NOT_FOUND_MESSAGE = "That pairing code is not valid or has expired.";

// ADR-0051 section 1 against a real Postgres: the start, the approval (new under the caps, existing for the owner) and the
// poll that mints the credential in one transaction, single use, slow_down, expiry and the sweep.
describe.skipIf(!available)("device-code pairing (database)", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let admin: pg.Pool;
  let operator: string;
  let n = 0;
  let selfServe = true;
  const attached: string[] = [];
  const counters: string[] = [];
  let service: PairingService;

  const sink = { recordHistogram: () => undefined, recordCounter: (_m: string, labels: Record<string, string>, amount?: number) => void counters.push(`${labels.event}:${amount ?? 1}`) };

  const build = (caps: { maxPending?: number } = {}): PairingService => {
    const selfServeService = createSelfServeService({
      db: pool,
      config: { maxServersPerAccount: 5, maxServersTotal: 1000, maxPendingPerAccount: caps.maxPending ?? 5, createsPerDay: 100 },
      isOperator: (id) => id === operator,
      enrolledServerIds,
      attachRuntime: async () => undefined,
      runtime: { rename: () => true, remove: async () => true },
    });
    const deps: PairingServiceDeps = {
      db: pool,
      cadence: () => CADENCE,
      attachAgentRuntime: async (publicId) => void attached.push(publicId),
      createServer: (actor, displayName, hook) => selfServeService.create(actor, { displayName }, hook),
      selfServeEnabled: () => selfServe,
      isOperator: (id) => id === operator,
      metrics: createBackgroundRecorder(silent, sink as never),
      logger: silent,
    };
    return createPairingService(deps);
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 10 });
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
    operator = (await createUser(pool, { displayName: "operator" })).id;
    service = build();
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.end();
    await db?.drop();
  });

  const user = async () => (await createUser(pool, { displayName: `player-${++n}` })).id;
  const start = (serverName: string | undefined = "Factory Island") => service.start({ agentVersion: "0.1.0", serverName });
  const pairingRow = async (userCode: string) =>
    (await admin.query("SELECT * FROM agents.pairings WHERE user_code = $1", [userCode])).rows[0] as Record<string, unknown> | undefined;
  /** Lets the next poll count as "on time": the last poll was long ago and the interval is back to 5 s. */
  const ageLastPoll = (secret: string) =>
    admin.query("UPDATE agents.pairings SET last_poll_at = now() - interval '30 seconds', poll_interval_seconds = 5 WHERE secret_hash = $1", [sha256(secret)]);
  const expire = (userCode: string) => admin.query("UPDATE agents.pairings SET expires_at = now() - interval '1 second' WHERE user_code = $1", [userCode]);
  const serverRow = async (publicId: string) =>
    (await admin.query("SELECT id, connection_kind, created_via, deleted_at FROM servers.servers WHERE public_id = $1", [publicId])).rows[0] as
      | { id: string; connection_kind: string; created_via: string; deleted_at: Date | null }
      | undefined;
  const serverCount = async () => Number((await admin.query("SELECT count(*) AS c FROM servers.servers")).rows[0].c);
  const poll = async (secret: string) => {
    await ageLastPoll(secret);
    return service.poll(secret);
  };

  describe("start", () => {
    it("stores only a hash of the secret, a 60-bit code, the name and version, and expiry 900 s out", async () => {
      const started = await start();
      expect(started.pairingSecret).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(started.userCode).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
      expect(started).toMatchObject({ expiresIn: 900, interval: 5 });
      const row = (await pairingRow(started.userCode))!;
      expect(row.secret_hash).toEqual(createHash("sha256").update(started.pairingSecret).digest());
      expect(JSON.stringify(row)).not.toContain(started.pairingSecret);
      expect(row).toMatchObject({ server_name: "Factory Island", agent_version: "0.1.0", approved_by: null, server_id: null, consumed_at: null, last_poll_at: null });
      const lifetime = ((row.expires_at as Date).getTime() - (row.created_at as Date).getTime()) / 1000;
      expect(lifetime).toBe(900);
      expect(counters).toContain("started:1");
    });

    it("a name is optional, and two pairings never share a code or a secret", async () => {
      const [a, b] = await Promise.all([service.start({ agentVersion: "0.1.0" }), service.start({ agentVersion: "0.1.0" })]);
      expect(a.userCode).not.toBe(b.userCode);
      expect(a.pairingSecret).not.toBe(b.pairingSecret);
      expect((await pairingRow(a.userCode))!.server_name).toBeNull();
    });
  });

  describe("lookup", () => {
    it("shows who is asking", async () => {
      const started = await start("My Base");
      expect(await service.lookup(started.userCode)).toMatchObject({ serverName: "My Base", agentVersion: "0.1.0" });
    });

    it("unknown, expired, approved and spent codes are the same not_found", async () => {
      const owner = await user();
      const expired = await start();
      await expire(expired.userCode);
      const approved = await start();
      await service.approve(owner, { userCode: approved.userCode, target: { kind: "new" } });
      const spent = await start();
      await service.approve(owner, { userCode: spent.userCode, target: { kind: "new" } });
      await poll(spent.pairingSecret);
      for (const code of ["ZZZZ-ZZZZ-ZZZZ", expired.userCode, approved.userCode, spent.userCode]) {
        const err = await failureOf(service.lookup(code));
        expect(codeOf(err)).toBe("not_found");
        expect((err as Error).message).toBe(NOT_FOUND_MESSAGE);
      }
    });
  });

  describe("approve a new server, then poll", () => {
    it("pending until approved; the approval creates the owner's self-serve server; the next poll mints the credential once", async () => {
      const owner = await user();
      const started = await start("Island");
      expect(await poll(started.pairingSecret)).toEqual({ status: "pending" });

      const { serverId } = await service.approve(owner, { userCode: started.userCode, target: { kind: "new" } });
      expect(serverId).toMatch(/^[a-z2-7]{20}$/);
      const created = (await serverRow(serverId))!;
      expect(created).toMatchObject({ created_via: "self_serve", deleted_at: null });
      // Approved but not collected: no credential yet.
      expect((await admin.query("SELECT 1 FROM agents.agent_credentials WHERE server_id = $1", [created.id])).rowCount).toBe(0);
      expect((await pairingRow(started.userCode))).toMatchObject({ approved_by: owner, server_id: created.id, consumed_at: null });
      expect((await admin.query("SELECT role FROM servers.server_members WHERE server_id = $1 AND user_id = $2", [created.id, owner])).rows).toEqual([{ role: "owner" }]);
      expect((await admin.query("SELECT display_name FROM servers.servers WHERE id = $1", [created.id])).rows[0].display_name).toBe("Island");

      const minted = await poll(started.pairingSecret);
      expect(minted).toMatchObject({ status: "approved", serverId, cadence: CADENCE });
      if (minted.status !== "approved") throw new Error("unreachable");
      expect(minted.agentSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(await findActiveAgent(pool, sha256(minted.agentSecret))).toMatchObject({ publicId: serverId });
      expect((await serverRow(serverId))!.connection_kind).toBe("agent");
      expect(attached).toContain(serverId);

      // One use: a second poll, and every later one, reads as expired and mints nothing.
      expect(await poll(started.pairingSecret)).toEqual({ status: "expired" });
      expect((await admin.query("SELECT count(*)::int AS c FROM agents.agent_credentials WHERE server_id = $1", [created.id])).rows[0].c).toBe(1);
      expect((await pairingRow(started.userCode))!.consumed_at).not.toBeNull();
      const audit = (await admin.query("SELECT action, detail FROM audit.audit_events WHERE server_id = $1 ORDER BY id", [created.id])).rows;
      expect(audit.map((a: { action: string }) => a.action)).toEqual(["member_added", "server.created", "agent.pairing_approved", "agent.enrolled"]);
      expect(audit[3].detail).toEqual({ via: "pairing" });
      expect(JSON.stringify(audit)).not.toContain(started.userCode);
      expect(JSON.stringify(audit)).not.toContain(minted.agentSecret);
      expect(counters).toContain("approved:1");
    });

    it("a second approval of the same code is not_found and creates no second server", async () => {
      const owner = await user();
      const started = await start();
      await service.approve(owner, { userCode: started.userCode, target: { kind: "new" } });
      const before = await serverCount();
      const err = await failureOf(service.approve(owner, { userCode: started.userCode, target: { kind: "new" } }));
      expect(codeOf(err)).toBe("not_found");
      expect(await serverCount()).toBe(before);
    });

    it("two approvals racing for one code: exactly one wins and exactly one server exists", async () => {
      const [a, b] = [await user(), await user()];
      const started = await start();
      const before = await serverCount();
      const results = await Promise.allSettled([
        service.approve(a, { userCode: started.userCode, target: { kind: "new" } }),
        service.approve(b, { userCode: started.userCode, target: { kind: "new" } }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(codeOf(lost.reason)).toBe("not_found");
      expect(await serverCount()).toBe(before + 1);
    });

    it("a cap refusal (C3: one pending server) rolls everything back and leaves the code open", async () => {
      const capped = build({ maxPending: 1 });
      const owner = await user();
      const first = await start();
      await capped.approve(owner, { userCode: first.userCode, target: { kind: "new" } }); // pending, never enrolled
      const second = await start();
      const before = await serverCount();
      const err = await failureOf(capped.approve(owner, { userCode: second.userCode, target: { kind: "new" } }));
      expect(codeOf(err)).toBe("server_limit_reached");
      expect(await serverCount()).toBe(before);
      expect(await pairingRow(second.userCode)).toMatchObject({ approved_by: null, server_id: null });
      expect(await capped.lookup(second.userCode)).toBeDefined();
    });

    it("is refused 403 while self-serve is off, and the code stays open", async () => {
      const owner = await user();
      const started = await start();
      selfServe = false;
      try {
        expect(await failureOf(service.approve(owner, { userCode: started.userCode, target: { kind: "new" } }))).toBeInstanceOf(ForbiddenError);
      } finally {
        selfServe = true;
      }
      expect(await service.lookup(started.userCode)).toBeDefined();
    });

    it("an unknown code is not_found before the kill switch is looked at", async () => {
      selfServe = false;
      try {
        expect(codeOf(await failureOf(service.approve(await user(), { userCode: "ZZZZ-ZZZZ-ZZZZ", target: { kind: "new" } })))).toBe("not_found");
      } finally {
        selfServe = true;
      }
    });

    it("an agent's own name becomes the display name only if it passes the name rule; else a default", async () => {
      expect(displayNameFor(null)).toBe("My server");
      expect(displayNameFor("x".repeat(100))).toBe("x".repeat(64));
      expect(displayNameFor("a​b")).toBe("My server");
      expect(displayNameFor("   ")).toBe("My server");
    });

    it("a server removed between approval and poll mints nothing and the pairing reads as expired", async () => {
      const owner = await user();
      const started = await start();
      const { serverId } = await service.approve(owner, { userCode: started.userCode, target: { kind: "new" } });
      await softDeleteServer(pool, serverId);
      expect(await poll(started.pairingSecret)).toEqual({ status: "expired" });
      expect((await admin.query("SELECT count(*)::int AS c FROM agents.agent_credentials ac JOIN servers.servers s ON s.id = ac.server_id WHERE s.public_id = $1", [serverId])).rows[0].c).toBe(0);
    });

    it("two polls at once after the approval: exactly one gets the credential", async () => {
      const owner = await user();
      const started = await start();
      const { serverId } = await service.approve(owner, { userCode: started.userCode, target: { kind: "new" } });
      await ageLastPoll(started.pairingSecret);
      const results = await Promise.all([service.poll(started.pairingSecret), service.poll(started.pairingSecret)]);
      // The second concurrent poll is either too soon (slow_down) or already spent (expired); never a second credential.
      expect(results.filter((r) => r.status === "approved")).toHaveLength(1);
      expect(results.filter((r) => r.status !== "approved").every((r) => r.status === "expired" || r.status === "slow_down")).toBe(true);
      expect((await admin.query("SELECT count(*)::int AS c FROM agents.agent_credentials ac JOIN servers.servers s ON s.id = ac.server_id WHERE s.public_id = $1", [serverId])).rows[0].c).toBe(1);
    });
  });

  describe("approve an existing server", () => {
    const ownedServer = async (owner: string, kind: "agent" | "local" = "agent") => {
      const publicId = `srv-${randomUUID().slice(0, 8)}`;
      const row = await upsertConfiguredServer(pool, { publicId, displayName: "Existing" });
      if (kind === "agent") await admin.query("UPDATE servers.servers SET connection_kind = 'agent' WHERE id = $1", [row.id]);
      await addMember(pool, { serverId: row.id, userId: owner, role: "owner", actorUserId: null });
      return { publicId, id: row.id };
    };

    it("the owner re-pairs: the next poll replaces the credential (the old secret stops working) and it is audited", async () => {
      const owner = await user();
      const server = await ownedServer(owner);
      const first = await start();
      await service.approve(owner, { userCode: first.userCode, target: { kind: "existing", serverId: server.publicId } });
      const one = await poll(first.pairingSecret);
      if (one.status !== "approved") throw new Error("expected approved");
      expect(one.serverId).toBe(server.publicId);
      expect(await findActiveAgent(pool, sha256(one.agentSecret))).toBeDefined();

      const again = await start();
      await service.approve(owner, { userCode: again.userCode, target: { kind: "existing", serverId: server.publicId } });
      const two = await poll(again.pairingSecret);
      if (two.status !== "approved") throw new Error("expected approved");
      expect(await findActiveAgent(pool, sha256(one.agentSecret))).toBeUndefined();
      expect(await findActiveAgent(pool, sha256(two.agentSecret))).toMatchObject({ publicId: server.publicId });
    });

    it("works while self-serve is off (it creates nothing)", async () => {
      const owner = await user();
      const server = await ownedServer(owner);
      const started = await start();
      selfServe = false;
      try {
        expect(await service.approve(owner, { userCode: started.userCode, target: { kind: "existing", serverId: server.publicId } })).toEqual({ serverId: server.publicId });
      } finally {
        selfServe = true;
      }
    });

    it("someone else's server, an unknown id and a removed server are the same not_found, and the code stays open", async () => {
      const owner = await user();
      const stranger = await user();
      const server = await ownedServer(owner);
      const gone = await ownedServer(stranger);
      await softDeleteServer(pool, gone.publicId);
      const started = await start();
      const messages = new Set<string>();
      for (const serverId of [server.publicId, "does-not-exist", gone.publicId]) {
        const err = await failureOf(service.approve(stranger, { userCode: started.userCode, target: { kind: "existing", serverId } }));
        expect(codeOf(err)).toBe("not_found");
        messages.add((err as Error).message);
      }
      expect([...messages]).toEqual([NOT_FOUND_MESSAGE]);
      expect(await service.lookup(started.userCode)).toBeDefined();
    });

    it("a member who is not the owner (admin, viewer) may not", async () => {
      const owner = await user();
      const admin1 = await user();
      const server = await ownedServer(owner);
      await addMember(pool, { serverId: server.id, userId: admin1, role: "admin", actorUserId: owner });
      const started = await start();
      expect(codeOf(await failureOf(service.approve(admin1, { userCode: started.userCode, target: { kind: "existing", serverId: server.publicId } })))).toBe("not_found");
    });

    it("a server this backend reads directly ('local') is for the operator only", async () => {
      const player = await user();
      const playerLocal = await ownedServer(player, "local");
      const started = await start();
      expect(codeOf(await failureOf(service.approve(player, { userCode: started.userCode, target: { kind: "existing", serverId: playerLocal.publicId } })))).toBe("not_found");
      const operatorLocal = await ownedServer(operator, "local");
      expect(await service.approve(operator, { userCode: started.userCode, target: { kind: "existing", serverId: operatorLocal.publicId } })).toEqual({ serverId: operatorLocal.publicId });
    });

    it("a bad code with a good server is the same not_found, and approving does not happen twice", async () => {
      const owner = await user();
      const server = await ownedServer(owner);
      expect(codeOf(await failureOf(service.approve(owner, { userCode: "ZZZZ-ZZZZ-ZZZZ", target: { kind: "existing", serverId: server.publicId } })))).toBe("not_found");
      const started = await start();
      await service.approve(owner, { userCode: started.userCode, target: { kind: "existing", serverId: server.publicId } });
      expect(codeOf(await failureOf(service.approve(owner, { userCode: started.userCode, target: { kind: "existing", serverId: server.publicId } })))).toBe("not_found");
    });
  });

  describe("poll", () => {
    it("an unknown secret reads as expired, never an error", async () => {
      expect(await service.poll("A".repeat(22))).toEqual({ status: "expired" });
    });

    it("an expired pairing is expired, also when it was approved", async () => {
      const owner = await user();
      const started = await start();
      await service.approve(owner, { userCode: started.userCode, target: { kind: "new" } });
      await expire(started.userCode);
      expect(await poll(started.pairingSecret)).toEqual({ status: "expired" });
      expect((await pairingRow(started.userCode))!.consumed_at).toBeNull();
    });

    it("polling faster than the interval is slow_down (1 s grace), and the expected interval grows by 5 s each time up to 60", async () => {
      const started = await start();
      expect(await service.poll(started.pairingSecret)).toEqual({ status: "pending" }); // the first poll is never early
      expect(await service.poll(started.pairingSecret)).toEqual({ status: "slow_down" });
      expect((await pairingRow(started.userCode))!.poll_interval_seconds).toBe(10);
      expect(await service.poll(started.pairingSecret)).toEqual({ status: "slow_down" });
      expect((await pairingRow(started.userCode))!.poll_interval_seconds).toBe(15);
      // 9 s after the last poll is still early against a 15 s interval; 30 s is on time.
      await admin.query("UPDATE agents.pairings SET last_poll_at = now() - interval '9 seconds' WHERE user_code = $1", [started.userCode]);
      expect(await service.poll(started.pairingSecret)).toEqual({ status: "slow_down" });
      await admin.query("UPDATE agents.pairings SET last_poll_at = now() - interval '30 seconds' WHERE user_code = $1", [started.userCode]);
      expect(await service.poll(started.pairingSecret)).toEqual({ status: "pending" });
      await admin.query("UPDATE agents.pairings SET poll_interval_seconds = 58 WHERE user_code = $1", [started.userCode]);
      expect(await service.poll(started.pairingSecret)).toEqual({ status: "slow_down" });
      expect((await pairingRow(started.userCode))!.poll_interval_seconds).toBe(60);
    });

    it("a poll at 4.5 s (jitter) is on time against the 5 s interval", async () => {
      const started = await start();
      await service.poll(started.pairingSecret);
      await admin.query("UPDATE agents.pairings SET last_poll_at = now() - interval '4.5 seconds' WHERE user_code = $1", [started.userCode]);
      expect(await service.poll(started.pairingSecret)).toEqual({ status: "pending" });
    });

    it("an approved pairing polled too soon is told to slow down and mints nothing yet", async () => {
      const owner = await user();
      const started = await start();
      await service.poll(started.pairingSecret);
      const { serverId } = await service.approve(owner, { userCode: started.userCode, target: { kind: "new" } });
      expect(await service.poll(started.pairingSecret)).toEqual({ status: "slow_down" });
      expect((await pairingRow(started.userCode))!.consumed_at).toBeNull();
      const row = (await serverRow(serverId))!;
      expect((await admin.query("SELECT 1 FROM agents.agent_credentials WHERE server_id = $1", [row.id])).rowCount).toBe(0);
    });
  });

  describe("sweeper", () => {
    it("deletes rows an hour after they expire, keeps the rest, and counts only the uncollected as expired", async () => {
      const owner = await user();
      const old = await start();
      const oldSpent = await start();
      const recentlyExpired = await start();
      const open = await start();
      await service.approve(owner, { userCode: oldSpent.userCode, target: { kind: "new" } });
      await poll(oldSpent.pairingSecret);
      const hours = PAIRING_RETENTION_AFTER_EXPIRY_HOURS;
      await admin.query("UPDATE agents.pairings SET expires_at = now() - make_interval(hours => $2, mins => 1) WHERE user_code = ANY($1)", [[old.userCode, oldSpent.userCode], hours]);
      await admin.query("UPDATE agents.pairings SET expires_at = now() - make_interval(hours => $2, mins => -1) WHERE user_code = $1", [recentlyExpired.userCode, hours]);
      counters.length = 0;
      await new PairingSweeper(pool, { logger: silent, metrics: sink as never }).sweep();
      expect(await pairingRow(old.userCode)).toBeUndefined();
      expect(await pairingRow(oldSpent.userCode)).toBeUndefined();
      expect(await pairingRow(recentlyExpired.userCode)).toBeDefined();
      expect(await pairingRow(open.userCode)).toBeDefined();
      expect(counters.filter((c) => c.startsWith("expired:"))).toHaveLength(1);
      expect(counters.some((c) => c.startsWith("expired:") && Number(c.split(":")[1]) >= 1)).toBe(true);
    });

    it("rows go with their server (cascade), so a hard-deleted server leaves no approved pairing behind", async () => {
      const owner = await user();
      const started = await start();
      const { serverId } = await service.approve(owner, { userCode: started.userCode, target: { kind: "new" } });
      const row = (await serverRow(serverId))!;
      await admin.query("DELETE FROM servers.servers WHERE id = $1", [row.id]);
      expect(await pairingRow(started.userCode)).toBeUndefined();
      expect(await poll(started.pairingSecret)).toEqual({ status: "expired" });
    });
  });
});
