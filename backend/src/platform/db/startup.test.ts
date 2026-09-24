import { describe, it, expect, vi } from "vitest";
import { DatabaseSetupError } from "./errors.js";
import { connectWithBackoff } from "./startup.js";

const withCode = (code: string) => Object.assign(new Error("boom postgres://u:hunter2@h/d"), { code });

function harness(deadlineMs = 300_000) {
  let clock = 0;
  const sleeps: number[] = [];
  const logs: object[] = [];
  return {
    sleeps,
    logs,
    options: {
      logger: { warn: (obj: object) => void logs.push(obj) },
      deadlineMs,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        clock += ms;
      },
      now: () => clock,
    },
  };
}

describe("connectWithBackoff", () => {
  it("returns at once when the first attempt works", async () => {
    const h = harness();
    await expect(connectWithBackoff(async () => "ok", h.options)).resolves.toBe("ok");
    expect(h.sleeps).toEqual([]);
  });

  it("retries transient errors with a doubling delay, capped at 30 s, then succeeds", async () => {
    const h = harness();
    let calls = 0;
    const result = await connectWithBackoff(async () => {
      calls++;
      if (calls <= 8) {
        throw withCode(calls % 2 ? "ECONNREFUSED" : "57P03");
      }
      return "up";
    }, h.options);
    expect(result).toBe("up");
    expect(h.sleeps).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    expect(h.logs).toHaveLength(8);
    expect(JSON.stringify(h.logs)).not.toContain("hunter2");
  });

  it("gives up after the deadline with a DatabaseSetupError that never quotes the driver", async () => {
    const h = harness(60_000);
    let error: unknown;
    try {
      await connectWithBackoff(async () => {
        throw withCode("ECONNREFUSED");
      }, h.options);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(DatabaseSetupError);
    expect((error as Error).message).toMatch(/did not come up before the startup deadline/);
    expect((error as Error).message).not.toContain("hunter2");
    expect(h.sleeps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(60_000);
  });

  it.each(["28P01", "3D000", "ENOTFOUND", "42P01"])("fails fast on %s without retrying", async (code) => {
    const h = harness();
    const attempt = vi.fn(async () => {
      throw withCode(code);
    });
    await expect(connectWithBackoff(attempt, h.options)).rejects.toBeInstanceOf(DatabaseSetupError);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(h.sleeps).toEqual([]);
  });

  it("does not double the period when the reason already ends with one", async () => {
    const h = harness();
    await expect(
      connectWithBackoff(async () => {
        throw new DatabaseSetupError("Run npm run db:migrate.");
      }, h.options),
    ).rejects.toThrow(/^Cannot start: Run npm run db:migrate\.$/);
  });

  it("fails fast on a schema problem raised by the attempt itself", async () => {
    const h = harness();
    const attempt = vi.fn(async () => {
      throw new DatabaseSetupError("The database schema is behind this build: run npm run db:migrate.");
    });
    await expect(connectWithBackoff(attempt, h.options)).rejects.toThrow(/run npm run db:migrate/);
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
