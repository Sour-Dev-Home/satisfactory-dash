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
  serverCommandMatch,
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

describe("serverCommandMatch / isServerCommand", () => {
  const LINUX_EXE = "/tmp/x/server/FactoryServer.exe";
  const ELECTRON = "E:\\e\\electron.exe";

  it("is ours when the executable (argv[0]) is the configured exe, quoted or not", () => {
    expect(serverCommandMatch(`"${EXE}" -log`, EXE, "win32")).toBe("ours");
    expect(serverCommandMatch(`${EXE} -log`, EXE, "win32")).toBe("ours");
    expect(serverCommandMatch(EXE, EXE, "win32")).toBe("ours");
    expect(serverCommandMatch(`${LINUX_EXE} -log`, LINUX_EXE, "linux")).toBe("ours");
    expect(isServerCommand(`"${EXE}" -log`, EXE, "win32")).toBe(true);
  });

  it("on Windows ignores case, slash direction and the \\\\?\\ prefix", () => {
    expect(serverCommandMatch(`"${EXE.toLowerCase()}" -log`, EXE, "win32")).toBe("ours");
    expect(serverCommandMatch('"D:/Games/Server/FactoryServer.exe" -log', EXE, "win32")).toBe("ours");
    expect(serverCommandMatch(`"\\\\?\\${EXE}" -log`, EXE, "win32")).toBe("ours");
  });

  it("is other when the path is only an argument, or a longer file name", () => {
    expect(serverCommandMatch(`notepad.exe "${EXE}"`, EXE, "win32")).toBe("other");
    expect(serverCommandMatch(`"C:\\Windows\\notepad.exe" ${EXE}`, EXE, "win32")).toBe("other");
    expect(serverCommandMatch(`"${EXE}.old" -log`, EXE, "win32")).toBe("other");
    expect(serverCommandMatch(`${EXE}.old -log`, EXE, "win32")).toBe("other");
    expect(serverCommandMatch("C:\\Windows\\explorer.exe", EXE, "win32")).toBe("other");
    expect(serverCommandMatch("", EXE, "win32")).toBe("other");
    expect(serverCommandMatch(`/opt/e/electron ${LINUX_EXE} -log`, LINUX_EXE, "linux")).toBe("other");
    expect(serverCommandMatch("/tmp/x/server/factoryserver.exe", LINUX_EXE, "linux")).toBe("other");
  });

  it("is maybe for a FactoryServer.exe whose path differs only in a way it can't resolve (8.3 name, another folder)", () => {
    expect(serverCommandMatch('"D:\\GAMES~1\\Server\\FactoryServer.exe" -log', EXE, "win32")).toBe("maybe");
    expect(serverCommandMatch('"E:\\Other\\FactoryServer.exe" -log', EXE, "win32")).toBe("maybe");
    expect(isServerCommand('"E:\\Other\\FactoryServer.exe" -log', EXE, "win32")).toBe(false);
  });

  it("under the e2e switch, takes argv[1] only when argv[0] is the app's own Electron", () => {
    expect(serverCommandMatch(`"${ELECTRON}" "${EXE}" -log`, EXE, "win32", ELECTRON)).toBe("ours");
    expect(serverCommandMatch(`/opt/e/electron ${LINUX_EXE} -log`, LINUX_EXE, "linux", "/opt/e/electron")).toBe("ours");
    expect(serverCommandMatch(`"${ELECTRON}" "${EXE}" -log`, EXE, "win32")).toBe("other");
    expect(serverCommandMatch(`"C:\\other\\node.exe" "${EXE}" -log`, EXE, "win32", ELECTRON)).toBe("other");
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

  it("is unverified, keeping the file, for a FactoryServer.exe whose path differs only in form", async () => {
    recordPid(dir, 7);
    expect(await findLeftover(dir, opts('"D:\\GAMES~1\\Server\\FactoryServer.exe" -log'))).toEqual({ kind: "unverified", pid: 7 });
    expect(existsSync(join(dir, PID_FILE))).toBe(true);
  });

  it("forgets a pid whose command line only mentions the exe as an argument", async () => {
    recordPid(dir, 7);
    expect(await findLeftover(dir, opts(`notepad.exe "${EXE}"`))).toEqual({ kind: "none" });
    expect(existsSync(join(dir, PID_FILE))).toBe(false);
  });

  it("passes the e2e runner through, so the fake run by Electron is ours", async () => {
    recordPid(dir, 7);
    const run = { ...opts(`"E:\\e\\electron.exe" "${EXE}" -log`), viaNode: "E:\\e\\electron.exe" };
    expect(await findLeftover(dir, run)).toEqual({ kind: "ours", pid: 7 });
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

  it("with stillOurs, kills only after re-checking the pid is still the adopted server", async () => {
    const killed: number[] = [];
    const handle = watchPid(7, {
      isAlive: () => true,
      kill: (p) => void killed.push(p),
      stillOurs: async () => true,
      every: manualInterval().fn,
    });
    handle.kill();
    await new Promise((r) => setTimeout(r, 0));
    expect(killed).toEqual([7]);
  });

  it("when the pid no longer runs the server, doesn't kill it and stops supervising it", async () => {
    const killed: number[] = [];
    const every = manualInterval();
    const handle = watchPid(7, {
      isAlive: () => true,
      kill: (p) => void killed.push(p),
      stillOurs: async () => false,
      every: every.fn,
    });
    const exits: (number | null)[] = [];
    handle.onExit((code) => exits.push(code));
    handle.kill();
    await new Promise((r) => setTimeout(r, 0));
    expect(killed).toEqual([]);
    expect(exits).toEqual([null]);
    expect(every.live).toEqual([]);
  });

  it("a failing re-check kills nothing and keeps watching the pid (never frees Start for a second server)", async () => {
    const killed: number[] = [];
    let alive = true;
    const every = manualInterval();
    const handle = watchPid(7, {
      isAlive: () => alive,
      kill: (p) => void killed.push(p),
      stillOurs: async () => {
        throw new Error("powershell failed");
      },
      every: every.fn,
    });
    const exits: (number | null)[] = [];
    handle.onExit((code) => exits.push(code));
    handle.kill();
    await new Promise((r) => setTimeout(r, 0));
    expect(killed).toEqual([]);
    expect(exits).toEqual([]);
    expect(every.live).toHaveLength(1);
    // It still notices the process really ending.
    alive = false;
    every.tick();
    expect(exits).toEqual([null]);
  });
});
