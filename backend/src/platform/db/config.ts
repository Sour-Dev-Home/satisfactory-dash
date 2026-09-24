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
}

const DEFAULT_POOL_MAX = 10;
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
  };
}
