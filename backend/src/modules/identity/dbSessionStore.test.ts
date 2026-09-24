import { describe, it, expect, vi } from "vitest";
import { createDbSessionStore } from "./dbSessionStore.js";
import type { Db } from "./dbSessionStore.js";
import { ServiceUnavailableError, UnauthorizedError } from "../../platform/errorResponse.js";
import { PURGE_INTERVAL_MS, createSessionPurgeWorker, purgeExpired } from "./sessionPurge.js";

type Handler = (sql: string, params: unknown[]) => { rows: unknown[] } | Error;

/** A scripted database: the first matching [substring, handler] answers; every call is recorded. */
function fakeDb(handlers: Array<[string, Handler]>) {
  const calls: string[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push(sql.trim().split(/\s+/).slice(0, 3).join(" "));
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) {
      return { rows: [] };
    }
    for (const [needle, handler] of handlers) {
      if (sql.includes(needle)) {
        const out = handler(sql, params);
        if (out instanceof Error) {
          throw out;
        }
        return out;
      }
    }
    throw new Error(`unscripted query: ${sql.slice(0, 60)}`);
  });
  const client = { query, on: vi.fn(), removeListener: vi.fn(), release: vi.fn() };
  const db = { query, connect: async () => client } as unknown as Db;
  return { db, calls, query, client };
}

const VALID_ID = "A".repeat(43);
const connRefused = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });

const activeRow = (lastSeen: Date | null) => ({
  rows: [
    {
      user_id: "u1",
      display_name: "op",
      email: null,
      expires_at: new Date(Date.now() + 1000),
      last_seen_at: lastSeen,
      providers: ["local"],
    },
  ],
});

describe("db session store: resolve", () => {
  it.each([undefined, "", "short", "A".repeat(42), "A".repeat(44), `${"A".repeat(42)}.`, `${"A".repeat(42)} `])(
    "refuses %j without asking the database",
    async (value) => {
      const { db, query } = fakeDb([]);
      expect(await createDbSessionStore(db).resolve(value)).toBeNull();
      expect(query).not.toHaveBeenCalled();
    },
  );

  it("an outage is a ServiceUnavailableError, never null", async () => {
    const { db } = fakeDb([["FROM identity.sessions", () => connRefused]]);
    await expect(createDbSessionStore(db).resolve(VALID_ID)).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it("a non-outage database error is not turned into a 503", async () => {
    const bug = Object.assign(new Error("syntax"), { code: "42601" });
    const { db } = fakeDb([["FROM identity.sessions", () => bug]]);
    const err = await createDbSessionStore(db).resolve(VALID_ID).catch((e: unknown) => e);
    expect(err).toBe(bug);
  });

  it("touches only when never seen or last seen over a minute ago", async () => {
    for (const [lastSeen, expectTouch] of [
      [null, true],
      [new Date(Date.now() - 61_000), true],
      [new Date(Date.now() - 30_000), false],
    ] as const) {
      const { db, calls } = fakeDb([
        ["SELECT s.user_id", () => activeRow(lastSeen)],
        ["UPDATE identity.sessions", () => ({ rows: [{ touched: 1 }] })],
      ]);
      expect(await createDbSessionStore(db).resolve(VALID_ID)).toMatchObject({ id: "u1", authMethods: ["password"] });
      expect(calls.some((c) => c.startsWith("UPDATE"))).toBe(expectTouch);
    }
  });

  it("a failing touch (even an outage) never fails the request", async () => {
    const { db } = fakeDb([
      ["SELECT s.user_id", () => activeRow(null)],
      ["UPDATE identity.sessions", () => connRefused],
    ]);
    expect(await createDbSessionStore(db).resolve(VALID_ID)).toMatchObject({ id: "u1" });
  });

  it("omits email when null and never leaks the session hash", async () => {
    const { db } = fakeDb([["SELECT s.user_id", () => activeRow(new Date())]]);
    const user = await createDbSessionStore(db).resolve(VALID_ID);
    expect(user).not.toHaveProperty("email");
  });
});

describe("db session store: revoke and revokeAllFor", () => {
  it("revoke of a malformed or empty cookie is a silent no-op", async () => {
    const { db, query } = fakeDb([]);
    const store = createDbSessionStore(db);
    await store.revoke(undefined);
    await store.revoke("junk");
    expect(query).not.toHaveBeenCalled();
  });

  it("revoke of an unknown session writes no audit row", async () => {
    const { db, calls } = fakeDb([["UPDATE identity.sessions", () => ({ rows: [] })]]);
    await createDbSessionStore(db).revoke(VALID_ID);
    expect(calls.some((c) => c.includes("audit"))).toBe(false);
  });

  it("revoke during an outage is a 503 and rolls back", async () => {
    const { db, calls, client } = fakeDb([["UPDATE identity.sessions", () => connRefused]]);
    await expect(createDbSessionStore(db).revoke(VALID_ID)).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(calls).toContain("ROLLBACK");
    expect(client.release).toHaveBeenCalled();
  });

  it("revokeAllFor returns the count and audits it, ids only", async () => {
    const audits: unknown[][] = [];
    const { db } = fakeDb([
      ["UPDATE identity.sessions", () => ({ rows: [{ revoked: 1 }, { revoked: 1 }] })],
      [
        "INSERT INTO audit",
        (_sql, params) => {
          audits.push(params);
          return { rows: [{ id: 1, at: new Date(), actor_user_id: "u1", server_id: null, action: "logout_all", detail: {} }] };
        },
      ],
    ]);
    expect(await createDbSessionStore(db).revokeAllFor({ id: "u1", name: "op" })).toBe(2);
    expect(audits[0]).toEqual(["u1", null, "logout_all", JSON.stringify({ count: 2 })]);
  });
});

describe("db session store: create", () => {
  it("a disabled account gets the wrong-password answer (401), not a 503 or a session", async () => {
    const { db, calls } = fakeDb([
      ["SELECT u.id", () => ({ rows: [{ id: "u1", display_name: "op", email: null, status: "disabled", created_at: new Date() }] })],
    ]);
    const err = await createDbSessionStore(db).create({ subject: "operator", name: "op" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(calls.some((c) => c.startsWith("INSERT"))).toBe(false);
  });

  it("an outage while creating is a 503", async () => {
    const { db } = fakeDb([["identity", () => connRefused]]);
    await expect(createDbSessionStore(db).create({ subject: "operator", name: "op" })).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
  });
});

describe("recognizes", () => {
  it("accepts exactly 43 base64url chars", () => {
    const store = createDbSessionStore(fakeDb([]).db);
    expect(store.recognizes(VALID_ID)).toBe(true);
    expect(store.recognizes(`${VALID_ID}\n`)).toBe(false); // `$` must not allow a trailing newline
    expect(store.recognizes("a.b.c")).toBe(false);
  });
});

describe("session purge", () => {
  it("drains full batches, stops at a short one, and totals", async () => {
    const sessionBatches = [1000, 1000, 7];
    const { db } = fakeDb([
      ["FROM identity.sessions", () => ({ rows: Array.from({ length: sessionBatches.shift() ?? 0 }, () => ({ deleted: 1 })) })],
      ["FROM identity.login_attempts", () => ({ rows: [] })],
    ]);
    expect(await purgeExpired(db)).toEqual({ sessions: 2007, loginAttempts: 0 });
  });

  it("caps a run at 100 batches so a backlog cannot loop forever", async () => {
    const { db, query } = fakeDb([
      ["FROM identity.sessions", () => ({ rows: Array.from({ length: 1000 }, () => ({ deleted: 1 })) })],
      ["FROM identity.login_attempts", () => ({ rows: [] })],
    ]);
    expect((await purgeExpired(db)).sessions).toBe(100_000);
    expect(query).toHaveBeenCalledTimes(101);
  });

  it("worker logs a failure without throwing, is idempotent to start, and stops the timer", async () => {
    vi.useFakeTimers();
    try {
      const { db, query } = fakeDb([["identity", () => connRefused]]);
      const logger = { info: vi.fn(), warn: vi.fn() };
      const worker = createSessionPurgeWorker(db, logger);
      worker.start();
      worker.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      const callsAfterStart = query.mock.calls.length;
      await vi.advanceTimersByTimeAsync(PURGE_INTERVAL_MS);
      expect(logger.warn).toHaveBeenCalledTimes(2);
      await worker.stop();
      await vi.advanceTimersByTimeAsync(PURGE_INTERVAL_MS * 3);
      expect(logger.warn).toHaveBeenCalledTimes(2);
      expect(query.mock.calls.length).toBeGreaterThan(callsAfterStart);
    } finally {
      vi.useRealTimers();
    }
  });
});
