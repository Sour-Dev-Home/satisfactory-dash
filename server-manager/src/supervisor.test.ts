import { describe, expect, it } from "vitest";
import type { GameApi } from "./gameApi";
import {
  createSupervisor,
  MAX_RESTARTS,
  RESTART_WINDOW_MS,
  SERVER_ARGS,
  SHUTDOWN_TIMEOUT_MS,
  UNCLEAN_STOP,
  type ChildHandle,
  type GameApiAccess,
  type ServerState,
  type SpawnFn,
} from "./supervisor";

/** A fake game API: records each call, and each call can be made to fail or to wait for the test. */
class FakeGame implements GameApi {
  calls: string[] = [];
  fail: Partial<Record<"sessionName" | "saveGame" | "shutdown", Error>> = {};
  /** Set by a test to make the next call wait until it resolves `release`. */
  hold: "sessionName" | "saveGame" | "shutdown" | undefined;
  release: (() => void) | undefined;
  private async step(name: "sessionName" | "saveGame" | "shutdown", detail = ""): Promise<void> {
    this.calls.push(detail === "" ? name : `${name}(${detail})`);
    if (this.hold === name) await new Promise<void>((resolve) => (this.release = resolve));
    const err = this.fail[name];
    if (err) throw err;
  }
  async sessionName(): Promise<string> {
    await this.step("sessionName");
    return "my-world";
  }
  async saveGame(name: string): Promise<void> {
    await this.step("saveGame", name);
  }
  async shutdown(): Promise<void> {
    await this.step("shutdown");
  }
}

/** A manual timer: the test fires it, so the 60 s wait takes no time. */
class FakeTimer {
  pending: { cb: () => void; ms: number; cancelled: boolean }[] = [];
  fn = (cb: () => void, ms: number) => {
    const entry = { cb, ms, cancelled: false };
    this.pending.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };
  fireAll(): void {
    for (const t of this.pending.splice(0)) if (!t.cancelled) t.cb();
  }
  live(): { ms: number }[] {
    return this.pending.filter((t) => !t.cancelled);
  }
}

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

function setup(opts: { autoSpawn?: boolean; access?: () => Promise<GameApiAccess> } = {}) {
  const autoSpawn = opts.autoSpawn ?? true;
  const game = new FakeGame();
  const timer = new FakeTimer();
  const access = opts.access ?? (async (): Promise<GameApiAccess> => ({ ok: true, api: game }));
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
  const sup = createSupervisor({
    spawn,
    now: () => clock,
    serverExe: "X:\\server\\FactoryServer.exe",
    gameApi: access,
    timer: timer.fn,
  });
  const states: ServerState[] = [];
  sup.onChange((s) => states.push(s));
  return {
    sup,
    game,
    timer,
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

  it("stop anyway kills the process, goes through stopping and resolves when it exits", async () => {
    const { sup, last, states, game } = setup();
    sup.start();
    await tick();
    const stopped = sup.stop({ anyway: true });
    expect(sup.state()).toBe("stopping");
    expect(last().killed).toBe(true);
    last().exit(1);
    await stopped;
    expect(sup.state()).toBe("stopped");
    expect(states).toEqual(["starting", "running", "stopping", "stopped"]);
    expect(sup.lastError()).toContain(UNCLEAN_STOP);
    expect(game.calls).toEqual([]);
  });

  it("an exit the app asked for never restarts", async () => {
    const { sup, last, calls } = setup();
    sup.start();
    await tick();
    const stopped = sup.stop({ anyway: true });
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

  it("two stops anyway share one kill and both resolve", async () => {
    const { sup, last } = setup();
    sup.start();
    await tick();
    const a = sup.stop({ anyway: true });
    const b = sup.stop({ anyway: true });
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

  it("restart anyway stops then starts a new process", async () => {
    const { sup, children } = setup();
    sup.start();
    await tick();
    const restarted = sup.restart({ anyway: true });
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
    const a = sup.restart({ anyway: true });
    const b = sup.restart({ anyway: true });
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
      gameApi: async () => ({ ok: false, reason: "unused" }),
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

/** Lets every queued promise step of the clean stop run. */
const settle = async () => {
  for (let i = 0; i < 10; i++) await tick();
};

async function running(opts: Parameters<typeof setup>[0] = {}) {
  const t = setup(opts);
  t.sup.start();
  await tick();
  expect(t.sup.state()).toBe("running");
  return t;
}

describe("the clean stop", () => {
  it("saves the current session, shuts down, and resolves stopped when the process exits", async () => {
    const { sup, game, last, states, timer } = await running();
    const stopped = sup.stop();
    await settle();
    expect(game.calls).toEqual(["sessionName", "saveGame(my-world)", "shutdown"]);
    expect(sup.state()).toBe("stopping");
    expect(last().killed).toBe(false);
    expect(timer.live()).toEqual([expect.objectContaining({ ms: SHUTDOWN_TIMEOUT_MS })]);
    last().exit(0);
    await expect(stopped).resolves.toBe("stopped");
    expect(sup.state()).toBe("stopped");
    expect(states).toEqual(["starting", "running", "stopping", "stopped"]);
    expect(sup.lastError()).toBeUndefined();
    expect(timer.live()).toEqual([]);
    expect(SHUTDOWN_TIMEOUT_MS).toBe(60_000);
  });

  it("ends the process when it hasn't exited 60 s after Shutdown, and says so", async () => {
    const { sup, last, timer, calls } = await running();
    const stopped = sup.stop();
    await settle();
    expect(last().killed).toBe(false);
    timer.fireAll();
    expect(last().killed).toBe(true);
    last().exit(null, "SIGTERM");
    await expect(stopped).resolves.toBe("stopped");
    expect(sup.state()).toBe("stopped");
    expect(sup.lastError()).toContain("Stopped without a clean shutdown");
    expect(sup.lastError()).toContain("60 s");
    await tick();
    expect(calls).toHaveLength(1);
  });

  it("with no token stored, stops nothing and says the agent must be set up", async () => {
    const { sup, last, states } = await running({
      access: async () => ({ ok: false, reason: "The clean stop needs the agent set up." }),
    });
    await expect(sup.stop()).resolves.toBe("unavailable");
    expect(last().killed).toBe(false);
    expect(sup.state()).toBe("running");
    expect(states).toEqual(["starting", "running"]);
    expect(sup.lastError()).toContain("needs the agent set up");
    expect(sup.lastError()).toContain("Stop anyway");
    // Stop anyway then ends it.
    const anyway = sup.stop({ anyway: true });
    expect(last().killed).toBe(true);
    last().exit(1);
    await expect(anyway).resolves.toBe("stopped");
    expect(sup.lastError()).toContain(UNCLEAN_STOP);
  });

  it("an API error while saving leaves the server running and offers Stop anyway", async () => {
    const { sup, game, last, states } = await running();
    game.fail.saveGame = new Error("SaveGame failed: insufficient_scope");
    await expect(sup.stop()).resolves.toBe("failed");
    expect(game.calls).toEqual(["sessionName", "saveGame(my-world)"]);
    expect(last().killed).toBe(false);
    expect(sup.state()).toBe("running");
    expect(states).toEqual(["starting", "running", "stopping", "running"]);
    expect(sup.lastError()).toContain("insufficient_scope");
    expect(sup.lastError()).toContain("Stop anyway");
  });

  it("edge: an error reading the session name is a failed stop too, with nothing saved", async () => {
    const { sup, game, last } = await running();
    game.fail.sessionName = new Error("QueryServerState failed: connect ECONNREFUSED");
    await expect(sup.stop()).resolves.toBe("failed");
    expect(game.calls).toEqual(["sessionName"]);
    expect(last().killed).toBe(false);
    expect(sup.state()).toBe("running");
  });

  it("edge: a Shutdown error after the save still waits, then ends the process and names the error", async () => {
    const { sup, game, last, timer } = await running();
    game.fail.shutdown = new Error("Shutdown failed: socket hang up");
    const stopped = sup.stop();
    await settle();
    expect(sup.state()).toBe("stopping");
    expect(last().killed).toBe(false);
    timer.fireAll();
    expect(last().killed).toBe(true);
    last().exit(null, "SIGTERM");
    await expect(stopped).resolves.toBe("stopped");
    expect(sup.lastError()).toContain("socket hang up");
  });

  it("edge: a Shutdown error with the process exiting anyway is a clean stop", async () => {
    const { sup, game, last, timer } = await running();
    game.fail.shutdown = new Error("Shutdown failed: connection dropped mid-response");
    const stopped = sup.stop();
    await settle();
    last().exit(0);
    await expect(stopped).resolves.toBe("stopped");
    expect(sup.lastError()).toBeUndefined();
    expect(timer.live()).toEqual([]);
  });

  it("edge: a throwing token read is reported, not thrown", async () => {
    const { sup, last } = await running({
      access: async () => {
        throw new Error("DPAPI unavailable");
      },
    });
    await expect(sup.stop()).resolves.toBe("unavailable");
    expect(last().killed).toBe(false);
    expect(sup.lastError()).toContain("DPAPI unavailable");
  });

  it("edge: Stop anyway while saving ends the process at once and the save's later result changes nothing", async () => {
    const { sup, game, last, states } = await running();
    game.hold = "saveGame";
    game.fail.saveGame = new Error("SaveGame failed: connection dropped");
    const stopped = sup.stop();
    await settle();
    expect(game.calls).toEqual(["sessionName", "saveGame(my-world)"]);
    const anyway = sup.stop({ anyway: true });
    expect(last().killed).toBe(true);
    last().exit(null, "SIGTERM");
    game.release?.();
    await settle();
    await expect(stopped).resolves.toBe("stopped");
    await expect(anyway).resolves.toBe("stopped");
    expect(sup.state()).toBe("stopped");
    expect(states).toEqual(["starting", "running", "stopping", "stopped"]);
    expect(game.calls).not.toContain("shutdown");
    expect(sup.lastError()).toContain(UNCLEAN_STOP);
  });

  it("edge: Stop anyway while the token is still being read skips the API", async () => {
    let grant: ((a: GameApiAccess) => void) | undefined;
    const game = new FakeGame();
    const { sup, last } = await running({ access: () => new Promise((resolve) => (grant = resolve)) });
    const stopped = sup.stop();
    const anyway = sup.stop({ anyway: true });
    expect(last().killed).toBe(false);
    grant?.({ ok: true, api: game });
    await settle();
    expect(last().killed).toBe(true);
    expect(game.calls).toEqual([]);
    last().exit(null, "SIGTERM");
    await expect(stopped).resolves.toBe("stopped");
    await expect(anyway).resolves.toBe("stopped");
  });

  it("edge: a crash while the token is read: the stop goes on with the restarted server", async () => {
    let grant: ((a: GameApiAccess) => void) | undefined;
    const game = new FakeGame();
    const { sup, children } = await running({ access: () => new Promise((resolve) => (grant = resolve)) });
    const stopped = sup.stop();
    children[0]!.exit(1); // the supervisor restarts it as usual
    await tick();
    grant?.({ ok: true, api: game });
    await settle();
    expect(game.calls).toEqual(["sessionName", "saveGame(my-world)", "shutdown"]);
    children[1]!.exit(0);
    await expect(stopped).resolves.toBe("stopped");
    expect(children).toHaveLength(2);
    expect(sup.state()).toBe("stopped");
  });

  it("edge: a crash while the token is read that leaves it still starting is not stopped by the API", async () => {
    let grant: ((a: GameApiAccess) => void) | undefined;
    const game = new FakeGame();
    const t = setup({ autoSpawn: false, access: () => new Promise((resolve) => (grant = resolve)) });
    t.sup.start();
    t.children[0]!.spawned();
    const stopped = t.sup.stop();
    t.children[0]!.exit(1); // restarted, and the new process hasn't spawned yet
    grant?.({ ok: true, api: game });
    await settle();
    expect(game.calls).toEqual([]);
    await expect(stopped).resolves.toBe("failed");
    expect(t.sup.state()).toBe("starting");
  });

  it("edge: the process exiting during the save settles the stop as stopped, with no Shutdown", async () => {
    const { sup, game, last } = await running();
    game.hold = "saveGame";
    const stopped = sup.stop();
    await settle();
    last().exit(0);
    game.release?.();
    await settle();
    await expect(stopped).resolves.toBe("stopped");
    expect(game.calls).not.toContain("shutdown");
    expect(sup.state()).toBe("stopped");
  });

  it("two clean stops at once share one save and one shutdown", async () => {
    const { sup, game, last } = await running();
    const a = sup.stop();
    const b = sup.stop();
    await settle();
    last().exit(0);
    await expect(Promise.all([a, b])).resolves.toEqual(["stopped", "stopped"]);
    expect(game.calls).toEqual(["sessionName", "saveGame(my-world)", "shutdown"]);
  });

  it("a clean restart saves, shuts down, and starts a new process", async () => {
    const { sup, game, children } = await running();
    const restarted = sup.restart();
    await settle();
    children[0]!.exit(0);
    await expect(restarted).resolves.toBe("stopped");
    await tick();
    expect(game.calls).toEqual(["sessionName", "saveGame(my-world)", "shutdown"]);
    expect(children).toHaveLength(2);
    expect(sup.state()).toBe("running");
  });

  it("edge: a restart whose stop fails starts nothing", async () => {
    const { sup, game, children } = await running();
    game.fail.saveGame = new Error("SaveGame failed");
    await expect(sup.restart()).resolves.toBe("failed");
    expect(children).toHaveLength(1);
    expect(sup.state()).toBe("running");
  });

  it("edge: Stop anyway during the 60 s wait ends the process at once and cancels the timer", async () => {
    const { sup, last, timer } = await running();
    const stopped = sup.stop();
    await settle();
    expect(timer.live()).toHaveLength(1);
    const again = sup.stop({ anyway: true });
    expect(last().killed).toBe(true);
    expect(timer.live()).toEqual([]);
    last().exit(null, "SIGTERM");
    await expect(Promise.all([stopped, again])).resolves.toEqual(["stopped", "stopped"]);
    expect(sup.lastError()).toContain(UNCLEAN_STOP);
  });

  it("edge: start after an unclean stop clears the message", async () => {
    const { sup, last } = await running();
    const stopped = sup.stop({ anyway: true });
    last().exit(1);
    await stopped;
    expect(sup.lastError()).toContain(UNCLEAN_STOP);
    sup.start();
    expect(sup.lastError()).toBeUndefined();
  });
});
