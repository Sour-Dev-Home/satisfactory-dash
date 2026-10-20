import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  clearPid,
  findLeftover,
  isServerCommand,
  leftoverPid,
  PID_FILE,
  processAlive,
  recordPid,
  watchPid,
} from "./leftoverServer";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sm-pid-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const alive = (pids: number[]) => (pid: number) => pids.includes(pid);

describe("processAlive", () => {
  it("is true for this process and false for an exited one", () => {
    expect(processAlive(process.pid)).toBe(true);
    const done = spawnSync(process.execPath, ["-e", "0"]);
    expect(done.pid).toBeGreaterThan(0);
    expect(processAlive(done.pid)).toBe(false);
  });
});

describe("leftoverServer", () => {
  it("is undefined with no pid file", () => {
    expect(leftoverPid(dir, alive([1]))).toBeUndefined();
  });

  it("records the pid and finds it while that process is alive", () => {
    recordPid(dir, 4242);
    expect(readFileSync(join(dir, PID_FILE), "utf8").trim()).toBe("4242");
    expect(leftoverPid(dir, alive([4242]))).toBe(4242);
  });

  it("drops a stale pid file whose process is gone", () => {
    recordPid(dir, 4242);
    expect(leftoverPid(dir, alive([]))).toBeUndefined();
    expect(existsSync(join(dir, PID_FILE))).toBe(false);
  });

  it("drops a malformed pid file", () => {
    for (const text of ["", "abc", "-3", "1.5", "0"]) {
      writeFileSync(join(dir, PID_FILE), text);
      expect(leftoverPid(dir, alive([0, 1, -3]))).toBeUndefined();
      expect(existsSync(join(dir, PID_FILE))).toBe(false);
    }
  });

  it("clearPid removes the file and tolerates it missing", () => {
    recordPid(dir, 7);
    clearPid(dir);
    expect(existsSync(join(dir, PID_FILE))).toBe(false);
    expect(() => clearPid(dir)).not.toThrow();
  });

  it("recordPid ignores an undefined pid and creates the folder", () => {
    const nested = join(dir, "a");
    recordPid(nested, undefined);
    expect(existsSync(join(nested, PID_FILE))).toBe(false);
    recordPid(nested, 9);
    expect(leftoverPid(nested, alive([9]))).toBe(9);
  });
});

const EXE = "D:\\Games\\Server\\FactoryServer.exe";

describe("isServerCommand", () => {
  it("matches a command line that runs the configured exe, quoted or not, any case on Windows", () => {
    expect(isServerCommand(`"${EXE}" -log`, EXE, "win32")).toBe(true);
    expect(isServerCommand(`"electron.exe" "${EXE.toLowerCase()}" -log`, EXE, "win32")).toBe(true);
    expect(isServerCommand("/opt/e/electron /tmp/x/server/FactoryServer.exe -log", "/tmp/x/server/FactoryServer.exe", "linux")).toBe(true);
  });

  it("rejects anything else, including another folder's FactoryServer.exe and case on Linux", () => {
    expect(isServerCommand("C:\\Windows\\notepad.exe", EXE, "win32")).toBe(false);
    expect(isServerCommand('"E:\\Other\\FactoryServer.exe" -log', EXE, "win32")).toBe(false);
    expect(isServerCommand("/tmp/x/server/factoryserver.exe", "/tmp/x/server/FactoryServer.exe", "linux")).toBe(false);
    expect(isServerCommand("", EXE, "win32")).toBe(false);
  });
});

describe("findLeftover", () => {
  const opts = (cmd: string | undefined, pids = [7]) => ({
    isAlive: alive(pids),
    commandLine: async () => cmd,
    serverExe: EXE,
    platform: "win32" as const,
  });

  it("is none with no pid file, or with a pid that is gone", async () => {
    expect(await findLeftover(dir, opts(`"${EXE}"`))).toEqual({ kind: "none" });
    recordPid(dir, 8);
    expect(await findLeftover(dir, opts(`"${EXE}"`))).toEqual({ kind: "none" });
  });

  it("is ours when the live pid runs the configured server", async () => {
    recordPid(dir, 7);
    expect(await findLeftover(dir, opts(`"${EXE}" -log`))).toEqual({ kind: "ours", pid: 7 });
    expect(existsSync(join(dir, PID_FILE))).toBe(true);
  });

  it("forgets a live pid that now belongs to something else (the pid was reused)", async () => {
    recordPid(dir, 7);
    expect(await findLeftover(dir, opts("C:\\Windows\\explorer.exe"))).toEqual({ kind: "none" });
    expect(existsSync(join(dir, PID_FILE))).toBe(false);
  });

  it("is unverified when the command line can't be read, keeping the file so Start stays refused", async () => {
    recordPid(dir, 7);
    expect(await findLeftover(dir, opts(undefined))).toEqual({ kind: "unverified", pid: 7 });
    expect(existsSync(join(dir, PID_FILE))).toBe(true);
  });
});

describe("watchPid", () => {
  function manualInterval() {
    const live: { cb: () => void; ms: number }[] = [];
    return {
      live,
      fn: (cb: () => void, ms: number) => {
        const entry = { cb, ms };
        live.push(entry);
        return () => {
          live.splice(live.indexOf(entry), 1);
        };
      },
      tick: () => {
        // A copy: a callback that cancels itself removes its entry meanwhile.
        for (const t of live.slice()) t.cb();
      },
    };
  }

  it("reports the process's end once, when a poll finds it gone, then stops polling", () => {
    const pids = [7];
    const every = manualInterval();
    const handle = watchPid(7, { isAlive: (p) => pids.includes(p), kill: () => undefined, every: every.fn });
    const exits: (number | null)[] = [];
    handle.onExit((code) => exits.push(code));
    expect(handle.pid).toBe(7);
    every.tick();
    expect(exits).toEqual([]);
    pids.length = 0;
    every.tick();
    every.tick();
    expect(exits).toEqual([null]);
    expect(every.live).toEqual([]);
  });

  it("kill ends that pid, and a kill that throws (already gone) is swallowed", () => {
    const killed: number[] = [];
    const every = manualInterval();
    const handle = watchPid(7, {
      isAlive: () => true,
      kill: (p) => {
        killed.push(p);
        throw new Error("ESRCH");
      },
      every: every.fn,
    });
    expect(() => handle.kill()).not.toThrow();
    expect(killed).toEqual([7]);
  });
});
