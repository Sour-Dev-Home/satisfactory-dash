import { ConfigError } from "../errors.js";

/**
 * ADR-0025 decision 1: the backend reaches Postgres through DATABASE_URL only (TLS-capable via
 * sslmode in the URL, no Docker-only features). Unset or blank means "no database": the backend
 * runs exactly as before, which is what keeps the current deploy working until deploy A.
 */
export interface DatabaseConfig {
  /** Contains the password: never log it or put it in an error message. */
  url: string;
  poolMax: number;
  /** Server-side statement_timeout, so a stuck query can't hold a pool slot forever. */
  statementTimeoutMs: number;
  connectionTimeoutMs: number;
  /** How long the readiness probe (acquire a connection + SELECT 1) may take. Optional so a test
   *  config can leave it out; loadDatabaseConfig always sets it. */
  readinessTimeoutMs?: number;
  /** How long an idle connection above the minimum lives before it is closed. A test knob (so the
   *  pool test doesn't wait 30 s); production uses the default. */
  idleTimeoutMs?: number;
}

/** PostgreSQL's default port, used when DATABASE_URL names none. */
export const DEFAULT_DATABASE_PORT = 5432;

/**
 * The TCP port DATABASE_URL points at (5432 when it names none), or undefined when the URL cannot be read. Used to keep a
 * game-server connection from targeting the database (issue #195). It never throws and never puts any part of the URL (which
 * holds the password) in an error or a log.
 */
export function databasePortOf(url: string | undefined): number | undefined {
  if (url === undefined) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.port === "") return DEFAULT_DATABASE_PORT;
    const port = Number(parsed.port);
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined;
  } catch {
    return undefined;
  }
}

const DEFAULT_POOL_MAX = 10;
/** The readiness probe's budget (ADR-0025 decision 6). Was 1 s; two probes missed it on the busy game PC
 *  when a fresh connection had to be opened, so it is 3 s, and configurable. */
export const DEFAULT_READINESS_TIMEOUT_MS = 3_000;
const MAX_POOL_MAX = 100;
const DEFAULT_STATEMENT_TIMEOUT_MS = 10_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;

function wholeNumber(name: string, raw: string | undefined, min: number, max: number, fallback: number): number {
  const text = raw?.trim();
  if (!text) {
    return fallback;
  }
  const value = /^\d{1,9}$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be a whole number from ${min} to ${max} (or unset for ${fallback}).`);
  }
  return value;
}

/** A malformed URL is a ConfigError that never echoes the URL (it carries the password). */
export function loadDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig | undefined {
  const url = env.DATABASE_URL?.trim();
  if (!url) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConfigError("DATABASE_URL is not a valid URL (expected postgres://user:password@host:5432/database).");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new ConfigError("DATABASE_URL must start with postgres:// or postgresql://.");
  }
  if (!parsed.hostname && !parsed.searchParams.has("host")) {
    throw new ConfigError("DATABASE_URL has no host.");
  }
  if (parsed.pathname.length <= 1) {
    throw new ConfigError("DATABASE_URL has no database name.");
  }
  return {
    url,
    poolMax: wholeNumber("DATABASE_POOL_MAX", env.DATABASE_POOL_MAX, 1, MAX_POOL_MAX, DEFAULT_POOL_MAX),
    statementTimeoutMs: wholeNumber(
      "DATABASE_STATEMENT_TIMEOUT_MS",
      env.DATABASE_STATEMENT_TIMEOUT_MS,
      100,
      120_000,
      DEFAULT_STATEMENT_TIMEOUT_MS,
    ),
    connectionTimeoutMs: DEFAULT_CONNECTION_TIMEOUT_MS,
    readinessTimeoutMs: wholeNumber(
      "DATABASE_READINESS_TIMEOUT_MS",
      env.DATABASE_READINESS_TIMEOUT_MS,
      100,
      10_000,
      DEFAULT_READINESS_TIMEOUT_MS,
    ),
  };
}
