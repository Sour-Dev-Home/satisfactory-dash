import { describe, expect, it } from "vitest";
import { bootSequence } from "./bootSequence.js";
import type { BootDeps } from "./bootSequence.js";

/** Issue #239: the servers' pollers must not run before the stored servers are loaded. The ORDER is what these tests pin. */

function harness(over: Partial<BootDeps> & { withDatabase?: boolean; loadFails?: boolean; dbFails?: boolean } = {}) {
  const calls: string[] = [];
  let releaseDatabase!: () => void;
  let releaseLoad!: () => void;
  const databaseUp = new Promise<void>((resolve) => (releaseDatabase = resolve));
  const loaded = new Promise<void>((resolve) => (releaseLoad = resolve));
  const failures: unknown[] = [];
  let shuttingDown = false;
  const deps: BootDeps = {
    processWorkers: [{ start: () => calls.push("process-worker") }],
    runtime: { start: () => calls.push("runtime (pollers)") },
    database:
      over.withDatabase === false
        ? undefined
        : {
            start: async () => {
              calls.push("database.start");
              await databaseUp;
              if (over.dbFails) throw new Error("database down");
            },
          },
    loadServers: async () => {
      calls.push("loadServers begins");
      await loaded;
      if (over.loadFails) throw new Error("cannot load");
      calls.push("loadServers done");
    },
    databaseWorkers: [{ start: () => calls.push("database-worker") }],
    isShuttingDown: () => shuttingDown,
    onStartupFailure: (err) => failures.push(err),
    ...over,
  };
  return { deps, calls, failures, releaseDatabase, releaseLoad, shutDown: () => (shuttingDown = true) };
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("bootSequence", () => {
  it("WITH a database: the pollers start only AFTER the servers are loaded, never before (the #239 gap)", async () => {
    const h = harness();
    bootSequence(h.deps);
    await tick();
    expect(h.calls).toEqual(["process-worker", "database.start"]); // nothing of the servers' yet
    h.releaseDatabase();
    await tick();
    expect(h.calls).toEqual(["process-worker", "database.start", "loadServers begins"]); // still no pollers while loading
    h.releaseLoad();
    await tick();
    expect(h.calls).toEqual(["process-worker", "database.start", "loadServers begins", "loadServers done", "runtime (pollers)", "database-worker"]);
    expect(h.failures).toEqual([]);
  });

  it("WITHOUT a database: the environment's servers are the servers, so the pollers start at once and nothing waits", async () => {
    const h = harness({ withDatabase: false });
    bootSequence(h.deps);
    expect(h.calls).toEqual(["process-worker", "runtime (pollers)"]);
  });

  it("process-wide workers start at once in both modes", () => {
    const withDb = harness();
    bootSequence(withDb.deps);
    expect(withDb.calls[0]).toBe("process-worker");
  });

  it("a failure loading the servers starts NO pollers and NO database workers, and is reported once", async () => {
    const h = harness({ loadFails: true });
    bootSequence(h.deps);
    h.releaseDatabase();
    h.releaseLoad();
    await tick();
    await tick();
    expect(h.calls).not.toContain("runtime (pollers)");
    expect(h.calls).not.toContain("database-worker");
    expect(h.failures).toHaveLength(1);
    expect((h.failures[0] as Error).message).toBe("cannot load");
  });

  it("a database that fails to start starts nothing and never loads servers", async () => {
    const h = harness({ dbFails: true });
    bootSequence(h.deps);
    h.releaseDatabase();
    await tick();
    await tick();
    expect(h.calls).toEqual(["process-worker", "database.start"]);
    expect(h.failures).toHaveLength(1);
  });

  it("a shutdown that began while starting up starts nothing more and is not a startup failure", async () => {
    const h = harness();
    bootSequence(h.deps);
    h.releaseDatabase();
    await tick();
    h.shutDown();
    h.releaseLoad();
    await tick();
    await tick();
    expect(h.calls).not.toContain("runtime (pollers)");
    expect(h.calls).not.toContain("database-worker");
    expect(h.failures).toEqual([]);

    const failing = harness({ loadFails: true });
    bootSequence(failing.deps);
    failing.releaseDatabase();
    await tick();
    failing.shutDown();
    failing.releaseLoad();
    await tick();
    await tick();
    expect(failing.failures).toEqual([]); // a deliberate stop is exit 0, never a startup failure
  });
});
