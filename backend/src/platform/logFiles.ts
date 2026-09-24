import {
  accessSync,
  closeSync,
  constants,
  mkdirSync,
  openSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";
import { ConfigError } from "./errors.js";

/**
 * Log files with a hard retention limit (privacy policy: logs are kept 14 days). When LOG_DIR is
 * set the backend writes its JSON logs to one file per UTC day, `backend-YYYY-MM-DD.log`, and
 * deletes files older than the retention window. Without LOG_DIR nothing here is used and logs
 * go to stdout as before (dev, CI, containers).
 *
 * Why not a pino transport such as pino-roll: transports run in a worker thread that cannot be
 * bundled by esbuild into the single `dist/server.cjs`, and an asynchronous stream can lose the
 * fatal line written just before `process.exit(1)`. This stream is synchronous, dependency-free
 * and takes an injected clock, so the retention rule is tested exactly.
 */
export const LOG_RETENTION_DAYS = 14;
const FUTURE_SLACK_DAYS = 2;
const FILE_PREFIX = "backend-";
const FILE_PATTERN = /^backend-(\d{4})-(\d{2})-(\d{2})\.log$/;

/** The absolute log directory from LOG_DIR, created if missing and checked for write access, or
 *  undefined when LOG_DIR is unset or blank. Throws a ConfigError (the backend refuses to start)
 *  when it cannot be used; the message never echoes the path. */
export function resolveLogDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const configured = env.LOG_DIR?.trim();
  if (!configured) {
    return undefined;
  }
  const dir = path.resolve(configured);
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    // accessSync does not reflect every Windows ACL, so prove it by really creating a file.
    const probe = path.join(dir, `.write-test-${process.pid}`);
    writeFileSync(probe, "");
    unlinkSync(probe);
  } catch {
    throw new ConfigError("LOG_DIR must be a directory the backend can create and write to.");
  }
  return dir;
}

const utcDate = (at: Date) => at.toISOString().slice(0, 10);

/** The UTC date of a log file's name, or null for any other file (never touched). */
function fileDate(name: string): string | null {
  const match = FILE_PATTERN.exec(name);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/**
 * Deletes our own log files that fall outside the retention window: with a window of N days, the
 * files for today and the N-1 days before it are kept. Only regular files named exactly
 * `backend-YYYY-MM-DD.log` are considered, so nothing else in the directory can be deleted.
 * Returns the number removed. Never throws (a locked or vanished file is skipped).
 */
export function purgeOldLogFiles(dir: string, now: Date, retentionDays = LOG_RETENTION_DAYS): number {
  // At least one day, so a bad value can never delete today's file.
  const days = Math.max(1, Math.trunc(retentionDays) || 1);
  const oldestKept = utcDate(new Date(now.getTime() - (days - 1) * 86_400_000));
  // A file dated well in the future (the clock was wrong, then corrected) would otherwise outlive
  // the window by however far ahead it is. Two days of slack keeps a brief clock step harmless.
  const newestKept = utcDate(new Date(now.getTime() + FUTURE_SLACK_DAYS * 86_400_000));
  let removed = 0;
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const date = entry.isFile() ? fileDate(entry.name) : null;
    if (date !== null && (date < oldestKept || date > newestKept)) {
      try {
        unlinkSync(path.join(dir, entry.name));
        removed++;
      } catch {
        // Skip a file we cannot delete now; the next rotation tries again.
      }
    }
  }
  return removed;
}

export interface DailyLogStreamOptions {
  dir: string;
  /** Injected for tests. */
  now?: () => Date;
  retentionDays?: number;
  /** Where a line goes if the file cannot be written (disk full, permissions). */
  onFailure?: (line: string) => void;
}

/**
 * A pino destination (anything with `write(line)`) that appends to the current UTC day's file,
 * opening the next day's file when the date changes, and enforces the retention window at start
 * and at every rotation. Synchronous by design (see the file comment).
 */
export class DailyLogStream {
  private fd: number | null = null;
  private currentDate = "";
  private readonly now: () => Date;
  private readonly retentionDays: number;
  private readonly onFailure: (line: string) => void;

  constructor(private readonly options: DailyLogStreamOptions) {
    this.now = options.now ?? (() => new Date());
    this.retentionDays = options.retentionDays ?? LOG_RETENTION_DAYS;
    this.onFailure = options.onFailure ?? ((line) => void process.stderr.write(line));
    purgeOldLogFiles(options.dir, this.now(), this.retentionDays);
  }

  write(line: string): void {
    try {
      const at = this.now();
      const today = utcDate(at);
      if (this.fd === null || today !== this.currentDate) {
        this.rotate(at, today);
      }
      // writeSync may write fewer bytes than asked (a full disk): keep going until the whole
      // line is out, or let the failure handler have it.
      const bytes = Buffer.from(line);
      let written = 0;
      while (written < bytes.length) {
        const n = writeSync(this.fd as number, bytes, written);
        if (n <= 0) {
          throw new Error("short write");
        }
        written += n;
      }
    } catch {
      // A logging failure must never take the backend down or lose the line silently.
      this.closeQuietly();
      try {
        this.onFailure(line);
      } catch {
        // The fallback sink failed too (e.g. a closed stderr): nothing left to do, never throw.
      }
    }
  }

  private rotate(at: Date, today: string): void {
    this.closeQuietly();
    this.fd = openSync(path.join(this.options.dir, `${FILE_PREFIX}${today}.log`), "a");
    this.currentDate = today;
    purgeOldLogFiles(this.options.dir, at, this.retentionDays);
  }

  private closeQuietly(): void {
    if (this.fd !== null) {
      try {
        closeSync(this.fd);
      } catch {
        // Already closed or invalid: nothing to do.
      }
      this.fd = null;
    }
  }

  close(): void {
    this.closeQuietly();
  }
}
