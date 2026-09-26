import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDatabase, dbTestsAvailable } from "../../../../test-support/testDb.js";
import type { TestDatabase } from "../../../../test-support/testDb.js";
import { ApiFailure, ForbiddenError, RateLimitedError, ServerNotFoundError } from "../../../platform/errorResponse.js";
import { createLogger } from "../../../platform/logger.js";
import { UserRateLimiter } from "../../../platform/userRateLimiter.js";
import { softDeleteServer, upsertConfiguredServer } from "../../servers/repositories/serverRepository.js";
import { findActiveAgent, sha256 } from "../repositories/agentRepository.js";
import { createAgentsService } from "./agentsService.js";
import type { AgentsService } from "./agentsService.js";
import { createEnrollmentService } from "./enrollmentService.js";
import type { EnrollmentService } from "./enrollmentService.js";

const available = dbTestsAvailable();

const OPERATOR = randomUUID();
const OWNER = randomUUID(); // an owner who is not the operator
const CADENCE = { statusSeconds: 5, powerSeconds: 5, factorySeconds: 30 };
const silent = createLogger({ level: "silent" }, { write: () => {} });

/** The failure a call rejects with, or undefined if it resolved. */
async function failureOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
    return undefined;
  } catch (err) {
    return err;
  }
}
const codeOf = (err: unknown): string | undefined => (err instanceof ApiFailure ? err.code : err instanceof Error ? err.name : undefined);

// ADR-0031 PR 5a against a real Postgres: the enrolment code's single use, the credential, the switch to an agent
// server, revocation and the purge with the server (the migration is applied by createTestDatabase; the services run as
// satis_app, fixtures the app never writes go in as the admin).
describe.skipIf(!available)("agent enrolment against a real Postgres", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let admin: pg.Pool;
  let counter = 0;
  let nowMs = Date.now();
  let agents: AgentsService;
  let enrollment: EnrollmentService;
  const attached: string[] = [];
  let attachFails = false;

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.appUrl, max: 10 });
    admin = new pg.Pool({ connectionString: db.adminUrl, max: 2 });
    agents = createAgentsService({
      db: pool,
      canManage: (userId) => userId === OPERATOR,
      limiter: new UserRateLimiter({ max: 1000, windowMs: 60_000 }),
      now: () => nowMs,
    });
    enrollment = createEnrollmentService({
      db: pool,
      cadence: () => CADENCE,
      logger: silent,
      attachAgentRuntime: async (publicId) => {
        attached.push(publicId);
        if (attachFails) throw new Error("the swap failed");
      },
    });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.end();
    await db?.drop();
  });

  /** A local server (with a stored connection) unless `kind` says it is already an agent server. */
  const newServer = async (kind: "local" | "agent" = "local") => {
    const server = await upsertConfiguredServer(pool, { publicId: `ag-${++counter}`, displayName: "Agents" });
    if (kind === "local") {
      await admin.query(
        `INSERT INTO servers.server_connections (server_id, host, pinned_ip, api_port, frm_port, api_token_enc, key_id)
         VALUES ($1, '127.0.0.1', '127.0.0.1', 7777, 8080, decode(repeat('ab', 40), 'hex'), 'k1')`,
        [server.id],
      );
    } else {
      await admin.query("UPDATE servers.servers SET connection_kind = 'agent' WHERE id = $1", [server.id]);
    }
    return server;
  };
  const kindOf = async (serverUuid: string) => (await admin.query("SELECT connection_kind FROM servers.servers WHERE id = $1", [serverUuid])).rows[0]?.connection_kind as string;
  const connectionRows = async (serverUuid: string) => (await admin.query("SELECT 1 FROM servers.server_connections WHERE server_id = $1", [serverUuid])).rowCount;
  const auditActions = async (serverUuid: string) =>
    (await admin.query("SELECT action, detail::text AS detail FROM audit.audit_events WHERE server_id = $1 ORDER BY id", [serverUuid])).rows as { action: string; detail: string }[];

  describe("creating a code", () => {
    it("stores only its hash, expires in 10 minutes, and audits it (ids only, never the code)", async () => {
      const server = await newServer("agent");
      const { code, expiresAt } = await agents.createEnrollmentCode(server.publicId, OWNER);
      expect(code).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}$/);
      expect(Date.parse(expiresAt)).toBe(nowMs + 10 * 60 * 1000);
      const rows = (await admin.query("SELECT code_hash, expires_at, created_by FROM agents.enrollment_codes WHERE server_id = $1", [server.id])).rows;
      expect(rows).toHaveLength(1);
      expect(Buffer.compare(rows[0].code_hash, sha256(code))).toBe(0);
      expect(rows[0].created_by).toBe(OWNER);
      const audit = await auditActions(server.id);
      expect(audit.map((a) => a.action)).toEqual(["agent.enrollment_code_created"]);
      expect(audit[0]!.detail).not.toContain(code);
    });

    it("drops the previous unconsumed code: only the newest one can enrol", async () => {
      const server = await newServer("agent");
      const first = await agents.createEnrollmentCode(server.publicId, OWNER);
      const second = await agents.createEnrollmentCode(server.publicId, OWNER);
      expect((await admin.query("SELECT 1 FROM agents.enrollment_codes WHERE server_id = $1", [server.id])).rowCount).toBe(1);
      expect(codeOf(await failureOf(enrollment.enroll(first.code, "0.1.0")))).toBe("enrollment_code_invalid");
      await expect(enrollment.enroll(second.code, "0.1.0")).resolves.toMatchObject({ serverId: server.publicId });
    });

    it("needs the operator for a server this backend reaches directly (enrolling replaces its stored tokens)", async () => {
      const server = await newServer("local");
      expect(await failureOf(agents.createEnrollmentCode(server.publicId, OWNER))).toBeInstanceOf(ForbiddenError);
      expect((await admin.query("SELECT 1 FROM agents.enrollment_codes WHERE server_id = $1", [server.id])).rowCount).toBe(0);
      await expect(agents.createEnrollmentCode(server.publicId, OPERATOR)).resolves.toMatchObject({ code: expect.any(String) });
    });

    it("is not found for an unknown or removed server", async () => {
      expect(await failureOf(agents.createEnrollmentCode("no-such-server", OPERATOR))).toBeInstanceOf(ServerNotFoundError);
      const server = await newServer("agent");
      await softDeleteServer(pool, server.publicId);
      expect(await failureOf(agents.createEnrollmentCode(server.publicId, OPERATOR))).toBeInstanceOf(ServerNotFoundError);
    });

    it("is rate limited per user", async () => {
      const limited = createAgentsService({ db: pool, canManage: () => true, limiter: new UserRateLimiter({ max: 2, windowMs: 60_000 }) });
      const server = await newServer("agent");
      await limited.createEnrollmentCode(server.publicId, OPERATOR);
      await limited.createEnrollmentCode(server.publicId, OPERATOR);
      expect(await failureOf(limited.createEnrollmentCode(server.publicId, OPERATOR))).toBeInstanceOf(RateLimitedError);
    });
  });

  describe("enrolling", () => {
    it("trades the code for a credential, switches a local server to an agent server and deletes its tokens, in one step", async () => {
      const server = await newServer("local");
      const { code } = await agents.createEnrollmentCode(server.publicId, OPERATOR);
      const result = await enrollment.enroll(code, "0.1.0");
      expect(result.serverId).toBe(server.publicId);
      expect(result.cadence).toEqual(CADENCE);
      expect(result.agentSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(await kindOf(server.id)).toBe("agent");
      expect(await connectionRows(server.id)).toBe(0);
      // Only the hash of the secret is stored, and it finds this server.
      const stored = (await admin.query("SELECT secret_hash, agent_version FROM agents.agent_credentials WHERE server_id = $1", [server.id])).rows[0];
      expect(Buffer.compare(stored.secret_hash, sha256(result.agentSecret))).toBe(0);
      expect(stored.agent_version).toBe("0.1.0");
      expect(await findActiveAgent(pool, sha256(result.agentSecret))).toEqual({ serverUuid: server.id, publicId: server.publicId });
      expect((await auditActions(server.id)).map((a) => a.action)).toEqual(["agent.enrollment_code_created", "agent.enrolled"]);
      expect(attached).toContain(server.publicId);
    });

    it("spends the code: a second use, a replay and a wrong code are all the same enrollment_code_invalid", async () => {
      const server = await newServer("agent");
      const { code } = await agents.createEnrollmentCode(server.publicId, OWNER);
      await enrollment.enroll(code, "0.1.0");
      const replay = await failureOf(enrollment.enroll(code, "0.1.0"));
      const wrong = await failureOf(enrollment.enroll("ZZZZ-2222", "0.1.0"));
      expect(codeOf(replay)).toBe("enrollment_code_invalid");
      expect(codeOf(wrong)).toBe("enrollment_code_invalid");
      expect((replay as Error).message).toBe((wrong as Error).message);
    });

    it("refuses an expired code, and leaves the server as it was", async () => {
      const server = await newServer("local");
      const { code } = await agents.createEnrollmentCode(server.publicId, OPERATOR);
      await admin.query("UPDATE agents.enrollment_codes SET expires_at = now() - interval '1 second' WHERE server_id = $1", [server.id]);
      expect(codeOf(await failureOf(enrollment.enroll(code, "0.1.0")))).toBe("enrollment_code_invalid");
      expect(await kindOf(server.id)).toBe("local");
      expect(await connectionRows(server.id)).toBe(1);
      expect((await admin.query("SELECT 1 FROM agents.agent_credentials WHERE server_id = $1", [server.id])).rowCount).toBe(0);
    });

    it("refuses the code of a server removed after it was created, and does not spend a credential on it", async () => {
      const server = await newServer("agent");
      const { code } = await agents.createEnrollmentCode(server.publicId, OWNER);
      await admin.query("UPDATE servers.servers SET deleted_at = now() WHERE id = $1", [server.id]);
      expect(codeOf(await failureOf(enrollment.enroll(code, "0.1.0")))).toBe("enrollment_code_invalid");
      expect((await admin.query("SELECT 1 FROM agents.agent_credentials WHERE server_id = $1", [server.id])).rowCount).toBe(0);
    });

    it("is consumed exactly once when many agents race for the same code", async () => {
      const server = await newServer("agent");
      const { code } = await agents.createEnrollmentCode(server.publicId, OWNER);
      const results = await Promise.allSettled(Array.from({ length: 12 }, () => enrollment.enroll(code, "0.1.0")));
      const won = results.filter((r) => r.status === "fulfilled");
      expect(won).toHaveLength(1);
      for (const r of results) {
        if (r.status === "rejected") expect(codeOf(r.reason)).toBe("enrollment_code_invalid");
      }
      // The one credential is the winner's.
      const secret = (won[0] as PromiseFulfilledResult<{ agentSecret: string }>).value.agentSecret;
      expect(await findActiveAgent(pool, sha256(secret))).toMatchObject({ publicId: server.publicId });
      expect((await admin.query("SELECT 1 FROM agents.agent_credentials WHERE server_id = $1", [server.id])).rowCount).toBe(1);
    });

    it("still answers 201-style success when swapping the running entry fails (the agent must get its secret)", async () => {
      const server = await newServer("agent");
      const { code } = await agents.createEnrollmentCode(server.publicId, OWNER);
      attachFails = true;
      try {
        const result = await enrollment.enroll(code, "0.1.0");
        expect(await findActiveAgent(pool, sha256(result.agentSecret))).toBeDefined();
      } finally {
        attachFails = false;
      }
    });

    it("enrolling again replaces the credential: the old secret stops working", async () => {
      const server = await newServer("agent");
      const first = await enrollment.enroll((await agents.createEnrollmentCode(server.publicId, OWNER)).code, "0.1.0");
      const second = await enrollment.enroll((await agents.createEnrollmentCode(server.publicId, OWNER)).code, "0.2.0");
      expect(await findActiveAgent(pool, sha256(first.agentSecret))).toBeUndefined();
      expect(await findActiveAgent(pool, sha256(second.agentSecret))).toBeDefined();
      expect((await agents.getStatus(server.publicId)).agentVersion).toBe("0.2.0");
    });
  });

  describe("status and revoking", () => {
    it("reports not enrolled, then enrolled with the version, then not enrolled after a revoke (no version, no time)", async () => {
      const server = await newServer("agent");
      expect(await agents.getStatus(server.publicId)).toEqual({ enrolled: false, lastSeenAt: null, agentVersion: null, connectionKind: "agent" });
      const { agentSecret } = await enrollment.enroll((await agents.createEnrollmentCode(server.publicId, OWNER)).code, "0.1.0");
      expect(await agents.getStatus(server.publicId)).toEqual({ enrolled: true, lastSeenAt: null, agentVersion: "0.1.0", connectionKind: "agent" });
      await admin.query("UPDATE agents.agent_credentials SET last_seen_at = now() WHERE server_id = $1", [server.id]);
      expect((await agents.getStatus(server.publicId)).lastSeenAt).not.toBeNull();
      expect(await agents.revoke(server.publicId, OWNER)).toEqual({ revoked: true });
      expect(await agents.getStatus(server.publicId)).toEqual({ enrolled: false, lastSeenAt: null, agentVersion: null, connectionKind: "agent" });
      // The agent now gets the same nothing as for an unknown secret.
      expect(await findActiveAgent(pool, sha256(agentSecret))).toBeUndefined();
      expect((await auditActions(server.id)).map((a) => a.action)).toContain("agent.revoked");
    });

    it("revoking is idempotent, also when nothing is enrolled, and drops an open code so it cannot enrol a replacement", async () => {
      const server = await newServer("agent");
      const { code } = await agents.createEnrollmentCode(server.publicId, OWNER);
      expect(await agents.revoke(server.publicId, OWNER)).toEqual({ revoked: true });
      expect(await agents.revoke(server.publicId, OWNER)).toEqual({ revoked: true });
      expect(codeOf(await failureOf(enrollment.enroll(code, "0.1.0")))).toBe("enrollment_code_invalid");
    });

    it("status and revoke are not found for an unknown server", async () => {
      expect(await failureOf(agents.getStatus("no-such-server"))).toBeInstanceOf(ServerNotFoundError);
      expect(await failureOf(agents.revoke("no-such-server", OWNER))).toBeInstanceOf(ServerNotFoundError);
    });
  });

  describe("removing the server", () => {
    it("purges its credential and codes, so a revived id can never be reached by the old agent", async () => {
      const server = await newServer("agent");
      const { agentSecret } = await enrollment.enroll((await agents.createEnrollmentCode(server.publicId, OWNER)).code, "0.1.0");
      await agents.createEnrollmentCode(server.publicId, OWNER);
      expect(await softDeleteServer(pool, server.publicId)).toBe(true);
      expect(await findActiveAgent(pool, sha256(agentSecret))).toBeUndefined();
      for (const table of ["enrollment_codes", "agent_credentials"]) {
        expect((await admin.query(`SELECT 1 FROM agents.${table} WHERE server_id = $1`, [server.id])).rowCount, table).toBe(0);
      }
      // The same public id created again is a fresh server: the old secret still finds nothing.
      await upsertConfiguredServer(pool, { publicId: server.publicId, displayName: "Revived" });
      expect(await findActiveAgent(pool, sha256(agentSecret))).toBeUndefined();
    });
  });

  it("never stores the secret or the code in clear", async () => {
    const server = await newServer("agent");
    const { code } = await agents.createEnrollmentCode(server.publicId, OWNER);
    const { agentSecret } = await enrollment.enroll(code, "0.1.0");
    const dump = JSON.stringify([
      ...(await admin.query("SELECT * FROM agents.agent_credentials WHERE server_id = $1", [server.id])).rows,
      ...(await admin.query("SELECT * FROM agents.enrollment_codes WHERE server_id = $1", [server.id])).rows,
    ]);
    expect(dump).not.toContain(agentSecret);
    expect(dump).not.toContain(code);
  });
});
