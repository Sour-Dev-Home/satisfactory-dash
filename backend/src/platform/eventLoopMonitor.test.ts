import { describe, it, expect, vi, afterEach } from "vitest";
import { ConfigError } from "./errors.js";
import { DEFAULT_EVENT_LOOP_STALL_MS, createEventLoopMonitor, loadEventLoopStallMs } from "./eventLoopMonitor.js";
import type { DelayHistogram } from "./eventLoopMonitor.js";

const ms = (n: number) => n * 1_000_000; // the histogram reports nanoseconds

/** A histogram fake whose current window is set by the test, with reset semantics like the real one. */
function fakeHistogram() {
  const state = { max: 0, mean: 0, p99: 0, enabled: false, resets: 0 };
  const histogram: DelayHistogram = {
    enable: () => ((state.enabled = true), true),
    disable: () => ((state.enabled = false), true),
    reset: () => {
      state.max = 0;
      state.mean = 0;
      state.p99 = 0;
      state.resets++;
    },
    get max() {
      return state.max;
    },
    get mean() {
      return state.mean;
    },
    percentile: () => state.p99,
  };
  return { histogram, state };
}

function build(thresholdMs = 500) {
  const { histogram, state } = fakeHistogram();
  const warn = vi.fn();
  const monitor = createEventLoopMonitor({ logger: { warn }, thresholdMs, histogram, windowMs: 1000 });
  return { monitor, state, warn };
}

describe("event loop monitor", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("logs nothing when the worst delay of the window is under the threshold", () => {
    const { monitor, state, warn } = build();
    state.max = ms(120);
    state.mean = ms(21);
    monitor.check();
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not log at exactly the threshold, only above it", () => {
    const { monitor, state, warn } = build(500);
    state.max = ms(500);
    monitor.check();
    expect(warn).not.toHaveBeenCalled();
    state.max = ms(500.2);
    monitor.check();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("logs exactly ONE warn over the threshold, with the fixed code and numbers only", () => {
    const { monitor, state, warn } = build();
    state.max = ms(1234.56);
    state.p99 = ms(800);
    state.mean = ms(45.04);
    monitor.check();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({ code: "event_loop_stall", max_ms: 1234.6, p99_ms: 800, mean_ms: 45 }, "event loop stalled");
    for (const value of Object.values(warn.mock.calls[0]![0] as Record<string, unknown>)) {
      expect(["string", "number"]).toContain(typeof value);
    }
  });

  it("resets the histogram every window, so one stall is reported once and the next quiet window is silent", () => {
    const { monitor, state, warn } = build();
    state.max = ms(900);
    monitor.check();
    monitor.check(); // the histogram was reset: nothing left to report
    expect(warn).toHaveBeenCalledTimes(1);
    expect(state.resets).toBe(2);
  });

  it("resets even a quiet window (so a stall never leaks into the next window)", () => {
    const { monitor, state } = build();
    state.max = ms(50);
    monitor.check();
    expect(state.resets).toBe(1);
    expect(state.max).toBe(0);
  });

  it("checks on the window timer once started, enables the histogram, and stops cleanly", async () => {
    vi.useFakeTimers();
    const { monitor, state, warn } = build();
    monitor.start();
    monitor.start(); // starting twice must not double the timer
    expect(state.enabled).toBe(true);
    state.max = ms(2000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(warn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000); // three quiet windows
    expect(warn).toHaveBeenCalledTimes(1);
    await monitor.stop();
    expect(state.enabled).toBe(false);
    state.max = ms(5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(warn).toHaveBeenCalledTimes(1); // stopped: no more checks
    await expect(monitor.stop()).resolves.toBeUndefined(); // and stopping again is harmless
  });

  it("uses an unref'd timer, so it never keeps the process alive", async () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    try {
      const { monitor } = build();
      monitor.start();
      const timer = spy.mock.results[0]!.value as NodeJS.Timeout;
      expect(timer.hasRef()).toBe(false);
      await monitor.stop();
    } finally {
      spy.mockRestore();
    }
  });

  it("works with the real perf_hooks histogram: a blocked loop is measured, an idle one is not flagged", async () => {
    const warn = vi.fn();
    const monitor = createEventLoopMonitor({ logger: { warn }, thresholdMs: 150, windowMs: 60_000 });
    monitor.start();
    await new Promise((resolve) => setTimeout(resolve, 60));
    monitor.check();
    expect(warn).not.toHaveBeenCalled(); // idle: about the 20 ms resolution
    await new Promise((resolve) => setTimeout(resolve, 30));
    const until = Date.now() + 400;
    while (Date.now() < until) {
      // block the loop on purpose
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
    monitor.check();
    expect(warn).toHaveBeenCalledTimes(1);
    expect((warn.mock.calls[0]![0] as { max_ms: number }).max_ms).toBeGreaterThan(150);
    await monitor.stop();
  });
});

describe("EVENT_LOOP_STALL_MS", () => {
  it("defaults to 500 ms when unset or blank", () => {
    expect(DEFAULT_EVENT_LOOP_STALL_MS).toBe(500);
    expect(loadEventLoopStallMs({})).toBe(500);
    expect(loadEventLoopStallMs({ EVENT_LOOP_STALL_MS: "  " })).toBe(500);
  });

  it("accepts whole milliseconds from 50 to 60000", () => {
    expect(loadEventLoopStallMs({ EVENT_LOOP_STALL_MS: "50" })).toBe(50);
    expect(loadEventLoopStallMs({ EVENT_LOOP_STALL_MS: "2000" })).toBe(2000);
    expect(loadEventLoopStallMs({ EVENT_LOOP_STALL_MS: "60000" })).toBe(60_000);
  });

  it.each(["49", "60001", "0", "-1", "1.5", "fast", "1e3", "0x10"])("rejects %s with a ConfigError naming the variable", (value) => {
    expect(() => loadEventLoopStallMs({ EVENT_LOOP_STALL_MS: value })).toThrow(ConfigError);
    expect(() => loadEventLoopStallMs({ EVENT_LOOP_STALL_MS: value })).toThrow(/EVENT_LOOP_STALL_MS/);
  });
});
