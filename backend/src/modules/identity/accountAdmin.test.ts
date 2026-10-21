import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: string[] = [];
const audit = vi.fn();
let known = true;

vi.mock("../../platform/audit/auditRepository.js", () => ({
  recordAuditEvent: (_db: unknown, event: unknown) => {
    calls.push("audit");
    audit(event);
    return Promise.resolve({});
  },
}));
vi.mock("./repositories/userRepository.js", () => ({
  setUserStatus: (_db: unknown, _id: string, status: string) => {
    calls.push(`status:${status}`);
    return Promise.resolve(known);
  },
}));
vi.mock("./repositories/sessionRepository.js", () => ({
  revokeAllSessionsForUser: () => {
    calls.push("revoke");
    return Promise.resolve(3);
  },
}));

const { disableUserAdmin, enableUserAdmin } = await import("./accountAdmin.js");

const USER = "11111111-1111-4111-8111-111111111111";

function fakePool() {
  const sql: string[] = [];
  const client = { query: (text: string) => (sql.push(text), Promise.resolve({ rows: [] })), on: () => undefined, removeListener: () => undefined, release: () => undefined };
  return { pool: { connect: () => Promise.resolve(client) } as never, sql };
}

describe("account admin (#516)", () => {
  beforeEach(() => {
    calls.length = 0;
    audit.mockClear();
    known = true;
  });

  it("disable sets the status, revokes the sessions and audits ids and a count, in one transaction", async () => {
    const { pool, sql } = fakePool();
    expect(await disableUserAdmin(pool, USER)).toEqual({ found: true, sessionsRevoked: 3 });
    expect(calls).toEqual(["status:disabled", "revoke", "audit"]);
    expect(audit).toHaveBeenCalledWith({ action: "user.disabled", detail: { userId: USER, sessionsRevoked: 3 } });
    expect(sql).toEqual(["BEGIN", "COMMIT"]);
  });

  it("enable sets the status back to active and audits the id only", async () => {
    const { pool } = fakePool();
    expect(await enableUserAdmin(pool, USER)).toEqual({ found: true, sessionsRevoked: 3 });
    // It also revokes stragglers: a sign-in that raced the disable must not come alive on enable.
    expect(calls).toEqual(["status:active", "revoke", "audit"]);
    expect(audit).toHaveBeenCalledWith({ action: "user.enabled", detail: { userId: USER } });
  });

  it("an unknown account changes nothing and writes no audit row", async () => {
    known = false;
    const { pool } = fakePool();
    expect(await disableUserAdmin(pool, USER)).toEqual({ found: false });
    expect(await enableUserAdmin(pool, USER)).toEqual({ found: false });
    expect(calls).not.toContain("audit");
    expect(calls).not.toContain("revoke");
  });
});
