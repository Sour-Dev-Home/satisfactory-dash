import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_START_DELAY_MS, IDLE_TIMEOUT_MS, savesData, whenIdle } from "./idle";

const withConnection = (connection: object | undefined) => ({ connection }) as unknown as Navigator;

describe("savesData", () => {
  it("is false where the browser doesn't say (no navigator.connection)", () => {
    expect(savesData(withConnection(undefined))).toBe(false);
  });

  it("is true with Save-Data on, or on 2G and slow 2G", () => {
    expect(savesData(withConnection({ saveData: true, effectiveType: "4g" }))).toBe(true);
    expect(savesData(withConnection({ effectiveType: "2g" }))).toBe(true);
    expect(savesData(withConnection({ effectiveType: "slow-2g" }))).toBe(true);
  });

  it("is false on 3G and 4G with Save-Data off", () => {
    expect(savesData(withConnection({ saveData: false, effectiveType: "3g" }))).toBe(false);
    expect(savesData(withConnection({ effectiveType: "4g" }))).toBe(false);
  });
});

describe("whenIdle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("asks for idle time after the start delay, with a timeout, and runs the task then", () => {
    let idleTask: (() => void) | undefined;
    const request = vi.fn((cb: () => void) => ((idleTask = cb), 7));
    vi.stubGlobal("requestIdleCallback", request);
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    const task = vi.fn();
    whenIdle(task);
    vi.advanceTimersByTime(IDLE_START_DELAY_MS - 1);
    expect(request).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(request).toHaveBeenCalledWith(expect.any(Function), { timeout: IDLE_TIMEOUT_MS });
    expect(task).not.toHaveBeenCalled();
    idleTask?.();
    expect(task).toHaveBeenCalledOnce();
  });

  it("runs the task at the end of the delay where requestIdleCallback is missing (Safari)", () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    const task = vi.fn();
    whenIdle(task);
    vi.advanceTimersByTime(IDLE_START_DELAY_MS);
    expect(task).toHaveBeenCalledOnce();
  });

  it("cancel stops it before the delay and after the idle request", () => {
    const cancelIdle = vi.fn();
    vi.stubGlobal("requestIdleCallback", vi.fn(() => 7));
    vi.stubGlobal("cancelIdleCallback", cancelIdle);
    const early = vi.fn();
    whenIdle(early)();
    vi.advanceTimersByTime(IDLE_START_DELAY_MS);
    expect(early).not.toHaveBeenCalled();
    const cancel = whenIdle(vi.fn());
    vi.advanceTimersByTime(IDLE_START_DELAY_MS);
    cancel();
    expect(cancelIdle).toHaveBeenCalledWith(7);
  });

  it("never runs under Save-Data", () => {
    vi.stubGlobal("navigator", withConnection({ saveData: true }));
    vi.stubGlobal("requestIdleCallback", undefined);
    const task = vi.fn();
    whenIdle(task);
    vi.advanceTimersByTime(IDLE_START_DELAY_MS * 10);
    expect(task).not.toHaveBeenCalled();
  });
});
