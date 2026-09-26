import { mkdir, mkdtemp, readdir, rm, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ConfigError } from "../errors.js";

/**
 * ADR-0025 decision 7, PR 8b: a nightly `pg_dump -Fc`, encrypted ON THIS PC with `age` to a public
 * key (the private key stays offline, so neither this PC nor a leaked AWS key can read old
 * backups), then uploaded to the owner's private S3 bucket with a PUT-ONLY profile. Retention in S3
 * is the bucket's lifecycle rule (30 days); locally only the newest few encrypted copies are kept.
 *
 * This module has no I/O of its own beyond the plaintext temp file and the local copies: every
 * external program goes through an injected `Runner`, so the whole flow is unit-tested without
 * Postgres, age or AWS. Nothing secret is ever put on a command line or in a message: the database
 * password travels in PGPASSWORD, the age recipient is a PUBLIC key, and AWS credentials live in the
 * named AWS CLI profile.
 */

export interface BackupConfig {
  database: { host: string; port: string; user: string; password: string; name: string; sslmode?: string };
  /** A public age recipient (`age1...`). */
  ageRecipient: string;
  /** Empty = no upload (local trial runs without AWS). */
  s3Bucket: string;
  awsProfile: string;
  /** An S3-compatible endpoint origin (https only), for a store that is not AWS S3, e.g. Backblaze B2. Empty = AWS S3. */
  s3Endpoint: string;
  /** Where encrypted copies are kept locally. */
  localDir: string;
  /** How many encrypted local copies to keep (newest first). */
  localKeep: number;
}

export const S3_KEY_PREFIX = "satis-dash/";
const AGE_RECIPIENT = /^age1[a-z0-9]{50,}$/;
const BACKUP_FILE = /^satis-\d{8}T\d{6}Z\.dump\.age$/;
const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
// Starts with a letter or digit, so a profile name can never be read as an option.
const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * BACKUP_S3_ENDPOINT: empty means plain AWS S3. Otherwise an https origin without credentials. It must start with
 * "https://", so it can never be read as an option, and the refusal never echoes the value (it could hold a secret).
 */
function parseS3Endpoint(raw: string | undefined): string {
  const text = raw?.trim() ?? "";
  if (!text) return "";
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new ConfigError("BACKUP_S3_ENDPOINT must be an https:// URL.");
  }
  if (url.protocol !== "https:" || url.hostname === "" || url.username !== "" || url.password !== "" || !text.startsWith("https://")) {
    throw new ConfigError("BACKUP_S3_ENDPOINT must be an https:// URL without credentials.");
  }
  return url.origin;
}

export interface RunResult {
  code: number;
  /** Truncated stderr, for the failure message only. Never stdout. */
  stderr: string;
}
export interface RunOptions {
  env?: Record<string, string>;
}
/** Runs one program WITHOUT a shell (arguments are never interpreted). */
export type Runner = (command: string, args: string[], options?: RunOptions) => Promise<RunResult>;

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

/** Reads the settings from the environment. Messages name variables, never values. */
export function loadBackupConfig(env: NodeJS.ProcessEnv, defaults: { localDir: string }): BackupConfig {
  // BACKUP_DATABASE_URL (optional) names a role that can read every table and sequence, for the case
  // where the app role can't (pg_dump then reports "permission denied"); it defaults to DATABASE_URL.
  const databaseUrl = env.BACKUP_DATABASE_URL?.trim() || env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new ConfigError("DATABASE_URL (or BACKUP_DATABASE_URL) must be set (see backend/.env.example).");
  }
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new ConfigError("DATABASE_URL is not a valid URL.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new ConfigError("DATABASE_URL must be a postgres:// URL.");
  }
  let name: string;
  let user: string;
  let password: string;
  try {
    name = decodeURIComponent(url.pathname.replace(/^\//, ""));
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch {
    throw new ConfigError("DATABASE_URL has an invalid percent-escape (encode special characters in the user/password).");
  }
  // URL keeps the brackets on an IPv6 host ("[::1]"); pg_dump wants it bare.
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  if (!host || !name || !user) {
    throw new ConfigError("DATABASE_URL needs a host, user and database name.");
  }
  const sslmode = url.searchParams.get("sslmode") ?? undefined;
  if (sslmode !== undefined && !/^(disable|allow|prefer|require|verify-ca|verify-full)$/.test(sslmode)) {
    throw new ConfigError("DATABASE_URL has an unsupported sslmode.");
  }
  const ageRecipient = env.BACKUP_AGE_RECIPIENT?.trim() ?? "";
  if (!AGE_RECIPIENT.test(ageRecipient)) {
    throw new ConfigError("BACKUP_AGE_RECIPIENT must be an age PUBLIC key (starts with age1). Never put the private key here.");
  }
  const s3Bucket = env.BACKUP_S3_BUCKET?.trim() ?? "";
  if (s3Bucket && !BUCKET_NAME.test(s3Bucket)) {
    throw new ConfigError("BACKUP_S3_BUCKET is not a valid bucket name.");
  }
  const awsProfile = env.BACKUP_AWS_PROFILE?.trim() || "satis-backup";
  if (!PROFILE_NAME.test(awsProfile)) {
    throw new ConfigError("BACKUP_AWS_PROFILE is not a valid profile name.");
  }
  const s3Endpoint = parseS3Endpoint(env.BACKUP_S3_ENDPOINT);
  const keepText = env.BACKUP_LOCAL_KEEP?.trim();
  const localKeep = keepText ? Number(keepText) : 3;
  if (!Number.isInteger(localKeep) || localKeep < 1 || localKeep > 60) {
    throw new ConfigError("BACKUP_LOCAL_KEEP must be a whole number from 1 to 60.");
  }
  return {
    database: {
      host,
      port: url.port || "5432",
      user,
      password,
      name,
      ...(sslmode ? { sslmode } : {}),
    },
    ageRecipient,
    s3Bucket,
    awsProfile,
    s3Endpoint,
    // Absolute, so the path handed to age and aws can never start with "-" and be read as an option.
    localDir: resolve(env.BACKUP_LOCAL_DIR?.trim() || defaults.localDir),
    localKeep,
  };
}

/** `satis-20260925T101500Z.dump.age`, from UTC time. */
export function backupFileName(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `satis-${stamp}.dump.age`;
}

export interface BackupResult {
  fileName: string;
  uploaded: boolean;
  prunedLocal: number;
}

export interface BackupDeps {
  run: Runner;
  now: () => Date;
  log: (line: string) => void;
}

function fail(step: string, result: RunResult): never {
  const detail = result.stderr.trim().slice(0, 300);
  throw new BackupError(`${step} failed (exit ${result.code})${detail ? `: ${detail}` : ""}`);
}

/**
 * One backup run: dump -> encrypt -> (upload) -> prune local copies. The plaintext dump exists only
 * in a private temp directory and is removed in `finally`, success or failure. A failed step throws
 * BackupError and nothing later runs (a failed dump is never uploaded, a failed encryption never
 * leaves a plaintext behind). Never prunes or uploads before the new encrypted copy exists.
 */
export async function runBackup(config: BackupConfig, deps: BackupDeps): Promise<BackupResult> {
  const fileName = backupFileName(deps.now());
  await mkdir(config.localDir, { recursive: true });
  // A run killed between the dump and its cleanup (power loss, "stop task") leaves a plaintext dump in
  // the temp folder: sweep any such leftover from an earlier run before starting.
  await sweepStaleWorkDirs(deps.now().getTime());
  const workDir = await mkdtemp(join(tmpdir(), WORK_DIR_PREFIX));
  const plainPath = join(workDir, "dump.plain");
  const encryptedPath = join(config.localDir, fileName);
  let encryptedWritten = false;
  try {
    const dump = await deps.run(
      "pg_dump",
      [
        "--format=custom",
        // Owners are dropped (a restore makes the restoring role the owner); the grants to satis_app are
        // KEPT so a restored database works without re-granting by hand (the roles come from db:init).
        "--no-owner",
        `--host=${config.database.host}`,
        `--port=${config.database.port}`,
        `--username=${config.database.user}`,
        `--dbname=${config.database.name}`,
        `--file=${plainPath}`,
      ],
      { env: { PGPASSWORD: config.database.password, ...(config.database.sslmode ? { PGSSLMODE: config.database.sslmode } : {}) } },
    );
    if (dump.code !== 0) {
      fail("pg_dump", dump);
    }
    deps.log("dump created");

    const encrypt = await deps.run("age", ["--recipient", config.ageRecipient, "--output", encryptedPath, plainPath]);
    if (encrypt.code !== 0) {
      await rm(encryptedPath, { force: true });
      fail("age encryption", encrypt);
    }
    encryptedWritten = true;
    deps.log(`encrypted as ${fileName}`);
  } finally {
    // The plaintext never outlives the run, whatever happened.
    await rm(workDir, { recursive: true, force: true });
  }

  let uploaded = false;
  if (config.s3Bucket) {
    const upload = await deps.run("aws", [
      "s3",
      "cp",
      encryptedPath,
      `s3://${config.s3Bucket}/${S3_KEY_PREFIX}${fileName}`,
      "--profile",
      config.awsProfile,
      ...(config.s3Endpoint ? ["--endpoint-url", config.s3Endpoint] : []),
      "--only-show-errors",
    ]);
    if (upload.code !== 0) {
      fail("upload to S3", upload);
    }
    uploaded = true;
    deps.log("uploaded");
  } else {
    deps.log("no BACKUP_S3_BUCKET set: not uploaded (local trial run)");
  }

  const prunedLocal = encryptedWritten ? await pruneLocalCopies(config.localDir, config.localKeep) : 0;
  return { fileName, uploaded, prunedLocal };
}

const WORK_DIR_PREFIX = "satis-backup-";
const STALE_WORK_DIR_MS = 60 * 60 * 1000;

/** Removes `satis-backup-*` temp folders older than an hour (a run never takes that long). Only
 *  folders with that exact prefix are touched. */
export async function sweepStaleWorkDirs(nowMs: number, dir: string = tmpdir()): Promise<number> {
  let removed = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(WORK_DIR_PREFIX)) {
      continue;
    }
    const path = join(dir, entry.name);
    try {
      if (nowMs - (await stat(path)).mtimeMs > STALE_WORK_DIR_MS) {
        await rm(path, { recursive: true, force: true });
        removed++;
      }
    } catch {
      // Gone already, or not ours to touch: never fail a backup over housekeeping.
    }
  }
  return removed;
}

/** Deletes the oldest `satis-<stamp>.dump.age` files beyond the newest `keep`. Only files matching
 *  that exact pattern are ever touched. Returns how many were deleted. */
export async function pruneLocalCopies(dir: string, keep: number): Promise<number> {
  const names = (await readdir(dir)).filter((name) => BACKUP_FILE.test(name)).sort();
  const doomed = names.slice(0, Math.max(0, names.length - keep));
  for (const name of doomed) {
    await unlink(join(dir, name));
  }
  return doomed.length;
}
