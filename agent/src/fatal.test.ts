import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { FATAL_LINE, installFatalHandlers } from "./fatal.js";

// The handlers go on a plain EventEmitter, never on the real process, so nothing here can end the test run.
function setup() {
  const target = new EventEmitter();
  const err = vi.fn();
  const exit = vi.fn();
  installFatalHandlers({ target, err, exit });
  return { target, err, exit };
}

describe("installFatalHandlers (#560)", () => {
  it("an uncaught exception prints one line with no detail and exits 1", () => {
    const h = setup();
    h.target.emit("uncaughtException", new Error("token=SECRETDETAIL"));
    expect(h.err).toHaveBeenCalledWith(FATAL_LINE);
    expect(JSON.stringify(h.err.mock.calls)).not.toContain("SECRETDETAIL");
    expect(h.exit).toHaveBeenCalledWith(1);
  });

  it("an unhandled rejection does the same, once even if a second failure follows", () => {
    const h = setup();
    h.target.emit("unhandledRejection", "SECRETDETAIL");
    h.target.emit("uncaughtException", new Error("again"));
    expect(h.err).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledWith(1);
  });

  it("still exits when stderr cannot be written", () => {
    const target = new EventEmitter();
    const exit = vi.fn();
    installFatalHandlers({
      target,
      err: () => {
        throw new Error("EPIPE");
      },
      exit,
    });
    target.emit("uncaughtException", new Error("x"));
    expect(exit).toHaveBeenCalledWith(1);
  });
});
