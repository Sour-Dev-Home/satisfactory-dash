#!/usr/bin/env node
// Local restore check (#502), for the owner's PC, the only place the age private key lives. It proves the newest
// backup in B2 can really be restored: download, decrypt, restore into a throwaway Postgres (roles first), run
// sanity queries, print PASS or FAIL, and delete the plaintext, on success, on failure and on Ctrl-C.
//
//   BACKUP_S3_BUCKET=... BACKUP_S3_ENDPOINT=https://s3.<region>.backblazeb2.com \
//   BACKUP_READ_AWS_PROFILE=satis-backup-read AGE_IDENTITY_FILE=<path to the age private key file> \
//     node scripts/restore-check.mjs
//
// Needs `aws` (v2), `age` and `docker` on PATH. The throwaway database is a `postgres:18` container with no
// published port, a random password and a random name, removed at the end. The age key file is only read, never
// copied; the downloaded dump, the decrypted dump and the container all live and die inside this run. Run it for
// real only on your own machine: CI never has the key (that is the point). Exit 0 = PASS, 1 = FAIL, 2 = usage.
import { execFile, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { PREFIX, pickDumps } from "./backup-check.mjs";

const run = promisify(execFile);
const ROLES = ["satis_migrator", "satis_app", "satis_backup"]; // backend/src/platform/db/admin.ts
const DB = "satis_restore_test";
export const SANITY_QUERIES = {
  migration: "SELECT coalesce(max(name), '') FROM pgmigrations",
  users: "SELECT count(*) FROM identity.users",
  servers: "SELECT count(*) FROM servers.servers",
  audit_events: "SELECT count(*) FROM audit.audit_events",
};

/** `key|value` lines from the sanity queries; an empty value (a failed query) is null for a count. */
export function parseSanityOutput(text) {
  const out = { latestMigration: "", counts: {} };
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([a-z_]+)\|(.*)$/.exec(line.trim());
    if (!m) continue;
    const [, key, value] = m;
    if (key === "migration") out.latestMigration = value;
    else out.counts[key] = value === "" ? null : Number(value);
  }
  return out;
}

/** Is the restored database plausible: a schema version, every table readable, at least `minUsers` users. */
export function evaluateSanity({ latestMigration, counts }, { minUsers = 1 } = {}) {
  const problems = [];
  if (!latestMigration) problems.push("no schema version: the pgmigrations table is missing or empty");
  for (const [table, n] of Object.entries(counts)) {
    if (n === null || !Number.isFinite(n) || n < 0) problems.push(`${table}: could not be counted (table missing or unreadable)`);
  }
  if (Number.isFinite(counts.users) && counts.users < minUsers) problems.push(`users: ${counts.users}, expected at least ${minUsers}`);
  return { ok: problems.length === 0, problems };
}

/** Errors are shown to the owner, so strip anything shaped like an age secret key before it is printed. */
const scrub = (message) => String(message).replace(/AGE-SECRET-KEY-[A-Z0-9]+/gi, "[age key removed]");

/**
 * The whole check, with every side effect injected (the tests use fakes). It never throws. Whatever happens, the
 * database is stopped and the work folder, which holds the plaintext dump, is deleted; a failure to delete it is a
 * failure of the check, and the message names the folder.
 */
export async function restoreCheck(deps, options = {}) {
  const { log = () => {} } = deps;
  const problems = [];
  let dir = null;
  let db = null;
  try {
    dir = await deps.makeWorkDir();
    const newest = await deps.listNewest();
    if (!newest) throw new Error("no backup found in the bucket");
    log(`newest backup: ${newest.key} (${newest.size} bytes)`);
    const encrypted = await deps.download(newest.key, dir);
    const plain = await deps.decrypt(encrypted, dir);
    log("decrypted");
    db = await deps.startDb();
    await deps.createRoles(db);
    await deps.restore(db, plain);
    log("restored");
    const sanity = parseSanityOutput(await deps.sanity(db));
    log(`schema version ${sanity.latestMigration || "(none)"}; counts ${JSON.stringify(sanity.counts)}`);
    problems.push(...evaluateSanity(sanity, options).problems);
  } catch (err) {
    problems.push(scrub(err?.message ?? err));
  } finally {
    if (db) {
      try {
        await deps.stopDb(db);
      } catch (err) {
        problems.push(`could not remove the throwaway database: ${scrub(err?.message ?? err)}`);
      }
    }
    if (dir) {
      try {
        await deps.removeDir(dir);
      } catch (err) {
        problems.push(`COULD NOT DELETE ${dir} (it may hold the decrypted dump): ${scrub(err?.message ?? err)}. Delete it by hand.`);
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

/** The real side effects: aws, age and docker as child processes (no shell), on this machine. */
function realDeps({ bucket, endpoint, profile, identity }, state) {
  const awsBase = ["--endpoint-url", endpoint, "--no-cli-pager", ...(profile ? ["--profile", profile] : [])];
  const env = { ...process.env, AWS_REQUEST_CHECKSUM_CALCULATION: "when_required", AWS_RESPONSE_CHECKSUM_VALIDATION: "when_required" };
  const dockerExec = (id, args, opts) => run("docker", ["exec", id, ...args], { maxBuffer: 8e6, ...opts });
  const psql = (id, sql, extra = []) => dockerExec(id, ["psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-F", "|", ...extra, "-c", sql]);
  return {
    log: (m) => console.log(`  ${m}`),
    async makeWorkDir() {
      state.dir = await mkdtemp(path.join(tmpdir(), "restore-check-")); // 0700 on POSIX; the user's own temp on Windows
      return state.dir;
    },
    async listNewest() {
      const { stdout } = await run("aws", ["s3api", "list-objects-v2", "--bucket", bucket, "--prefix", PREFIX, "--output", "json", ...awsBase], { env, maxBuffer: 8e6 });
      return pickDumps(stdout.trim() ? JSON.parse(stdout) : {})[0] ?? null;
    },
    async download(key, dir) {
      const file = path.join(dir, "backup.dump.age");
      await run("aws", ["s3", "cp", `s3://${bucket}/${key}`, file, ...awsBase], { env });
      return file;
    },
    async decrypt(encrypted, dir) {
      const out = path.join(dir, "backup.dump");
      await run("age", ["--decrypt", "--identity", identity, "--output", out, encrypted]);
      return out;
    },
    async startDb() {
      const name = `satis-restore-check-${randomBytes(4).toString("hex")}`;
      await run("docker", ["run", "-d", "--rm", "--name", name, "-e", `POSTGRES_PASSWORD=${randomBytes(18).toString("hex")}`, "postgres:18"]);
      state.container = name;
      for (let i = 0; i < 60; i++) {
        try {
          await dockerExec(name, ["pg_isready", "-U", "postgres"]);
          // The image's entrypoint restarts the server once after init; a query proves the final one is up.
          await psql(name, "SELECT 1");
          return name;
        } catch {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      throw new Error("the throwaway Postgres did not become ready in 60 s");
    },
    async createRoles(id) {
      // Roles first (runbooks/backups.md): the dump keeps grants to them. No logins are needed to restore.
      for (const role of ROLES) await psql(id, `CREATE ROLE ${role}`);
      await psql(id, `CREATE DATABASE ${DB}`);
    },
    async restore(id, plain) {
      await new Promise((resolve, reject) => {
        const child = spawn("docker", ["exec", "-i", id, "pg_restore", "--no-owner", "--exit-on-error", "-U", "postgres", "-d", DB], { stdio: ["pipe", "ignore", "pipe"] });
        let err = "";
        child.stderr.on("data", (d) => (err += d));
        child.on("error", reject);
        child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`pg_restore exited ${code}: ${err.slice(0, 400)}`))));
        createReadStream(plain).on("error", reject).pipe(child.stdin);
      });
    },
    async sanity(id) {
      const lines = [];
      for (const [key, sql] of Object.entries(SANITY_QUERIES)) {
        try {
          const { stdout } = await psql(id, sql, ["-d", DB]);
          lines.push(`${key}|${stdout.trim()}`);
        } catch {
          lines.push(`${key}|`);
        }
      }
      return lines.join("\n");
    },
    async stopDb(id) {
      await run("docker", ["rm", "-f", id]);
      state.container = null;
    },
    async removeDir(dir) {
      await rm(dir, { recursive: true, force: true });
      if (existsSync(dir)) throw new Error("the folder is still there after removal");
      state.dir = null;
    },
  };
}

async function main() {
  const bucket = process.env.BACKUP_S3_BUCKET;
  const endpoint = process.env.BACKUP_S3_ENDPOINT;
  const identity = process.env.AGE_IDENTITY_FILE;
  const profile = process.env.BACKUP_READ_AWS_PROFILE;
  if (!bucket || !endpoint?.startsWith("https://") || !identity) {
    console.error("Set BACKUP_S3_BUCKET, BACKUP_S3_ENDPOINT (https://...), AGE_IDENTITY_FILE and, usually, BACKUP_READ_AWS_PROFILE.");
    process.exit(2);
  }
  if (!existsSync(identity)) {
    console.error("AGE_IDENTITY_FILE does not exist.");
    process.exit(2);
  }
  const state = { dir: null, container: null };
  // Ctrl-C or a terminated task must not leave the plaintext or the container behind.
  const bail = (code) => () => {
    try {
      if (state.container) execFileSync("docker", ["rm", "-f", state.container], { stdio: "ignore" });
    } catch {}
    try {
      if (state.dir) rmSync(state.dir, { recursive: true, force: true });
    } catch {}
    process.exit(code);
  };
  process.on("SIGINT", bail(130));
  process.on("SIGTERM", bail(143));

  console.log("Restore check");
  const result = await restoreCheck(realDeps({ bucket, endpoint, profile, identity }, state), { minUsers: Number(process.env.RESTORE_MIN_USERS ?? 1) });
  console.log(result.ok ? "PASS: the newest backup decrypts and restores, and the data looks right." : "FAIL");
  for (const p of result.problems) console.log(`  - ${p}`);
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
