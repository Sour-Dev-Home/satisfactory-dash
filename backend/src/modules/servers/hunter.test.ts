import { describe, expect, it, vi } from "vitest";
import { ServerRuntime } from "./serverRuntime.js";

// ADR-0066 build PR 6: the addressGuard cases went with addressGuard.ts; ServerRuntime stays, and so do its cases.
const entry = (id: string, workers: { start(): void; stop(): Promise<void> }[]) => ({ id, displayName: id, services: id, workers });

describe("ServerRuntime failure paths (test-hunter)", () => {
  it("a worker whose stop() throws synchronously does not stop the others being stopped on remove", async () => {
    const stopped = vi.fn();
    const bad = { start() {}, stop: (): Promise<void> => { throw new Error("sync"); } };
    const good = { start() {}, stop: async () => void stopped() };
    const rt = new ServerRuntime([entry("a", [bad, good])]);
    await expect(rt.remove("a")).resolves.toBe(true);
    expect(stopped).toHaveBeenCalledTimes(1);
  });
  it("stop() with a synchronously throwing worker still stops the others and resolves", async () => {
    const stopped = vi.fn();
    const bad = { start() {}, stop: (): Promise<void> => { throw new Error("sync"); } };
    const good = { start() {}, stop: async () => void stopped() };
    const rt = new ServerRuntime([entry("a", [bad]), entry("b", [good])]);
    rt.start();
    await expect(rt.stop()).resolves.toBeUndefined();
    expect(stopped).toHaveBeenCalledTimes(1);
  });
  it("a server added after stop() is not started", async () => {
    const start = vi.fn();
    const rt = new ServerRuntime<string>();
    rt.start();
    await rt.stop();
    rt.add(entry("late", [{ start, stop: async () => {} }]));
    expect(start).not.toHaveBeenCalled();
  });
});
