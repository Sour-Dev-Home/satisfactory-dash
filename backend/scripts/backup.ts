import "dotenv/config";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import { ConfigError } from "../src/platform/errors.js";
import { BackupError, loadBackupConfig, runBackup } from "../src/platform/backup/backup.js";
import type { Runner } from "../src/platform/backup/backup.js";

// ADR-0025 decision 7 (PR 8b): the nightly database backup. Run by the Windows scheduled task, or by
// hand for a trial. See docs-vault/wiki/runbooks/backups.md (setup, restore rehearsal, trial run).
//
//   npm run backup -w backend
//
// Reads DATABASE_URL and BACKUP_* from backend/.env. Leave BACKUP_S3_BUCKET empty for a local trial
// that never touches AWS. Exit code 0 = done; non-zero = failed (the message names the step and
// never contains a password, a key or a URL).

const TIMEOUT_MS = 10 * 60 * 1000;
const MAX_STDERR = 2000;

/** The only inherited environment the child programs get: what a program needs to start and find its
 *  own config (AWS_* for the AWS CLI profile). backend/.env is already loaded into process.env, so
 *  everything else in it (SESSION_SECRET, GOOGLE_CLIENT_SECRET, DATABASE_URL, ...) stays out.
 *  Names match case-insensitively (Windows spells them `Path`, `SystemRoot`, ...). */
const INHERITED = new Set([
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "USERNAME",
  "LANG",
]);

function childEnv(extra: Record<string, string> | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    const upper = name.toUpperCase();
    if (value !== undefined && (INHERITED.has(upper) || upper.startsWith("AWS_"))) {
      env[name] = value;
    }
  }
  return { ...env, ...extra };
}

/** Runs a program without a shell and with an allow-listed environment (plus what the caller passes
 *  in `env`, e.g. PGPASSWORD for pg_dump only). */
const run: Runner = (command, args, options) =>
  new Promise((resolve) => {
    const env = childEnv(options?.env);
    const child = spawn(command, args, { env, stdio: ["ignore", "ignore", "pipe"], windowsHide: true, shell: false });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR) {
        stderr += chunk.toString("utf8");
      }
    });
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: 127, stderr: `${command} could not be started (is it installed and on PATH?)` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stderr: stderr.slice(0, MAX_STDERR) });
    });
  });

try {
  const config = loadBackupConfig(process.env, { localDir: join(process.env.LOCALAPPDATA ?? homedir(), "satisfactory-dash", "backups") });
  const result = await runBackup(config, {
    run,
    now: () => new Date(),
    log: (line) => console.log(`[backup] ${line}`),
  });
  console.log(
    `[backup] done: ${result.fileName}${result.uploaded ? " (uploaded)" : " (local only)"}, ${result.prunedLocal} old local copy(ies) removed`,
  );
} catch (err) {
  if (err instanceof ConfigError || err instanceof BackupError) {
    console.error(`[backup] ${err.message}`);
  } else {
    console.error("[backup] unexpected failure");
  }
  process.exitCode = 1;
}
