import { describe, it, expect } from "vitest";
import { createSession, MAX_TTL_SECONDS, newSessionId } from "../../modules/identity/repositories/sessionRepository.js";
import { listRecentAuditEvents } from "../audit/auditRepository.js";
import type { Queryable } from "./schemaVersion.js";

function fakeDb(): { db: Queryable; calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    db: {
      query: (_text: string, values?: unknown[]) => {
        calls.push(values ?? []);
        return Promise.resolve({ rows: [] });
      },
    },
  };
}

describe("createSession ttl guard (no database needed)", () => {
  const user = "00000000-0000-4000-8000-000000000001";
  it.each([0, -5, 0.4, Number.NaN, Number.POSITIVE_INFINITY, MAX_TTL_SECONDS + 1, 2 ** 40])("refuses ttlSeconds %s before querying", async (ttl) => {
    const { db, calls } = fakeDb();
    await expect(createSession(db, { idHash: newSessionId().idHash, userId: user, ttlSeconds: ttl })).rejects.toThrow(RangeError);
    expect(calls).toHaveLength(0);
  });

  it("truncates a fractional ttl and passes an integer", async () => {
    const { db, calls } = fakeDb();
    await createSession(db, { idHash: newSessionId().idHash, userId: user, ttlSeconds: 90.9 });
    expect(calls[0]?.[2]).toBe(90);
  });
});

describe("listRecentAuditEvents limit (no database needed)", () => {
  it.each([
    [Number.NaN, 50],
    [Number.POSITIVE_INFINITY, 500],
    [Number.NEGATIVE_INFINITY, 1],
    [-3, 1],
    [7.9, 7],
  ])("limit %s reaches the query as %s", async (limit, expected) => {
    const { db, calls } = fakeDb();
    await listRecentAuditEvents(db, { limit });
    expect(calls[0]?.[1]).toBe(expected);
  });
});
