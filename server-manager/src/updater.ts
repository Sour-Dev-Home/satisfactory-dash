/**
 * Updates the dedicated server with SteamCMD (ADR-0040): the configured folder's steamcmd.exe, with exactly
 * STEAMCMD_ARGS around the server folder, through the same no-shell SpawnFn as the server. Its output is passed on a
 * line at a time; the result is its exit code. The caller makes sure the server is stopped first.
 */
import { join } from "node:path";
import { STEAMCMD_EXE } from "./settings";
import type { SpawnFn } from "./supervisor";

/** The dedicated server's Steam app id. */
export const SERVER_APP_ID = "1690800";

export function steamcmdArgs(serverDir: string): string[] {
  return ["+force_install_dir", trimTrailingSeparators(serverDir), "+login", "anonymous", "+app_update", SERVER_APP_ID, "validate", "+quit"];
}

/**
 * A trailing backslash would end up before the closing quote Windows puts round an argument with a space in it
 * (`"C:\My Server\"`), and SteamCMD would read the quote as part of the folder. A drive root keeps its one separator.
 */
function trimTrailingSeparators(dir: string): string {
  const trimmed = dir.replace(/[\\/]+$/, "");
  return trimmed === "" || /^[A-Za-z]:$/.test(trimmed) ? `${trimmed}${dir.charAt(trimmed.length)}` : trimmed;
}

export function runUpdate(opts: {
  steamcmdDir: string;
  serverDir: string;
  spawn: SpawnFn;
  onLine: (line: string) => void;
}): Promise<{ ok: boolean; code: number }> {
  return new Promise((resolve) => {
    let done = false;
    let partial = "";
    const emit = (line: string) => {
      try {
        opts.onLine(line);
      } catch {
        // A broken listener must not stop the update or lose its result.
      }
    };
    const push = (chunk: string) => {
      const parts = (partial + chunk).split(/\r\n|\r|\n/);
      partial = parts.pop() ?? "";
      for (const line of parts) if (line.trim() !== "") emit(line);
    };
    const finish = (code: number) => {
      if (done) return;
      done = true;
      if (partial.trim() !== "") emit(partial);
      partial = "";
      resolve({ ok: code === 0, code });
    };
    let child: ReturnType<SpawnFn>;
    try {
      child = opts.spawn(join(opts.steamcmdDir, STEAMCMD_EXE), steamcmdArgs(opts.serverDir));
    } catch (err) {
      emit(`Could not start SteamCMD: ${err instanceof Error ? err.message : String(err)}`);
      finish(-1);
      return;
    }
    child.onOutput?.(push);
    child.onExit((code) => finish(code ?? -1));
    child.onError((err) => {
      emit(`Could not start SteamCMD: ${err.message}`);
      finish(-1);
    });
  });
}
