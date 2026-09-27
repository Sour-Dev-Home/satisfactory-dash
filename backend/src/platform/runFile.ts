import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export interface RunFileInfo {
  commit: string;
  pid: number;
  startedAt: string;
}

/**
 * Issue #320, option C: with `RUN_FILE_DIR` set, once the server is listening, writes
 * `<RUN_FILE_DIR>/backend.json` = `{commit, pid, startedAt}` so `deploy-update.ps1` can tell, after
 * a 200 from `/api/health/ready`, that the NEW build (not a leftover old process, and not a second
 * instance) is the one actually serving: it requires the file's `commit` to equal the deployed SHA
 * and `startedAt` to be later than the restart it just issued. A purely local file, under the
 * user profile's own permissions — nothing here is exposed over HTTP, unlike the rejected
 * alternative of putting the commit in the public readiness response.
 *
 * Written nowhere when `RUN_FILE_DIR` is unset: on AWS/ECS (ADR-0034) this isn't needed, since a
 * deploy there replaces the task and the platform's own health check already covers it — the
 * container's entrypoint simply never sets the variable.
 *
 * Atomic: written to a temp file in the same directory, then renamed into place, so a reader (the
 * deploy script, possibly mid-write) never sees a partial file — a same-directory rename is atomic
 * on both Windows and POSIX filesystems. If the write or the rename fails partway (ENOSPC, an AV
 * scanner locking the fresh temp file, ...), the temp file is deleted before the error propagates,
 * so a failure never leaves a stray `.tmp` file behind forever (test-hunter, #320) — best-effort:
 * the cleanup's own failure is swallowed, since the original error is the one worth reporting.
 */
export async function writeRunFile(runFileDir: string | undefined, info: RunFileInfo): Promise<void> {
  if (!runFileDir) return;
  await mkdir(runFileDir, { recursive: true });
  const finalPath = path.join(runFileDir, "backend.json");
  // Includes this process's own pid, so two instances racing to write never collide on the same temp name.
  const tmpPath = path.join(runFileDir, `.backend.json.${info.pid}.tmp`);
  try {
    await writeFile(tmpPath, JSON.stringify(info), "utf8");
    await rename(tmpPath, finalPath);
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
}
