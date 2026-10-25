import { describe, expect, it, vi } from "vitest";
import { ServerRuntime } from "./serverRuntime.js";
import type { RuntimeServer } from "./serverRuntime.js";

function fakeWorker() {
  return { start: vi.fn(), stop: vi.fn(async () => undefined) };
}

function polled(id: string) {
  const builds: ReturnType<typeof fakeWorker>[] = [];
  const build = (displayName: string): RuntimeServer<{ tag: string }> => {
    const worker = fakeWorker();
    builds.push(worker);
    return { id, displayName, services: { tag: `${id}#${builds.length}` }, workers: [worker] };
  };
  return { entry: { ...build(`Name ${id}`), rebuild: build }, builds };
}

describe("ServerRuntime.setLeader races", () => {
  it("false then true at once: the fresh build starts exactly once, the old one is stopped", async () => {
    const { entry, builds } = polled("a");
    const runtime = new ServerRuntime([entry], { leaderGated: true });
    runtime.start();
    await runtime.setLeader(true);
    const down = runtime.setLeader(false);
    const up = runtime.setLeader(true);
    await Promise.all([down, up]);
    expect(builds[0]!.stop).toHaveBeenCalledTimes(1);
    expect(builds[1]!.start).toHaveBeenCalledTimes(1);
    expect(builds[1]!.stop).not.toHaveBeenCalled();
  });

  it("a server added or replaced while a follower stays idle until leadership", async () => {
    const { entry, builds } = polled("a");
    const runtime = new ServerRuntime([], { leaderGated: true });
    runtime.start();
    runtime.add(entry);
    expect(builds[0]!.start).not.toHaveBeenCalled();
    const r = polled("a");
    await runtime.replace(r.entry);
    expect(r.builds[0]!.start).not.toHaveBeenCalled();
    await runtime.setLeader(true);
    expect(r.builds[0]!.start).toHaveBeenCalledTimes(1);
    expect(builds[0]!.start).not.toHaveBeenCalled();
  });

  it("remove during step-down: the removed id does not come back", async () => {
    const { entry } = polled("a");
    const runtime = new ServerRuntime([entry], { leaderGated: true });
    runtime.start();
    await runtime.setLeader(true);
    const removing = runtime.remove("a");
    await runtime.setLeader(false);
    await removing;
    expect(runtime.has("a")).toBe(false);
  });

  it("after stop(), setLeader never starts any worker", async () => {
    const { entry, builds } = polled("a");
    const runtime = new ServerRuntime([entry], { leaderGated: true });
    runtime.start();
    await runtime.setLeader(true);
    await runtime.stop();
    await runtime.setLeader(false);
    await runtime.setLeader(true);
    expect(builds[0]!.start).toHaveBeenCalledTimes(1);
    for (const b of builds.slice(1)) expect(b.start).not.toHaveBeenCalled();
  });

  it("rename then step-down keeps the new name on the rebuilt entry, across terms", async () => {
    const { entry } = polled("a");
    const runtime = new ServerRuntime([entry], { leaderGated: true });
    runtime.start();
    await runtime.setLeader(true);
    runtime.rename("a", "Renamed");
    await runtime.setLeader(false);
    expect(runtime.list()).toEqual([{ id: "a", displayName: "Renamed" }]);
    await runtime.setLeader(true);
    await runtime.setLeader(false);
    expect(runtime.list()).toEqual([{ id: "a", displayName: "Renamed" }]);
  });

  it("a rebuild that throws for one server does not stop the others from stepping down", async () => {
    const a = polled("a");
    const b = polled("b");
    const bad = {
      ...a.entry,
      rebuild: (): RuntimeServer<{ tag: string }> => {
        throw new Error("x");
      },
    };
    const onWorkerStartError = vi.fn();
    const runtime = new ServerRuntime([bad, b.entry], { leaderGated: true, onWorkerStartError });
    runtime.start();
    await runtime.setLeader(true);
    await runtime.setLeader(false);
    expect(a.builds[0]!.stop).toHaveBeenCalledTimes(1);
    expect(b.builds[0]!.stop).toHaveBeenCalledTimes(1);
  });
});
