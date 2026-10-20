/**
 * Never a second server. Quit leaves the server running (ADR-0040 decision 4), so the app records the running
 * server's pid beside its settings. The next launch looks it up (findLeftover): a live pid still running the
 * configured FactoryServer.exe is adopted and supervised again (watchPid); one whose command line can't be read
 * refuses Start instead, so the app never launches a duplicate; anything else is a stale file and is removed.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChildHandle } from "./supervisor";

export const PID_FILE = "server.pid";

export function recordPid(dir: string, pid: number | undefined): void {
  if (pid === undefined) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, PID_FILE), `${pid}\n`);
}

export function clearPid(dir: string): void {
  rmSync(join(dir, PID_FILE), { force: true });
}

/** The recorded pid when that process is still alive; a stale or malformed file is removed. */
export function leftoverPid(dir: string, isAlive: (pid: number) => boolean): number | undefined {
  let text: string;
  try {
    text = readFileSync(join(dir, PID_FILE), "utf8").trim();
  } catch {
    return undefined;
  }
  const pid = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (Number.isSafeInteger(pid) && pid > 0 && isAlive(pid)) return pid;
  clearPid(dir);
  return undefined;
}

/** Whether `commandLine` runs exactly `serverExe` (Windows paths compare without case). */
export function isServerCommand(commandLine: string, serverExe: string, platform: NodeJS.Platform): boolean {
  if (commandLine === "" || serverExe === "") return false;
  return platform === "win32"
    ? commandLine.toLowerCase().includes(serverExe.toLowerCase())
    : commandLine.includes(serverExe);
}

export type Leftover = { kind: "none" } | { kind: "ours"; pid: number } | { kind: "unverified"; pid: number };

export async function findLeftover(
  dir: string,
  opts: {
    isAlive: (pid: number) => boolean;
    commandLine: (pid: number) => Promise<string | undefined>;
    serverExe: string;
    platform: NodeJS.Platform;
  },
): Promise<Leftover> {
  const pid = leftoverPid(dir, opts.isAlive);
  if (pid === undefined) return { kind: "none" };
  const cmd = await opts.commandLine(pid);
  if (cmd === undefined) return { kind: "unverified", pid };
  if (isServerCommand(cmd, opts.serverExe, opts.platform)) return { kind: "ours", pid };
  clearPid(dir);
  return { kind: "none" };
}

export type IntervalFn = (cb: () => void, ms: number) => () => void;

export const WATCH_INTERVAL_MS = 1000;

const defaultInterval: IntervalFn = (cb, ms) => {
  const t = setInterval(cb, ms);
  return () => clearInterval(t);
};

/**
 * A ChildHandle for a process the app didn't spawn: polled until it's gone (exit code unknown), kill() ends it.
 * A kill that fails because it already ended is ignored; the next poll reports the end.
 */
export function watchPid(
  pid: number,
  opts: { isAlive: (pid: number) => boolean; kill: (pid: number) => void; every?: IntervalFn; ms?: number },
): ChildHandle {
  const exitCbs: ((code: number | null, signal: string | null) => void)[] = [];
  let ended = false;
  const cancel = (opts.every ?? defaultInterval)(() => {
    if (ended || opts.isAlive(pid)) return;
    ended = true;
    cancel();
    for (const cb of exitCbs) cb(null, null);
  }, opts.ms ?? WATCH_INTERVAL_MS);
  return {
    pid,
    kill: () => {
      try {
        opts.kill(pid);
      } catch {
        // Already gone.
      }
    },
    onSpawn: () => undefined,
    onExit: (cb) => {
      exitCbs.push(cb);
    },
    onError: () => undefined,
  };
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
