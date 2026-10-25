import { describe, expect, it, vi } from "vitest";
import { LeaderWorkerGroup } from "./leaderWorkers.js";

function oneShot() {
  let stopped = false;
  const worker = {
    runs: 0,
    start: vi.fn(() => {
      if (!stopped) worker.runs++;
    }),
    stop: vi.fn(async () => {
      stopped = true;
    }),
  };
  return worker;
}

describe("LeaderWorkerGroup", () => {
  it("builds fresh workers for every term, so one-shot workers run again after a step-down", async () => {
    const built: ReturnType<typeof oneShot>[] = [];
    const group = new LeaderWorkerGroup([() => (built.push(oneShot()), built.at(-1)!)], { error: vi.fn() });
    group.start();
    group.start(); // idempotent while running
    expect(built).toHaveLength(1);
    expect(group.running).toBe(true);
    await group.stop();
    expect(built[0]!.stop).toHaveBeenCalledTimes(1);
    expect(group.running).toBe(false);
    group.start();
    expect(built).toHaveLength(2);
    expect(built[1]!.runs).toBe(1);
    await group.stop();
    await group.stop(); // idempotent
    expect(built[1]!.stop).toHaveBeenCalledTimes(1);
  });

  it("a failing factory or start is logged and never stops the others; a failing stop never blocks", async () => {
    const error = vi.fn();
    const good = oneShot();
    const badStart = { start: () => { throw new RangeError("x"); }, stop: vi.fn(async () => { throw new Error("y"); }) };
    const group = new LeaderWorkerGroup(
      [
        () => {
          throw new TypeError("factory");
        },
        () => badStart,
        () => good,
      ],
      { error },
    );
    group.start();
    expect(good.runs).toBe(1);
    expect(error).toHaveBeenCalledWith({ worker: 0, error: "TypeError" }, expect.any(String));
    expect(error).toHaveBeenCalledWith({ worker: 1, error: "RangeError" }, expect.any(String));
    await expect(group.stop()).resolves.toBeUndefined();
    expect(badStart.stop).toHaveBeenCalled();
    expect(good.stop).toHaveBeenCalled();
  });

  it("sees factories pushed after construction (server.ts adds the pending-server sweeper later)", () => {
    const factories: (() => ReturnType<typeof oneShot>)[] = [];
    const group = new LeaderWorkerGroup(factories, { error: vi.fn() });
    const late = oneShot();
    factories.push(() => late);
    group.start();
    expect(late.runs).toBe(1);
  });
});
