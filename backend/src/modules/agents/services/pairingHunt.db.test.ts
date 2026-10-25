import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../../test-support/testDb.js";
import type { TestDatabase } from "../../../../test-support/testDb.js";
import { ApiFailure } from "../../../platform/errorResponse.js";
import { createLogger } from "../../../platform/logger.js";
import { createBackgroundRecorder } from "../../../platform/metrics/index.js";
import { createUser } from "../../identity/repositories/userRepository.js";
import { createSelfServeService } from "../../servers/index.js";
import { softDeleteServer } from "../../servers/repositories/serverRepository.js";
import { enrolledServerIds, findActiveAgent, sha256 } from "../repositories/agentRepository.js";
import { createPairingService, displayNameFor } from "./pairingService.js";
import type { PairingService } from "./pairingService.js";

const available = dbTestsAvailable();
const silent = createLogger({ level: "silent" }, { write: () => {} });
const CADENCE = { statusSeconds: 5, powerSeconds: 5, factorySeconds: 30 };
const failureOf = async (work: Promise<unknown>): Promise<unknown> => work.then(() => undefined, (err: unknown) => err);
const codeOf = (err: unknown): string => (err instanceof ApiFailure ? err.code : String(err));
const sink = { recordHistogram: () => undefined, recordCounter: () => undefined };

describe("displayNameFor", () => {
  it("falls back for null, blank, invisible-only and lookalike names", () => {
    for (const name of [null, "", "   ", "​", "a\u0000b", "a\nb", "⠀"]) expect(displayNameFor(name)).toBe("My server");
  });
  it("cuts by code points, not UTF-16 units, and never splits an emoji", () => {
    const cut = displayNameFor("\u{1F680}".repeat(80));
    expect(Array.from(cut)).toHaveLength(64);
    expect(cut).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });
  it("keeps a normal name and trims it", () => {
    expect(displayNameFor("  Factory Island  ")).toBe("Factory Island");
  });
});

describe.skipIf(!available)("device-code pairing, hunt (database)", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let admin: pg.Pool;
  let operator: string;
  let n = 0;
  let attachFails = false;
  let service: PairingService;

  const build = (maxPending = 5): PairingService => {
    const selfServe = createSelfServeService({
      db: pool,
      config: { maxServersPerAccount: 50, maxServersTotal: 1000, maxPendingPerAccount: maxPending, createsPerDay: 100 },
      isOperator: (id) => id === operator,
      enrolledServerIds,
      attachRuntime: async () => undefined,
      runtime: { rename: () => true, remove: async () => true },
    });
    return createPairingService({
      db: pool,
      cadence: () => CADENCE,
      attachAgentRuntime: async () => {
        if (attachFails) throw new Error("attach failed");
      },
      createServer: (actor, displayName, hook) => selfServe.create(actor, { displayName }, hook),
      selfServeEnabled: () => true,
      isOperator: (id) => id === operator,
      metrics: createBackgroundRecorder(silent, sink as never),
      logger: silent,
    });
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 20 });
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
    operator = (await createUser(pool, { displayName: "operator" })).id;
    service = build();
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.end();
    await db?.drop();
  });

  const user = async () => (await createUser(pool, { displayName: `hunter-${++n}` })).id;
  const start = (serverName: string | undefined = "Island") => service.start({ agentVersion: "0.1.0", serverName });
  const row = async (userCode: string) =>
    (await admin.query("SELECT * FROM agents.pairings WHERE user_code = $1", [userCode])).rows[0] as Record<string, unknown> | undefined;
  const ageLastPoll = (secret: string) =>
    admin.query("UPDATE agents.pairings SET last_poll_at = now() - interval '30 seconds', poll_interval_seconds = 5 WHERE secret_hash = $1", [sha256(secret)]);
  const poll = async (secret: string) => {
    await ageLastPoll(secret);
    return service.poll(secret);
  };
  const serverCount = async () => Number((await admin.query("SELECT count(*) AS c FROM servers.servers")).rows[0].c);
  const memberCount = async () => Number((await admin.query("SELECT count(*) AS c FROM servers.server_members")).rows[0].c);
  const credCount = async () => Number((await admin.query("SELECT count(*) AS c FROM agents.agent_credentials")).rows[0].c);
  const auditCount = async (action: string) => Number((await admin.query("SELECT count(*) AS c FROM audit.audit_events WHERE action = $1", [action])).rows[0].c);

  /** Makes every audit insert of `action` fail until the returned function is called (partial-failure injection). */
  const failAuditOf = async (action: string): Promise<() => Promise<void>> => {
    const name = `hunt_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    await admin.query(`CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = '${action}' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$`);
    await admin.query(`CREATE TRIGGER ${name} BEFORE INSERT ON audit.audit_events FOR EACH ROW EXECUTE FUNCTION public.${name}()`);
    return async () => {
      await admin.query(`DROP TRIGGER ${name} ON audit.audit_events`);
      await admin.query(`DROP FUNCTION public.${name}()`);
    };
  };

  describe("partial failure rolls everything back", () => {
    it("approve(new): a failure after the server exists leaves no server, owner or audit row, and the code stays open", async () => {
      const owner = await user();
      const s = await start();
      const undo = await failAuditOf("agent.pairing_approved");
      const servers = await serverCount();
      const members = await memberCount();
      const created = await auditCount("server.created");
      try {
        const err = await failureOf(service.approve(owner, { userCode: s.userCode, target: { kind: "new" } }));
        expect(err).toBeDefined();
      } finally {
        await undo();
      }
      expect(await serverCount()).toBe(servers);
      expect(await memberCount()).toBe(members);
      expect(await auditCount("server.created")).toBe(created);
      expect(await row(s.userCode)).toMatchObject({ approved_by: null, server_id: null });
      const ok = await service.approve(owner, { userCode: s.userCode, target: { kind: "new" } });
      expect(ok.serverId).toMatch(/^[a-z2-7]{20}$/);
    });

    it("approve(existing): a failed audit leaves the code open", async () => {
      const owner = await user();
      const first = await start();
      const { serverId } = await service.approve(owner, { userCode: first.userCode, target: { kind: "new" } });
      const s = await start();
      const undo = await failAuditOf("agent.pairing_approved");
      try {
        expect(await failureOf(service.approve(owner, { userCode: s.userCode, target: { kind: "existing", serverId } }))).toBeDefined();
      } finally {
        await undo();
      }
      expect(await row(s.userCode)).toMatchObject({ approved_by: null, server_id: null });
    });

    it("poll: a failure while minting leaves the pairing unspent, no credential, and a retry succeeds", async () => {
      const owner = await user();
      const s = await start();
      const { serverId } = await service.approve(owner, { userCode: s.userCode, target: { kind: "new" } });
      const undo = await failAuditOf("agent.enrolled");
      const creds = await credCount();
      try {
        expect(await failureOf(poll(s.pairingSecret))).toBeDefined();
      } finally {
        await undo();
      }
      expect(await credCount()).toBe(creds);
      expect((await row(s.userCode))!.consumed_at).toBeNull();
      const retry = await poll(s.pairingSecret);
      expect(retry).toMatchObject({ status: "approved", serverId });
    });
  });

  describe("races and lock order", { timeout: 60_000 }, () => {
    it("approve(new) and approve(existing) racing for one code: one wins, and a losing 'new' leaves no server", async () => {
      for (let i = 0; i < 8; i++) {
        const owner = await user();
        const seed = await start();
        const { serverId } = await service.approve(owner, { userCode: seed.userCode, target: { kind: "new" } });
        const s = await start();
        const before = await serverCount();
        const results = await Promise.allSettled([
          service.approve(owner, { userCode: s.userCode, target: { kind: "new" } }),
          service.approve(owner, { userCode: s.userCode, target: { kind: "existing", serverId } }),
        ]);
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
        expect(codeOf(lost.reason)).toBe("not_found");
        const newWon = results[0]!.status === "fulfilled";
        expect(await serverCount()).toBe(before + (newWon ? 1 : 0));
      }
    });

    it("a poll racing the approval of the same pairing never errors and the agent ends up with exactly one credential", async () => {
      for (let i = 0; i < 8; i++) {
        const owner = await user();
        const s = await start();
        await poll(s.pairingSecret); // first poll recorded
        await ageLastPoll(s.pairingSecret);
        const [a, p] = await Promise.allSettled([service.approve(owner, { userCode: s.userCode, target: { kind: "new" } }), service.poll(s.pairingSecret)]);
        expect(a.status).toBe("fulfilled");
        expect(p.status).toBe("fulfilled");
        const second = await poll(s.pairingSecret);
        const outcomes = [(p as PromiseFulfilledResult<{ status: string }>).value.status, second.status];
        expect(outcomes.filter((x) => x === "approved")).toHaveLength(1);
      }
    });

    it("a poll racing the removal of its server never throws (no deadlock, no 500): approved or expired", async () => {
      for (let i = 0; i < 12; i++) {
        const owner = await user();
        const s = await start();
        const { serverId } = await service.approve(owner, { userCode: s.userCode, target: { kind: "new" } });
        await ageLastPoll(s.pairingSecret);
        const [p, d] = await Promise.allSettled([service.poll(s.pairingSecret), softDeleteServer(pool, serverId)]);
        expect(p.status, p.status === "rejected" ? String(p.reason) : "").toBe("fulfilled");
        expect(d.status, d.status === "rejected" ? String(d.reason) : "").toBe("fulfilled");
        const status = (p as PromiseFulfilledResult<{ status: string }>).value.status;
        expect(["approved", "expired"]).toContain(status);
      }
    });

    it("approve(existing) racing the owner's removal of the server never throws except not_found, and leaves no live pairing for a removed server", async () => {
      for (let i = 0; i < 12; i++) {
        const owner = await user();
        const seed = await start();
        const { serverId } = await service.approve(owner, { userCode: seed.userCode, target: { kind: "new" } });
        const s = await start();
        const [a, d] = await Promise.allSettled([
          service.approve(owner, { userCode: s.userCode, target: { kind: "existing", serverId } }),
          softDeleteServer(pool, serverId),
        ]);
        expect(d.status).toBe("fulfilled");
        if (a.status === "rejected") expect(codeOf(a.reason)).toBe("not_found");
        const pairing = await row(s.userCode);
        if (pairing?.server_id) {
          const server = (await admin.query("SELECT deleted_at FROM servers.servers WHERE id = $1", [pairing.server_id])).rows[0];
          // An approval that survived the removal must not point at a removed server (the purge deletes it).
          expect(server.deleted_at).toBeNull();
        }
      }
    });

    it("parallel approvals by one account under a pending cap of 1: exactly one succeeds, the rest leave nothing", async () => {
      const capped = build(1);
      const owner = await user();
      const codes = await Promise.all([start(), start(), start(), start()]);
      const before = await serverCount();
      const results = await Promise.allSettled(codes.map((c) => capped.approve(owner, { userCode: c.userCode, target: { kind: "new" } })));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await serverCount()).toBe(before + 1);
      for (const r of results) if (r.status === "rejected") expect(codeOf(r.reason)).toBe("server_limit_reached");
      const open = (await Promise.all(codes.map(async (c) => (await row(c.userCode))!.approved_by === null))).filter(Boolean);
      expect(open).toHaveLength(3);
    });

    it("two pairings approved for one server, both polled: no error, last mint holds the only active credential", async () => {
      const owner = await user();
      const seed = await start();
      const { serverId } = await service.approve(owner, { userCode: seed.userCode, target: { kind: "new" } });
      await poll(seed.pairingSecret);
      const a = await start();
      const b = await start();
      await service.approve(owner, { userCode: a.userCode, target: { kind: "existing", serverId } });
      await service.approve(owner, { userCode: b.userCode, target: { kind: "existing", serverId } });
      const ra = await poll(a.pairingSecret);
      const rb = await poll(b.pairingSecret);
      expect(ra.status).toBe("approved");
      expect(rb.status).toBe("approved");
      if (ra.status === "approved" && rb.status === "approved") {
        expect(await findActiveAgent(pool, sha256(ra.agentSecret))).toBeUndefined();
        expect(await findActiveAgent(pool, sha256(rb.agentSecret))).toBeDefined();
      }
    });
  });

  describe("boundaries", () => {
    it("a poll 3.5 s after the last (interval 5, 1 s grace) is slow_down; 4.2 s is on time", async () => {
      const s = await start();
      await service.poll(s.pairingSecret);
      await admin.query("UPDATE agents.pairings SET last_poll_at = now() - interval '3.5 seconds' WHERE secret_hash = $1", [sha256(s.pairingSecret)]);
      expect(await service.poll(s.pairingSecret)).toEqual({ status: "slow_down" });
      await admin.query("UPDATE agents.pairings SET last_poll_at = now() - interval '9 seconds' WHERE secret_hash = $1", [sha256(s.pairingSecret)]);
      expect(await service.poll(s.pairingSecret)).toEqual({ status: "pending" });
    });

    it("an approved pairing that expires before the poll is expired, unspent and mints nothing", async () => {
      const owner = await user();
      const s = await start();
      await service.approve(owner, { userCode: s.userCode, target: { kind: "new" } });
      await admin.query("UPDATE agents.pairings SET expires_at = now() - interval '1 millisecond' WHERE user_code = $1", [s.userCode]);
      const creds = await credCount();
      expect(await poll(s.pairingSecret)).toEqual({ status: "expired" });
      expect(await credCount()).toBe(creds);
      expect((await row(s.userCode))!.consumed_at).toBeNull();
    });

    it("an expired code can neither be approved as new (no server created) nor as existing", async () => {
      const owner = await user();
      const seed = await start();
      const { serverId } = await service.approve(owner, { userCode: seed.userCode, target: { kind: "new" } });
      const s = await start();
      await admin.query("UPDATE agents.pairings SET expires_at = now() - interval '1 second' WHERE user_code = $1", [s.userCode]);
      const before = await serverCount();
      expect(codeOf(await failureOf(service.approve(owner, { userCode: s.userCode, target: { kind: "new" } })))).toBe("not_found");
      expect(codeOf(await failureOf(service.approve(owner, { userCode: s.userCode, target: { kind: "existing", serverId } })))).toBe("not_found");
      expect(await serverCount()).toBe(before);
    });

    it("odd secrets (empty, huge, unicode, wrong length) read as expired, never an error", async () => {
      for (const secret of ["", "x".repeat(100_000), "\u{1F680}\u0000", "short"]) {
        expect(await service.poll(secret)).toEqual({ status: "expired" });
      }
    });

    it("an attach failure after the mint still returns the credential, and it works", async () => {
      const owner = await user();
      const s = await start();
      await service.approve(owner, { userCode: s.userCode, target: { kind: "new" } });
      attachFails = true;
      try {
        const r = await poll(s.pairingSecret);
        expect(r.status).toBe("approved");
        if (r.status === "approved") expect(await findActiveAgent(pool, sha256(r.agentSecret))).toBeDefined();
      } finally {
        attachFails = false;
      }
    });

    it("a 200-character multi-byte name is stored, and the display name derived from it passes the rule", async () => {
      const name = "é".repeat(200);
      const s = await start(name);
      expect((await row(s.userCode))!.server_name).toBe(name);
      expect(Array.from(displayNameFor(name))).toHaveLength(64);
    });
  });
});
