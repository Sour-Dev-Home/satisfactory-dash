import type { PoolClient } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { backgroundAggregator } from "../metrics/backgroundMetrics.js";
import { DB_QUERY_METRIC, timedQuery } from "./timedQuery.js";
import { withTransaction } from "./transaction.js";

const NAME = "identity.consumeLoginAttempt";
const OTHER = "identity.deleteExpiredLoginAttempts";
const SQL = "SELECT secret_column FROM identity.users WHERE email = $1";

function queryRecordings() {
  return backgroundAggregator.drain().filter((d) => d.metric === DB_QUERY_METRIC);
}

beforeEach(() => {
  backgroundAggregator.drain();
});

describe("timedQuery", () => {
  it("returns the query's own result and records one duration labelled by the name on success", async () => {
    const result = { rows: [{ a: 1 }], rowCount: 1 };
    const db = { query: vi.fn().mockResolvedValue(result) };

    await expect(timedQuery(db, NAME, SQL, ["x@example.com"])).resolves.toBe(result);

    expect(db.query).toHaveBeenCalledExactlyOnceWith(SQL, ["x@example.com"]);
    const recorded = queryRecordings();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ labels: { query: NAME }, count: 1 });
    expect(recorded[0].sum).toBeGreaterThanOrEqual(0);
  });

  it("rethrows the very same error and still records the duration on failure", async () => {
    const err = Object.assign(new Error("duplicate key"), { code: "23505" });
    const db = { query: vi.fn().mockRejectedValue(err) };

    await expect(timedQuery(db, NAME, SQL, [1])).rejects.toBe(err);

    expect(queryRecordings()).toEqual([expect.objectContaining({ labels: { query: NAME }, count: 1 })]);
  });

  it("passes no params argument at all when none is given, as the call sites did before", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };

    await timedQuery(db, OTHER, "SELECT 1");

    expect(db.query.mock.calls[0]).toEqual(["SELECT 1"]);
  });

  it("calls query as a method of the given db, so a pool or client keeps its `this`", async () => {
    const db = {
      rows: [{ ok: true }],
      query(this: { rows: unknown[] }) {
        return Promise.resolve({ rows: this.rows });
      },
    };

    await expect(timedQuery(db, NAME, SQL)).resolves.toEqual({ rows: [{ ok: true }] });
  });

  it("never puts the SQL, a param or a result in a label", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ email: "x@example.com" }] }) };

    await timedQuery(db, NAME, SQL, ["x@example.com"]);
    await timedQuery({ query: vi.fn().mockRejectedValue(new Error(SQL)) }, OTHER, SQL, ["p"]).catch(() => undefined);

    const recorded = queryRecordings();
    expect(recorded.map((d) => d.labels)).toEqual([{ query: NAME }, { query: OTHER }]);
    expect(JSON.stringify(recorded)).not.toMatch(/example\.com|SELECT|secret_column/);
  });

  it("accumulates repeated calls under one name and keeps different names apart", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };

    await timedQuery(db, NAME, SQL);
    await timedQuery(db, NAME, SQL);
    await timedQuery(db, OTHER, SQL);

    const byName = new Map(queryRecordings().map((d) => [d.labels.query, d.count]));
    expect(byName).toEqual(new Map([[NAME, 2], [OTHER, 1]]));
  });

  it("keeps a transaction's behaviour: the client's statements run in order, and an error rolls back and rethrows", async () => {
    const calls: string[] = [];
    const failure = new Error("boom");
    const client = {
      query: vi.fn(async (sql: string) => {
        calls.push(sql);
        if (sql === "FAIL") throw failure;
        return { rows: [{ n: 1 }] };
      }),
      on: vi.fn(),
      removeListener: vi.fn(),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn().mockResolvedValue(client as unknown as PoolClient) };

    const ok = await withTransaction(pool, async (c) => (await timedQuery(c, NAME, "SELECT n")).rows);
    expect(ok).toEqual([{ n: 1 }]);
    expect(calls).toEqual(["BEGIN", "SELECT n", "COMMIT"]);

    calls.length = 0;
    await expect(withTransaction(pool, (c) => timedQuery(c, OTHER, "FAIL"))).rejects.toBe(failure);
    expect(calls).toEqual(["BEGIN", "FAIL", "ROLLBACK"]);
    expect(client.release).toHaveBeenLastCalledWith(false);
  });
});
