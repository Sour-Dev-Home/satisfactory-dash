import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";

/**
 * The agent's log (ADR-0031 PR 6, architect rule 5): JSON lines in a file per UTC day, the last 7 days kept, and NEVER the
 * agent's secret, the game's tokens, snapshot bodies or player names. That is enforced here, not left to every caller:
 *  - an event name is a short identifier; a field NAME is a short identifier; a field VALUE is a finite number, a boolean, or
 *    a short plain code (`upstream_unreachable`, `0.1.0`); anything else (an object, a long or free-form string, a name with a
 *    space) is replaced by "[redacted]", never written;
 *  - every secret the process knows is registered with `addSecret`, and any occurrence of one in a line is replaced before it
 *    is written, as a second guard;
 *  - a day's file stops growing at a size cap, so a loop that goes wrong cannot fill the disk.
 */

export type LogLevel = "info" | "warn" | "error";
export type LogFieldValue = number | boolean | string | null | undefined;
export type LogFields = Record<string, LogFieldValue>;

export interface AgentLogger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** Registers a secret whose text must never reach a line. */
  addSecret(secret: string): void;
}

export const LOG_KEEP_DAYS = 7;
export const LOG_MAX_BYTES_PER_DAY = 5 * 1024 * 1024;

const EVENT_PATTERN = /^[a-z][a-z0-9_.]{0,63}$/;
const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,40}$/;
const FILE_PATTERN = /^agent-(\d{4}-\d{2}-\d{2})\.log$/;
const MIN_SECRET_LENGTH = 6;

export interface FileLoggerOptions {
  dir: string;
  keepDays?: number;
  maxBytesPerDay?: number;
  now?: () => number;
  /** Also called with every line written (the foreground `run` prints to the console). */
  echo?: (line: string) => void;
}

const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The value as it may be written: numbers and booleans as they are, a plain code as it is, everything else "[redacted]". */
function safeValue(value: LogFieldValue): number | boolean | string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return typeof value === "string" && CODE_PATTERN.test(value) ? value : "[redacted]";
}

export function createFileLogger(options: FileLoggerOptions): AgentLogger {
  const keepDays = options.keepDays ?? LOG_KEEP_DAYS;
  const maxBytes = options.maxBytesPerDay ?? LOG_MAX_BYTES_PER_DAY;
  const now = options.now ?? Date.now;
  const secrets = new Set<string>();
  let currentDay: string | undefined;
  let capNoted = false;

  const scrub = (line: string): string => {
    let out = line;
    for (const secret of secrets) out = out.split(secret).join("[redacted]");
    return out;
  };

  /** Deletes the day files older than `keepDays` days (today counts as day one). Never throws: logging must not stop the agent. */
  const rotate = (today: string): void => {
    try {
      const cutoff = dayOf(Date.parse(`${today}T00:00:00Z`) - (keepDays - 1) * 86_400_000);
      for (const name of readdirSync(options.dir)) {
        const match = FILE_PATTERN.exec(name);
        if (match !== null && match[1]! < cutoff) unlinkSync(path.join(options.dir, name));
      }
    } catch {
      // A file that cannot be deleted is left for the next day's pass.
    }
  };

  const write = (level: LogLevel, event: string, fields: LogFields = {}): void => {
    const at = now();
    const day = dayOf(at);
    const record: Record<string, number | boolean | string | null> = { t: new Date(at).toISOString(), level, event: EVENT_PATTERN.test(event) ? event : "invalid_event" };
    for (const [key, value] of Object.entries(fields)) {
      if (!KEY_PATTERN.test(key) || key === "t" || key === "level" || key === "event") continue;
      record[key] = safeValue(value);
    }
    const line = scrub(JSON.stringify(record));
    options.echo?.(line);
    try {
      mkdirSync(options.dir, { recursive: true });
      if (day !== currentDay) {
        currentDay = day;
        capNoted = false;
        rotate(day);
      }
      const file = path.join(options.dir, `agent-${day}.log`);
      const size = existsSync(file) ? statSync(file).size : 0;
      if (size + line.length + 1 > maxBytes) {
        if (!capNoted) {
          capNoted = true;
          appendFileSync(file, `${JSON.stringify({ t: record.t, level: "warn", event: "log_size_cap" })}\n`);
        }
        return;
      }
      appendFileSync(file, `${line}\n`, "utf8");
    } catch {
      // A log that cannot be written (disk full, folder gone) must never take the agent down.
    }
  };

  return {
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
    addSecret(secret) {
      if (secret.length >= MIN_SECRET_LENGTH) secrets.add(secret);
    },
  };
}

/** A logger that writes nothing, for tests and for code that has none. */
export const silentLogger: AgentLogger = { info() {}, warn() {}, error() {}, addSecret() {} };
