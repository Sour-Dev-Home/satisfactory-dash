import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #270: the DB tests' teardown terminates connections (DROP DATABASE ... FORCE, stopping the container), and a pg Pool with
 * no `error` listener turns the resulting 57P01 into an unhandled error that fails the run. The setup file
 * (pgIdleErrors.ts, wired in vitest.config.ts) gives every Pool and Client a test creates a listener. No database is needed
 * to prove it: an EventEmitter throws on an unhandled 'error', so emitting one is the whole experiment.
 */

const shutdown = () => Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01" });
const dead = "postgres://user:secret-password@127.0.0.1:1/none";

afterEach(() => vi.restoreAllMocks());

describe("every pool and client a test creates survives the server terminating its connections", () => {
  it("a Pool has an error listener, so 57P01 (admin shutdown) and 57P02 (crash shutdown) are neither thrown nor printed", async () => {
    const printed = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pool = new pg.Pool({ connectionString: dead, max: 1 });
    expect(pool.listenerCount("error")).toBeGreaterThanOrEqual(1);
    expect(() => pool.emit("error", shutdown())).not.toThrow();
    expect(() => pool.emit("error", Object.assign(new Error("the database system is shutting down"), { code: "57P02" }))).not.toThrow();
    expect(printed).not.toHaveBeenCalled();
    await pool.end();
  });

  it("a Client has one too", () => {
    const printed = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = new pg.Client({ connectionString: dead });
    expect(client.listenerCount("error")).toBeGreaterThanOrEqual(1);
    expect(() => client.emit("error", shutdown())).not.toThrow();
    expect(printed).not.toHaveBeenCalled();
  });

  it("any OTHER idle-connection error does not crash the run either, but stays visible: the code is printed, never the message (it can quote a URL)", async () => {
    const printed = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pool = new pg.Pool({ connectionString: dead, max: 1 });
    expect(() => pool.emit("error", Object.assign(new Error(`connect failed for ${dead}`), { code: "ECONNRESET" }))).not.toThrow();
    expect(printed).toHaveBeenCalledTimes(1);
    const line = String(printed.mock.calls[0]![0]);
    expect(line).toContain("ECONNRESET");
    expect(line).not.toContain("secret-password");
    expect(line).not.toContain(dead);
    await pool.end();
  });

  it("the patched classes are still the real thing: instances of pg.Pool / pg.Client, with their usual methods", async () => {
    const pool = new pg.Pool({ connectionString: dead, max: 1 });
    expect(pool).toBeInstanceOf(pg.Pool);
    expect(typeof pool.query).toBe("function");
    expect(typeof pool.connect).toBe("function");
    await pool.end();
    expect(new pg.Client({ connectionString: dead })).toBeInstanceOf(pg.Client);
  });

  it("is applied once however many times the setup runs in a worker: one listener, not one per re-import", async () => {
    vi.resetModules();
    await import("./pgIdleErrors.js");
    await import("./pgIdleErrors.js");
    const pool = new pg.Pool({ connectionString: dead, max: 1 });
    expect(pool.listenerCount("error")).toBe(1);
    await pool.end();
  });

  it("without the listener the very failure of #270 reproduces (the control): a bare EventEmitter throws on an unhandled 'error'", async () => {
    const { EventEmitter } = await import("node:events");
    expect(() => new EventEmitter().emit("error", shutdown())).toThrow("terminating connection");
  });
});
