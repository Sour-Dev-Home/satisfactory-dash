/**
 * Never a second server. Quit leaves the server running (ADR-0040 decision 4), so the app records the running
 * server's pid beside its settings. The next launch looks it up (findLeftover): a live pid still running the
 * configured FactoryServer.exe is adopted and supervised again (watchPid); one whose command line can't be read
 * refuses Start instead, so the app never launches a duplicate; anything else is a stale file and is removed.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, posix, win32 } from "node:path";
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

/** A path as compared: on Windows without the `\\?\` prefix, with backslashes, normalised and lower-cased. */
function comparable(p: string, platform: NodeJS.Platform): string {
  if (platform !== "win32") return posix.normalize(p);
  const bare = p.replace(/^\\\\\?\\/, "").replace(/^\/\/\?\//, "");
  return win32.normalize(bare.replace(/\//g, "\\")).toLowerCase();
}

/**
 * Splits off the first token of a command line: a quoted one up to its closing quote, else up to the first space.
 * `known` lists paths that may contain spaces unquoted (ps prints argv joined by spaces): a line starting with one
 * of them followed by a space or the end takes it whole.
 */
function firstToken(line: string, known: readonly string[], platform: NodeJS.Platform): { token: string; rest: string } {
  const text = line.trimStart();
  if (text.startsWith('"')) {
    const end = text.indexOf('"', 1);
    return end < 0 ? { token: text.slice(1), rest: "" } : { token: text.slice(1, end), rest: text.slice(end + 1) };
  }
  for (const k of known) {
    const head = text.slice(0, k.length);
    const after = text.charAt(k.length);
    if (k !== "" && (after === "" || after === " ") && comparable(head, platform) === comparable(k, platform)) {
      return { token: head, rest: text.slice(k.length) };
    }
  }
  const space = text.indexOf(" ");
  return space < 0 ? { token: text, rest: "" } : { token: text.slice(0, space), rest: text.slice(space) };
}

const basename = (p: string, platform: NodeJS.Platform) => (platform === "win32" ? win32.basename(p) : posix.basename(p));

/**
 * Whether `commandLine` runs the configured server: `ours` when its executable (argv[0]) is exactly `serverExe`;
 * `maybe` when it is a FactoryServer.exe at a path that only might be the same (an 8.3 name, a junction), so it is
 * neither adopted nor forgotten; `other` for anything else, including the path appearing only as an argument.
 * `viaNode` (the e2e switch only: the app's own Electron) also accepts argv[1] when argv[0] is that Electron.
 */
export function serverCommandMatch(
  commandLine: string,
  serverExe: string,
  platform: NodeJS.Platform,
  viaNode?: string,
): "ours" | "maybe" | "other" {
  if (commandLine.trim() === "" || serverExe === "") return "other";
  const known = viaNode === undefined ? [serverExe] : [serverExe, viaNode];
  let { token, rest } = firstToken(commandLine, known, platform);
  if (viaNode !== undefined && comparable(token, platform) === comparable(viaNode, platform)) {
    token = firstToken(rest, known, platform).token;
  }
  if (token === "") return "other";
  if (comparable(token, platform) === comparable(serverExe, platform)) return "ours";
  const same = platform === "win32" ? (a: string, b: string) => a.toLowerCase() === b.toLowerCase() : (a: string, b: string) => a === b;
  return same(basename(token, platform), basename(serverExe, platform)) ? "maybe" : "other";
}

export function isServerCommand(commandLine: string, serverExe: string, platform: NodeJS.Platform, viaNode?: string): boolean {
  return serverCommandMatch(commandLine, serverExe, platform, viaNode) === "ours";
}

export type Leftover = { kind: "none" } | { kind: "ours"; pid: number } | { kind: "unverified"; pid: number };

export async function findLeftover(
  dir: string,
  opts: {
    isAlive: (pid: number) => boolean;
    commandLine: (pid: number) => Promise<string | undefined>;
    serverExe: string;
    platform: NodeJS.Platform;
    viaNode?: string;
  },
): Promise<Leftover> {
  const pid = leftoverPid(dir, opts.isAlive);
  if (pid === undefined) return { kind: "none" };
  const cmd = await opts.commandLine(pid);
  if (cmd === undefined) return { kind: "unverified", pid };
  const match = serverCommandMatch(cmd, opts.serverExe, opts.platform, opts.viaNode);
  if (match === "ours") return { kind: "ours", pid };
  if (match === "maybe") return { kind: "unverified", pid };
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
 *
 * With `stillOurs`, kill() first re-checks that the pid still runs the adopted server (a pid can be reused once it
 * ends). When it doesn't, or the check fails, nothing is killed and the handle reports the process gone, so the
 * supervisor lets go of it.
 */
export function watchPid(
  pid: number,
  opts: {
    isAlive: (pid: number) => boolean;
    kill: (pid: number) => void;
    stillOurs?: (pid: number) => Promise<boolean>;
    every?: IntervalFn;
    ms?: number;
  },
): ChildHandle {
  const exitCbs: ((code: number | null, signal: string | null) => void)[] = [];
  let ended = false;
  let cancel: (() => void) | undefined;
  const end = () => {
    if (ended) return;
    ended = true;
    cancel?.();
    for (const cb of exitCbs) cb(null, null);
  };
  cancel = (opts.every ?? defaultInterval)(() => {
    if (!ended && !opts.isAlive(pid)) end();
  }, opts.ms ?? WATCH_INTERVAL_MS);
  // An interval that ran at once and found it gone had no cancel to call yet.
  if (ended) cancel();
  const killNow = () => {
    try {
      opts.kill(pid);
    } catch {
      // Already gone.
    }
  };
  return {
    pid,
    kill: () => {
      if (ended) return;
      if (!opts.stillOurs) return killNow();
      void opts.stillOurs(pid).then(
        (ours) => (ours ? killNow() : end()),
        () => end(),
      );
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
