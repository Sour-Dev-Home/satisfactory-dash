import { describe, expect, it, vi } from "vitest";
import { ServerRuntime } from "./serverRuntime.js";
import type { RuntimeServer, RuntimeWorker } from "./serverRuntime.js";

function fakeWorker(overrides: { start?: () => void; stop?: () => Promise<void> } = {}) {
  return {
    start: vi.fn(overrides.start ?? (() => undefined)),
    stop: vi.fn(overrides.stop ?? (async () => undefined)),
  };
}

const server = (id: string, workers: RuntimeWorker[] = [fakeWorker()]): RuntimeServer<{ tag: string }> => ({
  id,
  displayName: `Name ${id}`,
  services: { tag: id },
  workers,
});

describe("ServerRuntime as a directory", () => {
  it("lists only id and display name, and resolves services by id", () => {
    const runtime = new ServerRuntime([server("a"), server("b")]);
    expect(runtime.list()).toEqual([
      { id: "a", displayName: "Name a" },
      { id: "b", displayName: "Name b" },
    ]);
    expect(runtime.get("a")).toEqual({ tag: "a" });
    expect(runtime.get("nope")).toBeUndefined();
    expect(runtime.has("b")).toBe(true);
    expect(runtime.size).toBe(2);
  });

  it("refuses a duplicate id, at construction and on add", () => {
    expect(() => new ServerRuntime([server("a"), server("a")])).toThrow("Duplicate");
    const runtime = new ServerRuntime([server("a")]);
    expect(() => runtime.add(server("a"))).toThrow("Duplicate");
  });
});

describe("starting and stopping", () => {
  it("starts every server's workers on start(), once", () => {
    const w1 = fakeWorker();
    const w2 = fakeWorker();
    const runtime = new ServerRuntime([server("a", [w1]), server("b", [w2])]);
    expect(w1.start).not.toHaveBeenCalled();
    runtime.start();
    runtime.start();
    expect(w1.start).toHaveBeenCalledTimes(1);
    expect(w2.start).toHaveBeenCalledTimes(1);
  });

  it("starts a server added while running, but not one added before start()", () => {
    const early = fakeWorker();
    const late = fakeWorker();
    const runtime = new ServerRuntime<{ tag: string }>();
    runtime.add(server("early", [early]));
    expect(early.start).not.toHaveBeenCalled();
    runtime.start();
    runtime.add(server("late", [late]));
    expect(early.start).toHaveBeenCalledTimes(1);
    expect(late.start).toHaveBeenCalledTimes(1);
  });

  it("stop() stops all workers and tolerates one that fails", async () => {
    const ok = fakeWorker();
    const bad = fakeWorker({ stop: vi.fn(async () => Promise.reject(new Error("boom"))) });
    const runtime = new ServerRuntime([server("a", [bad]), server("b", [ok])]);
    runtime.start();
    await expect(runtime.stop()).resolves.toBeUndefined();
    expect(ok.stop).toHaveBeenCalledTimes(1);
    expect(bad.stop).toHaveBeenCalledTimes(1);
  });

  it("a worker that fails to start does not stop the others when a handler is given", () => {
    const good = fakeWorker();
    const bad = fakeWorker({ start: vi.fn(() => { throw new Error("nope"); }) });
    const onWorkerStartError = vi.fn();
    const runtime = new ServerRuntime([server("bad", [bad]), server("good", [good])], { onWorkerStartError });
    runtime.start();
    expect(onWorkerStartError).toHaveBeenCalledWith("bad", expect.any(Error));
    expect(good.start).toHaveBeenCalledTimes(1);
  });

  it("throws a start failure when no handler is given", () => {
    const bad = fakeWorker({ start: vi.fn(() => { throw new Error("nope"); }) });
    expect(() => new ServerRuntime([server("bad", [bad])]).start()).toThrow("nope");
  });
});

describe("remove and replace", () => {
  it("remove stops resolving at once, then stops the workers", async () => {
    const worker = fakeWorker();
    const runtime = new ServerRuntime([server("a", [worker])]);
    runtime.start();
    let resolvedDuringStop: unknown = "unset";
    worker.stop.mockImplementation(async () => {
      resolvedDuringStop = runtime.get("a");
    });
    expect(await runtime.remove("a")).toBe(true);
    expect(resolvedDuringStop).toBeUndefined();
    expect(worker.stop).toHaveBeenCalledTimes(1);
    expect(runtime.list()).toEqual([]);
    expect(await runtime.remove("a")).toBe(false);
  });

  it("a worker that fails to stop never blocks the removal", async () => {
    const bad = fakeWorker({ stop: vi.fn(async () => Promise.reject(new Error("boom"))) });
    const runtime = new ServerRuntime([server("a", [bad])]);
    expect(await runtime.remove("a")).toBe(true);
    expect(runtime.has("a")).toBe(false);
  });

  it("the id can be added again after removal (a fresh entry with fresh workers)", async () => {
    const runtime = new ServerRuntime([server("a")]);
    runtime.start();
    await runtime.remove("a");
    const fresh = fakeWorker();
    runtime.add(server("a", [fresh]));
    expect(fresh.start).toHaveBeenCalledTimes(1);
  });

  it("reports a worker that fails to stop (by server id) on remove, replace and stop, without throwing", async () => {
    const onWorkerStopError = vi.fn();
    const bad = () => fakeWorker({ stop: async () => Promise.reject(new Error("boom")) });
    const runtime = new ServerRuntime([server("a", [bad()]), server("b", [bad()]), server("c", [bad()])], { onWorkerStopError });
    await runtime.remove("a");
    await runtime.replace(server("b"));
    await runtime.stop();
    expect(onWorkerStopError.mock.calls.map((call) => call[0]).sort()).toEqual(["a", "b", "c"]);
  });

  it("replace never leaves the id unresolved, and replacing an absent id just adds it", async () => {
    let seenDuringStop: unknown;
    const oldWorker = fakeWorker();
    const runtime = new ServerRuntime([server("a", [oldWorker])]);
    oldWorker.stop.mockImplementation(async () => {
      seenDuringStop = runtime.get("a");
    });
    await runtime.replace(server("a", [fakeWorker()]));
    expect(seenDuringStop).toEqual({ tag: "a" });
    await runtime.replace(server("fresh"));
    expect(runtime.has("fresh")).toBe(true);
  });

  it("concurrent replaces of one id both succeed (no duplicate-id error); the last one wins", async () => {
    const runtime = new ServerRuntime([server("a")]);
    runtime.start();
    await Promise.all([
      runtime.replace({ ...server("a"), displayName: "first" }),
      runtime.replace({ ...server("a"), displayName: "second" }),
    ]);
    expect(runtime.list()).toEqual([{ id: "a", displayName: "second" }]);
  });

  it("replace stops the old workers, then installs and starts the new entry", async () => {
    const oldWorker = fakeWorker();
    const newWorker = fakeWorker();
    const runtime = new ServerRuntime([server("a", [oldWorker])]);
    runtime.start();
    await runtime.replace({ ...server("a", [newWorker]), displayName: "Renamed" });
    expect(oldWorker.stop).toHaveBeenCalledTimes(1);
    expect(newWorker.start).toHaveBeenCalledTimes(1);
    expect(runtime.list()).toEqual([{ id: "a", displayName: "Renamed" }]);
  });
});
