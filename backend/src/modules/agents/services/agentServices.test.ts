import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { ApiFailure, ForbiddenError, RateLimitedError, ServerNotFoundError, ServiceUnavailableError } from "../../../platform/errorResponse.js";
import { createLogger } from "../../../platform/logger.js";
import { UserRateLimiter } from "../../../platform/userRateLimiter.js";
import { sha256 } from "../repositories/agentRepository.js";
import { createAgentsService } from "./agentsService.js";
import { createEnrollmentService } from "./enrollmentService.js";

const CADENCE = { statusSeconds: 5, powerSeconds: 5, factorySeconds: 30 };
const SERVER_UUID = "11111111-1111-4111-8111-111111111111";

/** A pool whose one client answers by statement, and remembers every statement in order (with BEGIN/COMMIT/ROLLBACK). */
function fakePool(answer: (text: string, values: unknown[]) => { rows: unknown[] } | Error) {
  const log: { text: string; values: unknown[] }[] = [];
  const client = Object.assign(new EventEmitter(), {
    async query(text: string, values: unknown[] = []) {
      log.push({ text, values });
      const result = answer(text, values);
      if (result instanceof Error) throw result;
      return result;
    },
    release() {},
  }) as unknown as PoolClient;
  return { log, pool: { connect: async () => client, query: client.query.bind(client) } as never };
}
const kinds = (log: { text: string }[]) =>
  log.map(({ text }) => {
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text)) return text;
    if (text.includes("SELECT s.public_id AS public_id")) return "find-code";
    if (text.includes("UPDATE agents.enrollment_codes")) return "consume";
    if (text.includes("INSERT INTO agents.agent_credentials")) return "credential";
    if (text.includes("SET connection_kind = 'agent'")) return "switch";
    if (text.includes("DELETE FROM servers.server_connections")) return "delete-connection";
    if (text.includes("INSERT INTO audit.audit_events")) return "audit";
    if (text.includes("FOR NO KEY UPDATE")) return "lock";
    if (text.includes("DELETE FROM agents.enrollment_codes")) return "delete-codes";
    if (text.includes("INSERT INTO agents.enrollment_codes")) return "insert-code";
    if (text.includes("UPDATE agents.agent_credentials")) return "revoke";
    return text.slice(0, 30);
  });

const auditRow = { rows: [{ id: 1, at: new Date(), actor_user_id: null, server_id: SERVER_UUID, action: "x", detail: {} }] };

describe("the enrolment transaction", () => {
  const happy = (text: string) => {
    if (text.includes("SELECT s.public_id AS public_id")) return { rows: [{ public_id: "alpha" }] };
    if (text.includes("FOR NO KEY UPDATE")) return { rows: [{ id: SERVER_UUID, connection_kind: "local" }] };
    if (text.includes("UPDATE agents.enrollment_codes")) return { rows: [{ server_id: SERVER_UUID }] };
    if (text.includes("SET connection_kind = 'agent'")) return { rows: [{ public_id: "alpha" }] };
    if (text.includes("INSERT INTO audit.audit_events")) return auditRow;
    return { rows: [] };
  };
  const silent = createLogger({ level: "silent" }, { write: () => {} });

  it("spends the code, stores the credential's hash, switches the server, drops its tokens and audits: all in one transaction", async () => {
    const { pool, log } = fakePool(happy);
    const attach = vi.fn(async () => undefined);
    const service = createEnrollmentService({ db: pool, cadence: () => CADENCE, attachAgentRuntime: attach, logger: silent });
    const result = await service.enroll("AB3D-7XQ2", "0.1.0");
    // The server row is locked BEFORE the code is spent: the order code creation and revoke use, so they cannot deadlock.
    expect(kinds(log)).toEqual(["BEGIN", "find-code", "lock", "consume", "credential", "switch", "delete-connection", "audit", "COMMIT"]);
    expect(result).toMatchObject({ serverId: "alpha", cadence: CADENCE });
    expect(result.agentSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The code is looked up by its hash, and the secret is stored as its hash.
    expect(log[3]!.values[0]).toEqual(sha256("AB3D-7XQ2"));
    expect(log[4]!.values).toEqual([SERVER_UUID, sha256(result.agentSecret), "0.1.0"]);
    // Nothing in any statement carries the secret or the code in clear.
    expect(JSON.stringify(log)).not.toContain(result.agentSecret);
    expect(JSON.stringify(log)).not.toContain("AB3D-7XQ2");
    // The running entry is swapped only after the commit.
    expect(attach).toHaveBeenCalledWith("alpha");
  });

  it("an unknown, used or expired code writes nothing and never touches the running server", async () => {
    const { pool, log } = fakePool(() => ({ rows: [] }));
    const attach = vi.fn(async () => undefined);
    const service = createEnrollmentService({ db: pool, cadence: () => CADENCE, attachAgentRuntime: attach, logger: silent });
    const failure = await service.enroll("AB3D-7XQ2", "0.1.0").catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(ApiFailure);
    expect((failure as ApiFailure).code).toBe("enrollment_code_invalid");
    expect(kinds(log)).toEqual(["BEGIN", "find-code", "ROLLBACK"]);
    expect(attach).not.toHaveBeenCalled();
  });

  it("a server removed between the statements rolls the spent code back too", async () => {
    const { pool, log } = fakePool((text) => {
      if (text.includes("SET connection_kind = 'agent'")) return { rows: [] };
      return happy(text);
    });
    const attach = vi.fn(async () => undefined);
    const service = createEnrollmentService({ db: pool, cadence: () => CADENCE, attachAgentRuntime: attach, logger: silent });
    const failure = await service.enroll("AB3D-7XQ2", "0.1.0").catch((err: unknown) => err);
    expect((failure as ApiFailure).code).toBe("enrollment_code_invalid");
    expect(kinds(log).at(-1)).toBe("ROLLBACK");
    expect(kinds(log)).not.toContain("COMMIT");
    expect(attach).not.toHaveBeenCalled();
  });

  it("still succeeds, and logs only the server id, when the swap after the commit fails", async () => {
    const lines: string[] = [];
    const { pool } = fakePool(happy);
    const service = createEnrollmentService({
      db: pool,
      cadence: () => CADENCE,
      attachAgentRuntime: async () => {
        throw new Error("the secret is hunter2");
      },
      logger: createLogger({ level: "info" }, { write: (line: string) => lines.push(line) }),
    });
    const result = await service.enroll("AB3D-7XQ2", "0.1.0");
    expect(result.agentSecret).toBeTruthy();
    expect(lines.join("")).toContain("alpha");
    expect(lines.join("")).not.toContain("hunter2");
    expect(lines.join("")).not.toContain(result.agentSecret);
  });

  it("a database outage is a 503, not a 400 (the agent keeps its code and retries)", async () => {
    const { pool } = fakePool(() => Object.assign(new Error("boom"), { code: "ECONNREFUSED" }));
    const service = createEnrollmentService({ db: pool, cadence: () => CADENCE, attachAgentRuntime: async () => undefined, logger: silent });
    expect(await service.enroll("AB3D-7XQ2", "0.1.0").catch((err: unknown) => err)).toBeInstanceOf(ServiceUnavailableError);
  });
});

describe("the user-facing agents service", () => {
  const lockRow = (kind: string) => (text: string) => {
    if (text.includes("FOR NO KEY UPDATE")) return { rows: [{ id: SERVER_UUID, connection_kind: kind }] };
    if (text.includes("INSERT INTO agents.enrollment_codes")) return { rows: [{ id: "c1" }] };
    if (text.includes("INSERT INTO audit.audit_events")) return auditRow;
    if (text.includes("UPDATE agents.agent_credentials")) return { rows: [{ server_id: SERVER_UUID }] };
    return { rows: [] };
  };

  it("creates a code for an agent server: drops the old one, stores the hash with a 10-minute expiry, audits without the code", async () => {
    const { pool, log } = fakePool(lockRow("agent"));
    const service = createAgentsService({ db: pool, canManage: () => false, now: () => 1_000_000 });
    const { code, expiresAt } = await service.createEnrollmentCode("alpha", "user-1");
    expect(code).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    expect(expiresAt).toBe(new Date(1_000_000 + 600_000).toISOString());
    expect(kinds(log)).toEqual(["BEGIN", "lock", "delete-codes", "insert-code", "audit", "COMMIT"]);
    expect(log[3]!.values[1]).toEqual(sha256(code));
    expect(JSON.stringify(log)).not.toContain(code);
  });

  it("for a server this backend reaches directly, only the operator may create a code", async () => {
    const refused = fakePool(lockRow("local"));
    const service = createAgentsService({ db: refused.pool, canManage: (userId) => userId === "operator" });
    expect(await service.createEnrollmentCode("alpha", "owner").catch((err: unknown) => err)).toBeInstanceOf(ForbiddenError);
    expect(kinds(refused.log)).toEqual(["BEGIN", "lock", "ROLLBACK"]);
    const allowed = fakePool(lockRow("local"));
    const operator = createAgentsService({ db: allowed.pool, canManage: (userId) => userId === "operator" });
    await expect(operator.createEnrollmentCode("alpha", "operator")).resolves.toHaveProperty("code");
  });

  it("an unknown server is not found, for a code and for a revoke", async () => {
    const { pool } = fakePool(() => ({ rows: [] }));
    const service = createAgentsService({ db: pool, canManage: () => true });
    expect(await service.createEnrollmentCode("nope", "u").catch((err: unknown) => err)).toBeInstanceOf(ServerNotFoundError);
    expect(await service.revoke("nope", "u").catch((err: unknown) => err)).toBeInstanceOf(ServerNotFoundError);
  });

  it("limits how many codes a user can create per minute", async () => {
    const { pool } = fakePool(lockRow("agent"));
    const service = createAgentsService({ db: pool, canManage: () => true, limiter: new UserRateLimiter({ max: 1, windowMs: 60_000 }) });
    await service.createEnrollmentCode("alpha", "u");
    expect(await service.createEnrollmentCode("alpha", "u").catch((err: unknown) => err)).toBeInstanceOf(RateLimitedError);
  });

  it("revokes: drops any open code first, then marks the credential revoked and audits it; idempotent when nothing was enrolled", async () => {
    const enrolled = fakePool(lockRow("agent"));
    const service = createAgentsService({ db: enrolled.pool, canManage: () => false });
    expect(await service.revoke("alpha", "user-1")).toEqual({ revoked: true });
    expect(kinds(enrolled.log)).toEqual(["BEGIN", "lock", "delete-codes", "revoke", "audit", "COMMIT"]);
    const none = fakePool((text) => (text.includes("UPDATE agents.agent_credentials") ? { rows: [] } : lockRow("agent")(text)));
    const again = createAgentsService({ db: none.pool, canManage: () => false });
    expect(await again.revoke("alpha", "user-1")).toEqual({ revoked: true });
    expect(kinds(none.log)).not.toContain("audit");
  });

  it("reads the status: a revoked credential reads as not enrolled, without a version or a time", async () => {
    const { pool } = fakePool(() => ({ rows: [{ connection_kind: "agent", enrolled: false, last_seen_at: new Date(), agent_version: "0.1.0" }] }));
    const service = createAgentsService({ db: pool, canManage: () => false });
    expect(await service.getStatus("alpha")).toEqual({ enrolled: false, lastSeenAt: null, agentVersion: null, connectionKind: "agent" });
  });
});
