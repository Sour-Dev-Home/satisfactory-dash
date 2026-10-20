import { describe, expect, it } from "vitest";
import {
  createSupervisor,
  MAX_RESTARTS,
  RESTART_WINDOW_MS,
  SERVER_ARGS,
  type ChildHandle,
  type ServerState,
  type SpawnFn,
} from "./supervisor";

/** A fake child process the test drives by hand: it never starts or exits on its own. */
class FakeChild implements ChildHandle {
  readonly pid: number;
  killed = false;
  private spawnCbs: (() => void)[] = [];
  private exitCbs: ((code: number | null, signal: string | null) => void)[] = [];
  private errorCbs: ((err: Error) => void)[] = [];
  constructor(pid: number) {
    this.pid = pid;
  }
  kill(): void {
    this.killed = true;
  }
  onSpawn(cb: () => void): void {
    this.spawnCbs.push(cb);
  }
  onExit(cb: (code: number | null, signal: string | null) => void): void {
    this.exitCbs.push(cb);
  }
  onError(cb: (err: Error) => void): void {
    this.errorCbs.push(cb);
  }
  spawned(): void {
    for (const cb of this.spawnCbs) cb();
  }
  exit(code: number | null, signal: string | null = null): void {
    for (const cb of this.exitCbs) cb(code, signal);
  }
  error(err: Error): void {
    for (const cb of this.errorCbs) cb(err);
  }
}

function setup(opts: { autoSpawn?: boolean } = {}) {
  const autoSpawn = opts.autoSpawn ?? true;
  let clock = 1_000_000;
  const children: FakeChild[] = [];
  const calls: { exe: string; args: readonly string[] }[] = [];
  const spawn: SpawnFn = (exe, args) => {
    calls.push({ exe, args });
    const child = new FakeChild(100 + children.length);
    children.push(child);
    if (autoSpawn) queueMicrotask(() => child.spawned());
    return child;
  };
  const sup = createSupervisor({ spawn, now: () => clock, serverExe: "X:\\server\\FactoryServer.exe" });
  const states: ServerState[] = [];
  sup.onChange((s) => states.push(s));
  return {
    sup,
    children,
    calls,
    states,
    last: () => children[children.length - 1]!,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("supervisor", () => {
  it("starts stopped with no error", () => {
    const { sup } = setup();
    expect(sup.state()).toBe("stopped");
    expect(sup.lastError()).toBeUndefined();
  });

  it("start spawns the server exe with the fixed -log argument, then runs", async () => {
    const { sup, calls, states } = setup();
    sup.start();
    expect(sup.state()).toBe("starting");
    expect(calls).toEqual([{ exe: "X:\\server\\FactoryServer.exe", args: ["-log"] }]);
    expect(SERVER_ARGS).toEqual(["-log"]);
    await tick();
    expect(sup.state()).toBe("running");
    expect(states).toEqual(["starting", "running"]);
  });

  it("start while starting or running spawns nothing more", async () => {
    const { sup, calls } = setup();
    sup.start();
    sup.start();
    await tick();
    sup.start();
    expect(calls).toHaveLength(1);
  });

  it("stop kills the process, goes through stopping and resolves when it exits", async () => {
    const { sup, last, states } = setup();
    sup.start();
    await tick();
    const stopped = sup.stop();
    expect(sup.state()).toBe("stopping");
    expect(last().killed).toBe(true);
    last().exit(1);
    await stopped;
    expect(sup.state()).toBe("stopped");
    expect(states).toEqual(["starting", "running", "stopping", "stopped"]);
    expect(sup.lastError()).toBeUndefined();
  });

  it("an exit the app asked for never restarts", async () => {
    const { sup, last, calls } = setup();
    sup.start();
    await tick();
    const stopped = sup.stop();
    last().exit(null, "SIGTERM");
    await stopped;
    await tick();
    expect(calls).toHaveLength(1);
  });

  it("stop when already stopped resolves at once", async () => {
    const { sup, states } = setup();
    await sup.stop();
    expect(sup.state()).toBe("stopped");
    expect(states).toEqual([]);
  });

  it("two stops share one kill and both resolve", async () => {
    const { sup, last } = setup();
    sup.start();
    await tick();
    const a = sup.stop();
    const b = sup.stop();
    last().exit(0);
    await Promise.all([a, b]);
    expect(sup.state()).toBe("stopped");
  });

  it("stop while starting kills the half-started process", async () => {
    const { sup, last } = setup({ autoSpawn: false });
    sup.start();
    expect(sup.state()).toBe("starting");
    const stopped = sup.stop();
    expect(last().killed).toBe(true);
    last().exit(null, "SIGTERM");
    await stopped;
    expect(sup.state()).toBe("stopped");
  });

  it("restart stops then starts a new process", async () => {
    const { sup, children } = setup();
    sup.start();
    await tick();
    const restarted = sup.restart();
    children[0]!.exit(0);
    await restarted;
    await tick();
    expect(children).toHaveLength(2);
    expect(sup.state()).toBe("running");
  });

  it("two restarts at once start one new process, not two", async () => {
    const { sup, children } = setup();
    sup.start();
    await tick();
    const a = sup.restart();
    const b = sup.restart();
    children[0]!.exit(0);
    await Promise.all([a, b]);
    await tick();
    expect(children).toHaveLength(2);
    expect(children[0]!.killed).toBe(true);
    expect(sup.state()).toBe("running");
  });

  it("a restart exactly at the window edge no longer counts (boundary)", async () => {
    const { sup, children, advance } = setup();
    sup.start();
    await tick();
    for (let i = 0; i < MAX_RESTARTS; i++) children[children.length - 1]!.exit(1);
    advance(RESTART_WINDOW_MS);
    children[children.length - 1]!.exit(1);
    expect(sup.state()).not.toBe("crashed");
  });

  it("an exit it didn't ask for restarts the server and records why", async () => {
    const { sup, children, states } = setup();
    sup.start();
    await tick();
    children[0]!.exit(1);
    expect(children).toHaveLength(2);
    expect(sup.state()).toBe("starting");
    await tick();
    expect(sup.state()).toBe("running");
    expect(sup.lastError()).toMatch(/exit code 1/);
    expect(states).toEqual(["starting", "running", "starting", "running"]);
  });

  it("a clean exit it didn't ask for also restarts", async () => {
    const { sup, children } = setup();
    sup.start();
    await tick();
    children[0]!.exit(0);
    expect(children).toHaveLength(2);
  });

  it(`restarts at most ${MAX_RESTARTS} times in 10 minutes, then is crashed with the reason`, async () => {
    const { sup, children, last, advance } = setup();
    sup.start();
    await tick();
    for (let i = 0; i < MAX_RESTARTS; i++) {
      advance(1000);
      last().exit(1);
      await tick();
    }
    expect(children).toHaveLength(1 + MAX_RESTARTS);
    advance(1000);
    last().exit(3);
    await tick();
    expect(children).toHaveLength(1 + MAX_RESTARTS);
    expect(sup.state()).toBe("crashed");
    expect(sup.lastError()).toMatch(/not restarting/i);
    expect(sup.lastError()).toMatch(/exit code 3/);
  });

  it("restarts older than the 10-minute window no longer count", async () => {
    const { sup, children, last, advance } = setup();
    sup.start();
    await tick();
    for (let i = 0; i < MAX_RESTARTS; i++) {
      last().exit(1);
      await tick();
    }
    advance(RESTART_WINDOW_MS + 1);
    last().exit(1);
    await tick();
    expect(children).toHaveLength(2 + MAX_RESTARTS);
    expect(sup.state()).toBe("running");
  });

  it("start after crashed clears the error and the restart budget", async () => {
    const { sup, children, last } = setup();
    sup.start();
    await tick();
    for (let i = 0; i <= MAX_RESTARTS; i++) {
      last().exit(1);
      await tick();
    }
    expect(sup.state()).toBe("crashed");
    sup.start();
    await tick();
    expect(sup.state()).toBe("running");
    expect(sup.lastError()).toBeUndefined();
    last().exit(1);
    await tick();
    expect(sup.state()).toBe("running");
    expect(children).toHaveLength(MAX_RESTARTS + 3);
  });

  it("restart from crashed starts again", async () => {
    const { sup, last } = setup();
    sup.start();
    await tick();
    for (let i = 0; i <= MAX_RESTARTS; i++) {
      last().exit(1);
      await tick();
    }
    await sup.restart();
    await tick();
    expect(sup.state()).toBe("running");
  });

  it("a spawn error counts as an exit it didn't ask for", async () => {
    const { sup, children } = setup({ autoSpawn: false });
    sup.start();
    children[0]!.error(new Error("spawn ENOENT"));
    expect(children).toHaveLength(2);
    expect(sup.lastError()).toMatch(/ENOENT/);
  });

  it("error then exit from the same process is handled once", async () => {
    const { sup, children } = setup({ autoSpawn: false });
    sup.start();
    children[0]!.error(new Error("boom"));
    children[0]!.exit(1);
    expect(children).toHaveLength(2);
  });

  it("a spawn that throws is handled like a spawn error", () => {
    let n = 0;
    const sup = createSupervisor({
      spawn: () => {
        n++;
        throw new Error("EACCES");
      },
      now: () => 0,
      serverExe: "x",
    });
    sup.start();
    expect(n).toBe(1 + MAX_RESTARTS);
    expect(sup.state()).toBe("crashed");
    expect(sup.lastError()).toMatch(/EACCES/);
  });

  it("events from an old process are ignored", async () => {
    const { sup, children } = setup();
    sup.start();
    await tick();
    children[0]!.exit(1);
    await tick();
    children[0]!.exit(1);
    expect(children).toHaveLength(2);
    expect(sup.state()).toBe("running");
  });

  it("a signal exit names the signal", async () => {
    const { sup, last } = setup();
    sup.start();
    await tick();
    last().exit(null, "SIGKILL");
    expect(sup.lastError()).toMatch(/SIGKILL/);
  });

  it("onChange returns an unsubscribe", async () => {
    const { sup } = setup();
    const seen: ServerState[] = [];
    const off = sup.onChange((s) => seen.push(s));
    sup.start();
    off();
    await tick();
    expect(seen).toEqual(["starting"]);
  });

  it("a throwing listener does not break the others or the supervisor", async () => {
    const { sup, states } = setup();
    sup.onChange(() => {
      throw new Error("listener");
    });
    sup.start();
    await tick();
    expect(sup.state()).toBe("running");
    expect(states).toEqual(["starting", "running"]);
  });
});
