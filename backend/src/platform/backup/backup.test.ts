import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { ConfigError } from "../errors.js";
import {
  BackupError,
  backupFileName,
  loadBackupConfig,
  pruneLocalCopies,
  runBackup,
  S3_KEY_PREFIX,
  sweepStaleWorkDirs,
} from "./backup.js";
import type { BackupConfig, RunOptions, RunResult, Runner } from "./backup.js";

const RECIPIENT = "age1" + "q".repeat(58);
const PASSWORD = "s3cr3t/p@ss:w0rd";
const ENV = {
  DATABASE_URL: `postgres://satis_app:${encodeURIComponent(PASSWORD)}@127.0.0.1:5432/satis`,
  BACKUP_AGE_RECIPIENT: RECIPIENT,
};

interface Call {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** A fake toolchain: pg_dump and age write the files the real ones would; each can be told to fail. */
function fakeRunner(behaviour: { pgDump?: number; age?: number; aws?: number } = {}) {
  const calls: Call[] = [];
  const plainPaths: string[] = [];
  const run: Runner = async (command, args, options?: RunOptions): Promise<RunResult> => {
    calls.push({ command, args, env: options?.env });
    if (command === "pg_dump") {
      const file = args.find((a) => a.startsWith("--file="))!.slice("--file=".length);
      plainPaths.push(file);
      if (behaviour.pgDump) {
        return { code: behaviour.pgDump, stderr: "pg_dump: error: connection failed" };
      }
      await writeFile(file, "PLAINTEXT DUMP");
      return { code: 0, stderr: "" };
    }
    if (command === "age") {
      const out = args[args.indexOf("--output") + 1]!;
      await writeFile(out, "ENCRYPTED");
      return behaviour.age ? { code: behaviour.age, stderr: "age: error" } : { code: 0, stderr: "" };
    }
    if (command === "aws") {
      return behaviour.aws ? { code: behaviour.aws, stderr: "An error occurred (AccessDenied)" } : { code: 0, stderr: "" };
    }
    throw new Error(`unexpected command ${command}`);
  };
  return { run, calls, plainPaths };
}

describe("backup (ADR-0025 decision 7, PR 8b)", () => {
  let dir: string;
  let config: BackupConfig;
  const now = () => new Date("2026-09-25T10:15:30.000Z");
  const logs: string[] = [];
  const deps = (run: Runner) => ({ run, now, log: (line: string) => logs.push(line) });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "backup-test-"));
    logs.length = 0;
    config = { ...loadBackupConfig({ ...ENV, BACKUP_S3_BUCKET: "my-backups", BACKUP_LOCAL_DIR: dir }, { localDir: dir }) };
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe("configuration", () => {
    it("parses the database URL, decoding the password, and defaults the profile and retention", () => {
      expect(config.database).toEqual({ host: "127.0.0.1", port: "5432", user: "satis_app", password: PASSWORD, name: "satis" });
      expect(config.awsProfile).toBe("satis-backup");
      expect(config.localKeep).toBe(3);
    });

    it.each([
      ["no DATABASE_URL", { ...ENV, DATABASE_URL: "" }],
      ["a non-postgres URL", { ...ENV, DATABASE_URL: "http://x/y" }],
      ["a URL with no database", { ...ENV, DATABASE_URL: "postgres://u:p@h" }],
      ["no recipient", { ...ENV, BACKUP_AGE_RECIPIENT: "" }],
      ["an age PRIVATE key in the recipient variable", { ...ENV, BACKUP_AGE_RECIPIENT: "AGE-SECRET-KEY-1" + "Q".repeat(58) }],
      ["a bad bucket name", { ...ENV, BACKUP_S3_BUCKET: "Bad Bucket!" }],
      ["a bad profile name", { ...ENV, BACKUP_AWS_PROFILE: "x; rm -rf" }],
      ["a bad retention", { ...ENV, BACKUP_LOCAL_KEEP: "0" }],
    ])("rejects %s with a ConfigError that echoes no value", (_name, env) => {
      let message = "";
      try {
        loadBackupConfig(env, { localDir: "x" });
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        message = (err as Error).message;
      }
      expect(message).not.toBe("");
      expect(message).not.toContain(PASSWORD);
      expect(message).not.toContain("AGE-SECRET-KEY");
    });

    it("prefers BACKUP_DATABASE_URL over DATABASE_URL when both are set", () => {
      const other = loadBackupConfig({ ...ENV, BACKUP_DATABASE_URL: "postgres://satis_migrator:pw@localhost:5433/other" }, { localDir: "x" });
      expect(other.database).toMatchObject({ user: "satis_migrator", port: "5433", name: "other" });
    });

    it("strips IPv6 brackets from the host and keeps sslmode", () => {
      const c = loadBackupConfig({ ...ENV, DATABASE_URL: "postgres://u:p@[::1]:5433/db?sslmode=require" }, { localDir: "x" });
      expect(c.database).toMatchObject({ host: "::1", port: "5433", sslmode: "require" });
    });

    it("rejects a bad percent-escape and an unknown sslmode as ConfigError (no password in message)", () => {
      for (const u of ["postgres://u:p%zz@h/db", "postgres://u:p@h/db?sslmode=bogus"]) {
        expect(() => loadBackupConfig({ ...ENV, DATABASE_URL: u }, { localDir: "x" })).toThrow(ConfigError);
      }
    });

    it("refuses an AWS profile that starts with a dash (it could be read as an option)", () => {
      expect(() => loadBackupConfig({ ...ENV, BACKUP_AWS_PROFILE: "--endpoint-url" }, { localDir: "x" })).toThrow(ConfigError);
    });

    it("makes the local folder absolute, so a value starting with a dash is never read as an option", () => {
      const c = loadBackupConfig({ ...ENV, BACKUP_LOCAL_DIR: "-rf" }, { localDir: "x" });
      expect(isAbsolute(c.localDir)).toBe(true);
    });

    it("allows no bucket (a local trial run that never touches AWS)", () => {
      expect(loadBackupConfig(ENV, { localDir: "x" }).s3Bucket).toBe("");
    });

    it("has no S3 endpoint unless BACKUP_S3_ENDPOINT is set (plain AWS S3, as before)", () => {
      expect(loadBackupConfig(ENV, { localDir: "x" }).s3Endpoint).toBe("");
      expect(loadBackupConfig({ ...ENV, BACKUP_S3_ENDPOINT: "  " }, { localDir: "x" }).s3Endpoint).toBe("");
    });

    it("accepts an https endpoint and keeps only its origin", () => {
      const c = loadBackupConfig({ ...ENV, BACKUP_S3_ENDPOINT: " https://s3.example-region.example.com/ignored/path " }, { localDir: "x" });
      expect(c.s3Endpoint).toBe("https://s3.example-region.example.com");
    });

    it("refuses an endpoint that is not https, carries credentials, or could be read as an option", () => {
      for (const bad of ["http://s3.example.com", "--endpoint-url", "s3.example.com", "https://user:pw@s3.example.com", "https://", "ftp://s3.example.com"]) {
        expect(() => loadBackupConfig({ ...ENV, BACKUP_S3_ENDPOINT: bad }, { localDir: "x" }), bad).toThrow(ConfigError);
      }
    });

    it("never echoes the endpoint value in the refusal message", () => {
      expect(() => loadBackupConfig({ ...ENV, BACKUP_S3_ENDPOINT: "https://user:secret@s3.example.com" }, { localDir: "x" })).toThrow(/^(?!.*secret)/s);
    });
  });

  it("names files by UTC time", () => {
    expect(backupFileName(now())).toBe("satis-20260925T101530Z.dump.age");
  });

  it("runs dump, then encrypt, then upload, in that order, and returns the file name", async () => {
    const { run, calls } = fakeRunner();
    const result = await runBackup(config, deps(run));
    expect(calls.map((c) => c.command)).toEqual(["pg_dump", "age", "aws"]);
    expect(result).toEqual({ fileName: "satis-20260925T101530Z.dump.age", uploaded: true, prunedLocal: 0 });
    expect(existsSync(join(dir, result.fileName))).toBe(true);
  });

  it("encrypts to the PUBLIC recipient and uploads with the put-only profile under the satis-dash/ prefix", async () => {
    const { run, calls } = fakeRunner();
    await runBackup(config, deps(run));
    const age = calls.find((c) => c.command === "age")!;
    expect(age.args.slice(0, 2)).toEqual(["--recipient", RECIPIENT]);
    const aws = calls.find((c) => c.command === "aws")!;
    expect(aws.args).toContain(`s3://my-backups/${S3_KEY_PREFIX}satis-20260925T101530Z.dump.age`);
    expect(aws.args.slice(aws.args.indexOf("--profile"))).toEqual(["--profile", "satis-backup", "--only-show-errors"]);
    expect(aws.args).toContain("cp");
    // put-only: no list, sync, rm or delete verb is ever used
    expect(aws.args.join(" ")).not.toMatch(/\b(ls|sync|rm|mv|delete)\b/);
  });

  it("passes --endpoint-url to aws only when an endpoint is configured", async () => {
    const plain = fakeRunner();
    await runBackup({ ...config, s3Endpoint: "" }, deps(plain.run));
    expect(plain.calls.find((c) => c.command === "aws")!.args).not.toContain("--endpoint-url");
    const b2 = fakeRunner();
    await runBackup({ ...config, s3Endpoint: "https://s3.example-region.example.com" }, deps(b2.run));
    const args = b2.calls.find((c) => c.command === "aws")!.args;
    expect(args.slice(args.indexOf("--profile"))).toEqual(["--profile", "satis-backup", "--endpoint-url", "https://s3.example-region.example.com", "--only-show-errors"]);
    expect(args.join(" ")).not.toMatch(/\b(ls|sync|rm|mv|delete)\b/);
  });

  it("passes the password ONLY in PGPASSWORD: never on a command line, in a log line, or in a result", async () => {
    const { run, calls } = fakeRunner();
    const result = await runBackup(config, deps(run));
    const dump = calls.find((c) => c.command === "pg_dump")!;
    expect(dump.env).toEqual({ PGPASSWORD: PASSWORD });
    for (const call of calls) {
      expect(call.args.join(" ")).not.toContain(PASSWORD);
      expect(call.args.join(" ")).not.toContain(encodeURIComponent(PASSWORD));
    }
    expect(JSON.stringify({ result, logs })).not.toContain(PASSWORD);
    expect(dump.args).toContain("--format=custom");
    expect(dump.args).toContain("--no-owner");
    expect(dump.args).not.toContain("--no-acl"); // grants are kept so a restore works without re-granting
  });

  it("removes the plaintext dump after a successful run", async () => {
    const { run, plainPaths } = fakeRunner();
    await runBackup(config, deps(run));
    expect(plainPaths).toHaveLength(1);
    expect(existsSync(plainPaths[0]!)).toBe(false);
    expect(readdirSync(dir).every((name) => name.endsWith(".dump.age"))).toBe(true);
  });

  it("a failed dump throws, uploads nothing, leaves no encrypted file and no plaintext", async () => {
    const { run, calls, plainPaths } = fakeRunner({ pgDump: 1 });
    await expect(runBackup(config, deps(run))).rejects.toThrow(/pg_dump failed \(exit 1\)/);
    expect(calls.map((c) => c.command)).toEqual(["pg_dump"]);
    expect(readdirSync(dir)).toEqual([]);
    expect(existsSync(plainPaths[0]!)).toBe(false);
  });

  it("a failed encryption throws, uploads nothing, and leaves neither a plaintext nor a partial encrypted file", async () => {
    const { run, calls, plainPaths } = fakeRunner({ age: 1 });
    await expect(runBackup(config, deps(run))).rejects.toThrow(/age encryption failed/);
    expect(calls.map((c) => c.command)).toEqual(["pg_dump", "age"]);
    expect(existsSync(plainPaths[0]!)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("a failed upload throws (so the scheduled task shows a failure) but keeps the encrypted local copy", async () => {
    const { run } = fakeRunner({ aws: 1 });
    await expect(runBackup(config, deps(run))).rejects.toThrow(BackupError);
    expect(readdirSync(dir)).toEqual(["satis-20260925T101530Z.dump.age"]);
  });

  it("a missing program is a BackupError with an install hint, not a crash", async () => {
    const run: Runner = async () => ({ code: 127, stderr: "pg_dump could not be started (is it installed and on PATH?)" });
    await expect(runBackup(config, deps(run))).rejects.toThrow(/could not be started/);
  });

  it("without a bucket it does not call aws and says so", async () => {
    const { run, calls } = fakeRunner();
    const result = await runBackup({ ...config, s3Bucket: "" }, deps(run));
    expect(calls.map((c) => c.command)).toEqual(["pg_dump", "age"]);
    expect(result.uploaded).toBe(false);
    expect(logs.join("\n")).toContain("not uploaded");
  });

  describe("stale plaintext leftovers", () => {
    it("sweeps old satis-backup-* temp folders, and only those", async () => {
      const parent = await mkdtemp(join(tmpdir(), "sweep-test-"));
      try {
        const old = join(parent, "satis-backup-old");
        const fresh = join(parent, "satis-backup-fresh");
        const other = join(parent, "unrelated-old");
        for (const path of [old, fresh, other]) {
          await mkdir(path);
          await writeFile(join(path, "dump.plain"), "PLAINTEXT");
        }
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        await utimes(old, twoHoursAgo, twoHoursAgo);
        await utimes(other, twoHoursAgo, twoHoursAgo);
        const removed = await sweepStaleWorkDirs(Date.now(), parent);
        expect(removed).toBe(1);
        expect(existsSync(old)).toBe(false);
        expect(existsSync(fresh)).toBe(true);
        expect(existsSync(other)).toBe(true);
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    });
  });

  describe("local retention", () => {
    const names = (n: number) =>
      Array.from({ length: n }, (_, i) => `satis-202609${String(10 + i).padStart(2, "0")}T020000Z.dump.age`);

    it("keeps the newest N encrypted copies and deletes only older backup files", async () => {
      for (const name of names(5)) {
        await writeFile(join(dir, name), "x");
      }
      await writeFile(join(dir, "notes.txt"), "keep me");
      await writeFile(join(dir, "satis-x.dump.age"), "keep me too (not our pattern)");
      const removed = await pruneLocalCopies(dir, 2);
      expect(removed).toBe(3);
      expect(readdirSync(dir).sort()).toEqual([names(5)[3], names(5)[4], "notes.txt", "satis-x.dump.age"].sort());
    });

    it("a run prunes down to localKeep, counting the new file", async () => {
      for (const name of names(4)) {
        await writeFile(join(dir, name), "x");
      }
      const { run } = fakeRunner();
      const result = await runBackup({ ...config, localKeep: 3 }, deps(run));
      // 4 old + 1 new = 5 -> keep 3; the new one (dated 2026-09-25) is newest
      expect(result.prunedLocal).toBe(2);
      expect(readdirSync(dir)).toHaveLength(3);
      expect(readdirSync(dir)).toContain(result.fileName);
    });

    it("does not prune when the run failed before an encrypted copy existed", async () => {
      for (const name of names(5)) {
        await writeFile(join(dir, name), "x");
      }
      const { run } = fakeRunner({ pgDump: 1 });
      await expect(runBackup({ ...config, localKeep: 1 }, deps(run))).rejects.toThrow();
      expect(readdirSync(dir)).toHaveLength(5);
    });
  });
});
