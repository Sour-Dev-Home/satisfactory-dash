import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FATAL_FLUSH_TIMEOUT_MS, UNCAUGHT_EXCEPTION_MSG, UNHANDLED_REJECTION_MSG, installFatalHandlers } from "./fatalHandlers.js";
import { createLogger } from "./logger.js";

// The handlers go on a plain EventEmitter, never on the real process, so nothing here can end the test run.
function setup(flush: (cb?: (err?: Error) => void) => void = (cb) => cb?.()) {
  const target = new EventEmitter();
  const logger = { fatal: vi.fn(), flush: vi.fn(flush) };
  const exit = vi.fn();
  installFatalHandlers({ logger, exit, target });
  return { target, logger, exit };
}

describe("installFatalHandlers", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("an uncaught exception: a fatal line with the error, a flush, then exit 1", () => {
    const h = setup();
    const err = new Error("kaboom");
    h.target.emit("uncaughtException", err);
    expect(h.logger.fatal).toHaveBeenCalledWith(
      { err: expect.stringContaining("kaboom"), errorName: "Error", stack: err.stack, code: "UNCAUGHT_EXCEPTION" },
      UNCAUGHT_EXCEPTION_MSG,
    );
    expect(h.logger.flush).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledWith(1);
    vi.advanceTimersByTime(FATAL_FLUSH_TIMEOUT_MS);
    expect(h.exit).toHaveBeenCalledTimes(1); // the fallback timer does not exit twice
  });

  it("an unhandled rejection, even of a non-Error: the same, with its own message", () => {
    const h = setup();
    h.target.emit("unhandledRejection", "just a string");
    expect(h.logger.fatal).toHaveBeenCalledWith(
      { err: expect.stringContaining("just a string"), errorName: "string", code: "UNHANDLED_REJECTION" },
      UNHANDLED_REJECTION_MSG,
    );
    expect(h.exit).toHaveBeenCalledWith(1);
  });

  it("exits only after the flush calls back", () => {
    let done: ((err?: Error) => void) | undefined;
    const h = setup((cb) => {
      done = cb;
    });
    h.target.emit("uncaughtException", new Error("x"));
    expect(h.exit).not.toHaveBeenCalled();
    done?.();
    expect(h.exit).toHaveBeenCalledWith(1);
  });

  it("a flush that never calls back still exits, after the timeout", () => {
    const h = setup(() => {});
    h.target.emit("uncaughtException", new Error("x"));
    vi.advanceTimersByTime(FATAL_FLUSH_TIMEOUT_MS - 1);
    expect(h.exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(h.exit).toHaveBeenCalledWith(1);
  });

  it("a logger that throws still exits", () => {
    const target = new EventEmitter();
    const exit = vi.fn();
    installFatalHandlers({
      logger: {
        fatal: () => {
          throw new Error("disk full");
        },
        flush: () => {
          throw new Error("disk full");
        },
      },
      exit,
      target,
    });
    target.emit("unhandledRejection", new Error("x"));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("a second failure while exiting is not logged again", () => {
    const h = setup(() => {});
    h.target.emit("uncaughtException", new Error("first"));
    h.target.emit("unhandledRejection", new Error("second"));
    expect(h.logger.fatal).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(FATAL_FLUSH_TIMEOUT_MS);
    expect(h.exit).toHaveBeenCalledTimes(1);
  });

  it("with the real pino logger: one JSON line at level 60 with the stack, which the CloudWatch filter matches", () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const target = new EventEmitter();
    const exit = vi.fn();
    installFatalHandlers({ logger: createLogger({ level: "info" }, sink), exit, target });
    target.emit("uncaughtException", new Error("kaboom"));
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0]) as { level: number; msg: string; code: string; err: string; errorName: string; stack: string };
    expect(line.level).toBe(60);
    expect(line.msg).toBe(UNCAUGHT_EXCEPTION_MSG);
    expect(line.code).toBe("UNCAUGHT_EXCEPTION");
    expect(line.err).toContain("kaboom");
    expect(line.errorName).toBe("Error");
    expect(line.stack).toContain("kaboom");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("logs an allowlist, never the error's own properties: no headers, no pg detail quoting row values", () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const target = new EventEmitter();
    installFatalHandlers({ logger: createLogger({ level: "info" }, sink), exit: vi.fn(), target });
    const err = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      detail: "Key (email)=(someone@example.com) already exists.",
      headers: { authorization: "Bearer SECRETTOKEN" },
      cause: Object.assign(new Error("inner"), { headers: { authorization: "Bearer SECRETTOKEN" } }),
    });
    target.emit("uncaughtException", err);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("someone@example.com");
    expect(lines[0]).not.toContain("SECRETTOKEN");
    expect(lines[0]).not.toContain("authorization");
    expect(lines[0]).toContain("duplicate key value");
  });
});
