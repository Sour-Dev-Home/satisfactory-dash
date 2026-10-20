/**
 * Guards against a second server. Quitting leaves the server running (ADR-0040 decision 4) and this task doesn't
 * adopt it yet, so the app records the running server's pid beside its settings. On the next launch a pid that is
 * still alive refuses Start, so the app never launches a duplicate FactoryServer.exe. Adopting it is a later task.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
