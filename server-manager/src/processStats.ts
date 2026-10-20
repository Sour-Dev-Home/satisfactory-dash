/**
 * CPU and memory of the game-server process, for the window. Node has no API for another process's usage, so this asks
 * the OS: PowerShell's Get-Process on Windows (as the agent's dpapi.ts does: a fixed script, the pid passed in the
 * environment, never interpolated), `ps` elsewhere (CI runs the e2e tests on Linux). A failed sample is undefined and
 * the window shows a dash.
 */
import { execFile } from "node:child_process";

export interface Usage {
  cpuSeconds: number;
  memoryBytes: number;
}

export type ExecFn = (file: string, args: readonly string[], env?: NodeJS.ProcessEnv) => Promise<string>;

const PS_SCRIPT =
  "$p = Get-Process -Id ([int]$env:SM_STATS_PID) -ErrorAction Stop; [Console]::Out.Write(\"$($p.CPU) $($p.WorkingSet64)\")";

const execText: ExecFn = (file, args, env) =>
  new Promise((resolve, reject) => {
    execFile(file, [...args], { env, windowsHide: true, timeout: 10_000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout));
    });
  });

/** Windows PowerShell from System32, not whatever `powershell.exe` the PATH finds first. */
export function powershellPath(env: NodeJS.ProcessEnv): string {
  const root = env.SystemRoot;
  return root ? `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : "powershell.exe";
}

export async function sampleProcess(
  pid: number,
  opts: { platform?: NodeJS.Platform; exec?: ExecFn; env?: NodeJS.ProcessEnv } = {},
): Promise<Usage | undefined> {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  const platform = opts.platform ?? process.platform;
  const exec = opts.exec ?? execText;
  const env = opts.env ?? process.env;
  try {
    if (platform === "win32") {
      const out = await exec(
        powershellPath(env),
        ["-NoProfile", "-NonInteractive", "-Command", PS_SCRIPT],
        { ...env, SM_STATS_PID: String(pid) },
      );
      return parsePowerShell(out);
    }
    return parsePs(await exec("ps", ["-o", "time=,rss=", "-p", String(pid)], env));
  } catch {
    return undefined;
  }
}

/** `ps -o time=,rss=`: CPU time as [[dd-]hh:]mm:ss[.ff] and resident memory in KiB. */
export function parsePs(text: string): Usage | undefined {
  const m = /^\s*(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)\s+(\d+)\s*$/.exec(text);
  if (!m) return undefined;
  const [, days, hours, minutes, seconds, rss] = m;
  const cpuSeconds = Number(days ?? 0) * 86400 + Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds);
  return { cpuSeconds, memoryBytes: Number(rss) * 1024 };
}

/** PowerShell's `"$($p.CPU) $($p.WorkingSet64)"`: invariant-culture seconds and bytes. */
export function parsePowerShell(text: string): Usage | undefined {
  const m = /^\s*(\d+(?:\.\d+)?)\s+(\d+)\s*$/.exec(text);
  if (!m) return undefined;
  return { cpuSeconds: Number(m[1]), memoryBytes: Number(m[2]) };
}

/** Share of the whole machine (all cores), like Task Manager; undefined when two samples can't be compared. */
export function cpuPercent(
  prev: { cpuSeconds: number; at: number },
  next: { cpuSeconds: number; at: number },
  cores: number,
): number | undefined {
  const wallSeconds = (next.at - prev.at) / 1000;
  const used = next.cpuSeconds - prev.cpuSeconds;
  if (wallSeconds <= 0 || used < 0 || cores <= 0) return undefined;
  return Math.min(100, (used / (wallSeconds * cores)) * 100);
}
