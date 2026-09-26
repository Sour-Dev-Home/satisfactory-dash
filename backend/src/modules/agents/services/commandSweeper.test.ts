import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import type { Queryable } from "../../../platform/db/schemaVersion.js";
import { COMMAND_RETENTION_DAYS } from "../repositories/commandRepository.js";
import { CommandSweeper, SWEEP_INTERVAL_MS } from "./commandSweeper.js";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(behaviour: { expire?: () => unknown[]; purge?: () => unknown[] } = {}) {
  const statements: { text: string; values: unknown[] }[] = [];
  const db: Queryable = {
    async query(text, values = []) {
      statements.push({ text, values });
      if (text.includes("SET status = 'expired'")) return { rows: behaviour.expire?.() ?? [] };
      if (text.includes("DELETE FROM agents.commands")) return { rows: behaviour.purge?.() ?? [] };
      return { rows: [] };
    },
  };
  const lines: { level: string; obj: unknown; msg: string }[] = [];
  const log = (level: string) => (obj: unknown, msg?: string) => lines.push({ level, obj: typeof obj === "string" ? {} : obj, msg: typeof obj === "string" ? obj : (msg ?? "") });
  const logger = { info: log("info"), warn: log("warn") } as unknown as Logger;
  return { statements, lines, sweeper: new CommandSweeper(db, { logger }) };
}
const kindsOf = (statements: { text: string }[]) => statements.map((s) => (s.text.includes("SET status = 'expired'") ? "expire" : "purge"));

describe("CommandSweeper", () => {
  it("expires stale commands on every sweep, and purges old finished ones on the first and then about once an hour", async () => {
    const { sweeper, statements } = setup();
    await sweeper.sweep();
    expect(kindsOf(statements)).toEqual(["expire", "purge"]);
    for (let i = 0; i < 239; i++) await sweeper.sweep();
    expect(kindsOf(statements).filter((k) => k === "purge")).toHaveLength(1);
    await sweeper.sweep(); // the 241st: one hour of 15-second sweeps later
    expect(kindsOf(statements).filter((k) => k === "purge")).toHaveLength(2);
  });

  it("purges only finished commands older than the retention, never an open one", async () => {
    const { sweeper, statements } = setup();
    await sweeper.sweep();
    const purge = statements.find((s) => s.text.includes("DELETE FROM agents.commands"))!;
    expect(purge.text).toContain("status IN ('succeeded', 'failed', 'expired')");
    expect(purge.values).toEqual([COMMAND_RETENTION_DAYS]);
  });

  it("logs how many it expired, and nothing when there were none", async () => {
    const some = setup({ expire: () => [{ id: "a" }, { id: "b" }] });
    await some.sweeper.sweep();
    expect(some.lines).toEqual([{ level: "info", obj: { expired: 2 }, msg: "agent commands expired without a result" }]);
    const none = setup();
    await none.sweeper.sweep();
    expect(none.lines).toEqual([]);
  });

  it("a failing sweep is logged once per run of failures, never thrown, and a recovery is logged", async () => {
    let failing = true;
    const { sweeper, lines } = setup({
      expire: () => {
        if (failing) throw new Error("db down");
        return [];
      },
    });
    await expect(sweeper.sweep()).resolves.toBeUndefined();
    await sweeper.sweep();
    await sweeper.sweep();
    expect(lines.filter((l) => l.level === "warn")).toHaveLength(1);
    failing = false;
    await sweeper.sweep();
    expect(lines.map((l) => l.msg)).toEqual(["sweeping agent commands failed; trying again", "command sweeping recovered"]);
  });

  it("runs every 15 seconds once started, and stop() ends it and waits for a sweep in flight", async () => {
    const { sweeper, statements } = setup();
    sweeper.start();
    sweeper.start(); // idempotent
    expect(statements).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    expect(kindsOf(statements)).toEqual(["expire", "purge"]);
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    expect(kindsOf(statements)).toEqual(["expire", "purge", "expire"]);
    await sweeper.stop();
    const after = statements.length;
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS * 4);
    expect(statements).toHaveLength(after);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a stopped sweeper stays stopped (start after stop does nothing)", async () => {
    const { sweeper, statements } = setup();
    await sweeper.stop();
    sweeper.start();
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS * 2);
    expect(statements).toHaveLength(0);
  });
});
