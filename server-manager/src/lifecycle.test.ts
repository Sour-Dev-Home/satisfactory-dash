import { describe, expect, it } from "vitest";
import { closeAction, HIDDEN_ARG, startsHidden, stopServerAndQuit } from "./lifecycle";
import type { StopOutcome } from "./supervisor";

describe("closeAction", () => {
  it("hides to the tray instead of closing, with the note only the first time", () => {
    expect(closeAction({ quitting: false, noteShown: false })).toEqual({ hide: true, note: true });
    expect(closeAction({ quitting: false, noteShown: true })).toEqual({ hide: true, note: false });
  });

  it("lets the window close while the app quits", () => {
    expect(closeAction({ quitting: true, noteShown: false })).toEqual({ hide: false, note: false });
  });
});

describe("startsHidden", () => {
  it("is true only when launched with the login item's argument", () => {
    expect(HIDDEN_ARG).toBe("--hidden");
    expect(startsHidden(["electron", ".", "--hidden"])).toBe(true);
    expect(startsHidden(["electron", "."])).toBe(false);
    expect(startsHidden(["electron", ".", "--hidden=no"])).toBe(false);
  });
});

describe("stopServerAndQuit", () => {
  function fake(outcome: StopOutcome) {
    const calls: string[] = [];
    return {
      calls,
      deps: {
        stop: async () => {
          calls.push("stop");
          return outcome;
        },
        quit: () => calls.push("quit"),
      },
    };
  }

  it("does the clean stop first and quits once the server is gone", async () => {
    const f = fake("stopped");
    expect(await stopServerAndQuit(f.deps)).toBe("stopped");
    expect(f.calls).toEqual(["stop", "quit"]);
  });

  it("stays open when the clean stop couldn't save, so the window can offer Stop anyway", async () => {
    for (const outcome of ["unavailable", "failed"] as const) {
      const f = fake(outcome);
      expect(await stopServerAndQuit(f.deps)).toBe(outcome);
      expect(f.calls).toEqual(["stop"]);
    }
  });
});
