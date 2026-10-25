import { chmodSync, closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs";
import path from "node:path";
import { createDpapi, type Spawner } from "./dpapi.js";

/**
 * The agent's platform-neutral secret store (ADR-0057 Decision 2): `AgentStore` keeps each secret as an opaque base64
 * "blob" in its state file and hands it to a `SecretBox` to protect and unprotect.
 *  - Windows: DPAPI (`createDpapi`), the blob is encrypted for the current Windows user.
 *  - Elsewhere: `fileSecretBox`, the blob is only base64 of the secret. The protection is the file system: the state
 *    directory is 0700, `store.json` is 0600, and the agent REFUSES to read it when it is looser or a symlink (like an SSH
 *    key), so a stray `chmod 644` or a planted link cannot quietly expose or redirect the secrets.
 */
export interface SecretBox {
  /** Returns the opaque base64 blob to store for this secret. */
  protect(plaintext: string): Promise<string>;
  /** Returns the secret a blob stands for. Throws when the box cannot (wrong user, loose file, bad blob). */
  unprotect(blob: string): Promise<string>;
}

export type SecretStoreKind = "dpapi" | "file";

export type FileSecretBoxErrorKind = "unsafe_file" | "bad_config" | "protect_failed" | "unprotect_failed";

/** Thrown by the file box. The message carries a path and a fix, never a secret. */
export class FileSecretBoxError extends Error {
  constructor(
    readonly kind: FileSecretBoxErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "FileSecretBoxError";
  }
}

export const STORE_FILE_NAME = "store.json";

/** True where POSIX modes and symlinks mean what they say (not on Windows, which uses DPAPI). */
export const hasPosixModes = process.platform !== "win32";

/**
 * Atomic write of a private file: a new temporary file (exclusive create, 0600, so a planted link or an old file is never
 * written through), contents flushed to disk, then renamed over the target. A failure removes the temporary file; the old
 * target is untouched.
 */
export function writeFileAtomic(file: string, contents: string): void {
  const temporary = `${file}.${process.pid}.tmp`;
  let fd: number | undefined;
  try {
    try {
      unlinkSync(temporary); // a leftover from a crashed run of this same process id
    } catch {
      // nothing to remove
    }
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    writeSync(fd, contents, undefined, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, file);
  } catch (err) {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // already closed
      }
    }
    try {
      unlinkSync(temporary);
    } catch {
      // nothing to remove
    }
    throw err;
  }
}

/** Creates the state directory 0700 (or tightens one this user owns to 0700, e.g. systemd's default 0755). */
export function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!hasPosixModes) return;
  const info = lstatSync(dir);
  if (info.isSymbolicLink()) {
    throw new FileSecretBoxError("unsafe_file", `The agent's state directory (${dir}) is a symbolic link; refusing to use it. Point the agent at the real directory.`);
  }
  if ((info.mode & 0o077) !== 0) chmodSync(dir, 0o700);
}

/**
 * Refuses a store file that is a symlink or has any group/other permission. Opens with O_NOFOLLOW and checks the OPEN
 * descriptor, so the file that was checked is the file that is meant (no swap between the check and a later read).
 * A missing file is fine (nothing stored yet).
 */
export function assertPrivateFile(file: string): void {
  if (!hasPosixModes) return;
  let fd: number;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    if (code === "ELOOP") {
      throw new FileSecretBoxError("unsafe_file", `The agent's secret store (${file}) is a symbolic link; refusing to use it. Replace it with the real file (or delete it and set the agent up again).`);
    }
    throw new FileSecretBoxError("unsafe_file", `The agent's secret store (${file}) could not be opened safely (${code ?? "error"}). Check its owner and permissions.`);
  }
  try {
    const info = fstatSync(fd);
    if (!info.isFile()) throw new FileSecretBoxError("unsafe_file", `The agent's secret store (${file}) is not a regular file; refusing to use it.`);
    if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
      throw new FileSecretBoxError("unsafe_file", `The agent's secret store (${file}) belongs to another user; refusing to use it. Run the agent as the user that set it up.`);
    }
    if ((info.mode & 0o177) !== 0) {
      const mode = (info.mode & 0o777).toString(8).padStart(3, "0");
      throw new FileSecretBoxError("unsafe_file", `The agent's secret store (${file}) has permissions ${mode}, which let other users read it. Refusing to start. Fix it with: chmod 600 ${file}`);
    }
  } finally {
    closeSync(fd);
  }
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** The secret store for POSIX systems: see `SecretBox`. `dir` is the agent's state directory. */
export function fileSecretBox(dir: string): SecretBox {
  const file = path.join(dir, STORE_FILE_NAME);
  const guard = () => {
    ensurePrivateDir(dir);
    assertPrivateFile(file);
  };
  return {
    async protect(plaintext) {
      guard();
      if (plaintext === "") throw new FileSecretBoxError("protect_failed", "An empty secret is not stored.");
      return Buffer.from(plaintext, "utf8").toString("base64");
    },
    async unprotect(blob) {
      guard();
      if (!BASE64.test(blob)) throw new FileSecretBoxError("unprotect_failed", "The agent's store holds a secret that is not in the expected form; set it up again.");
      return Buffer.from(blob, "base64").toString("utf8");
    },
  };
}

/** `SD_AGENT_SECRET_STORE` (dpapi | file), else by platform. Anything else is a startup error. */
export function resolveSecretStoreKind(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): SecretStoreKind {
  const raw = env.SD_AGENT_SECRET_STORE;
  if (raw === undefined || raw === "") return platform === "win32" ? "dpapi" : "file";
  if (raw === "dpapi" || raw === "file") return raw;
  throw new FileSecretBoxError("bad_config", "SD_AGENT_SECRET_STORE must be 'dpapi' or 'file' (or unset to choose by platform).");
}

export function createSecretBox(options: { dir: string; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; spawner?: Spawner }): SecretBox {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const kind = resolveSecretStoreKind(env, platform);
  return kind === "dpapi" ? createDpapi({ platform, env, ...(options.spawner ? { spawner: options.spawner } : {}) }) : fileSecretBox(options.dir);
}
