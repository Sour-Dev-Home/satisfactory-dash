import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { backoffDelayMs } from "./backoff.js";
import { CommandLedger } from "./ledger.js";
import { BoundedQueue } from "./queue.js";
import { AGENT_VERSION } from "./version.js";

describe("backoffDelayMs", () => {
  it("grows exponentially from the base, capped, with equal jitter (half fixed, half random)", () => {
    const low = { random: () => 0 };
    const high = { random: () => 0.999999 };
    expect([0, 1, 2, 3].map((attempt) => backoffDelayMs(attempt, { ...low, baseMs: 1000, maxMs: 60_000 }))).toEqual([500, 1000, 2000, 4000]);
    expect([0, 1, 2, 3].map((attempt) => backoffDelayMs(attempt, { ...high, baseMs: 1000, maxMs: 60_000 }))).toEqual([1000, 2000, 4000, 8000]);
    expect(backoffDelayMs(20, { ...low, baseMs: 1000, maxMs: 60_000 })).toBe(30_000);
    expect(backoffDelayMs(20, { ...high, baseMs: 1000, maxMs: 60_000 })).toBe(60_000);
  });

  it("never collapses to about zero, never exceeds the cap, and survives silly attempts", () => {
    for (const attempt of [0, 5, 50, 1_000_000, -3, Number.NaN]) {
      for (const random of [() => 0, () => 0.5, () => 0.999999]) {
        const delay = backoffDelayMs(attempt, { baseMs: 1000, maxMs: 60_000, random });
        expect(delay).toBeGreaterThanOrEqual(500);
        expect(delay).toBeLessThanOrEqual(60_000);
      }
    }
  });

  it("two agents that fail together do not retry together (different random draws give different delays)", () => {
    const delays = new Set([0.1, 0.4, 0.7, 0.95].map((value) => backoffDelayMs(4, { random: () => value })));
    expect(delays.size).toBe(4);
  });
});

describe("BoundedQueue", () => {
  it("drops the OLDEST when full and says how many, keeping the newest in order", () => {
    const queue = new BoundedQueue<number>(3);
    expect([1, 2, 3].map((n) => queue.push(n))).toEqual([0, 0, 0]);
    expect(queue.push(4)).toBe(1);
    expect(queue.push(5)).toBe(1);
    expect(queue.size).toBe(3);
    expect([queue.shift(), queue.shift(), queue.shift(), queue.shift()]).toEqual([3, 4, 5, undefined]);
  });

  it("peek does not remove; an empty queue is undefined; a capacity below one is refused", () => {
    const queue = new BoundedQueue<string>(2);
    expect(queue.peek()).toBeUndefined();
    queue.push("a");
    expect(queue.peek()).toBe("a");
    expect(queue.size).toBe(1);
    expect(() => new BoundedQueue(0)).toThrow(RangeError);
    expect(() => new BoundedQueue(1.5)).toThrow(RangeError);
  });
});

describe("CommandLedger", () => {
  it("runs a command once: a duplicate while it runs is `running`, after it finishes it is `done` with the SAME result", () => {
    let now = 1_000;
    const ledger = new CommandLedger(() => now);
    expect(ledger.begin("c1", 61_000)).toEqual({ kind: "new" });
    expect(ledger.begin("c1", 61_000)).toEqual({ kind: "running" });
    ledger.finish("c1", { ok: false, code: "upstream_error" });
    now += 10_000;
    expect(ledger.begin("c1", 61_000)).toEqual({ kind: "done", result: { ok: false, code: "upstream_error" } });
  });

  it("remembers an id only until the command's own expiry, then forgets it", () => {
    let now = 1_000;
    const ledger = new CommandLedger(() => now);
    ledger.begin("c1", 61_000);
    ledger.finish("c1", { ok: true });
    now = 60_999;
    expect(ledger.begin("c1", 61_000).kind).toBe("done");
    now = 61_000; // exactly at expiry: forgotten (the backend no longer hands it out either)
    expect(ledger.begin("c1", 121_000)).toEqual({ kind: "new" });
  });

  it("is bounded: past the maximum the oldest ids are forgotten, never the newest", () => {
    const ledger = new CommandLedger(() => 0, 3);
    for (const id of ["a", "b", "c", "d"]) ledger.begin(id, 1_000_000);
    expect(ledger.size).toBe(3);
    expect(ledger.begin("d", 1_000_000).kind).toBe("running");
    expect(ledger.begin("a", 1_000_000).kind).toBe("new"); // forgotten
  });

  it("finishing an id it never accepted does nothing", () => {
    const ledger = new CommandLedger(() => 0);
    ledger.finish("ghost", { ok: true });
    expect(ledger.size).toBe(0);
  });
});

describe("AGENT_VERSION", () => {
  it("matches package.json and fits the contract's 32 characters", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(AGENT_VERSION).toBe(pkg.version);
    expect(AGENT_VERSION.length).toBeGreaterThan(0);
    expect(AGENT_VERSION.length).toBeLessThanOrEqual(32);
  });
});
