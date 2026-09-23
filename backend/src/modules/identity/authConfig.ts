import { ConfigError } from "../../platform/errors.js";
import { assertScryptParamsUsable, parsePasswordHash } from "./passwordHash.js";
import type { ParsedPasswordHash } from "./passwordHash.js";

export interface AuthConfig {
  adminUser: string;
  passwordHash: ParsedPasswordHash;
  sessionSecret: string;
  /** Exact origins allowed to call the API with credentials (CORS). */
  allowedOrigins: string[];
}

const MIN_SECRET_LENGTH = 32;
/** ADR-0013: the frontend's production origin. */
const DEFAULT_ALLOWED_ORIGINS = ["https://satis-manager.com"];

function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    const isOriginOnly = url.origin === origin;
    const secure = url.protocol === "https:";
    const localDev = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    return isOriginOnly && (secure || localDev);
  } catch {
    return false;
  }
}

/**
 * ADR-0011: the login settings are validated at startup, and the backend refuses to
 * start if any is missing or malformed. There is no "auth off" mode. Error messages
 * name the variable but never echo a secret's value.
 */
export function loadAuthConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const adminUser = env.DASHBOARD_ADMIN_USER?.trim() ?? "";
  if (adminUser.length === 0 || adminUser.length > 128) {
    throw new ConfigError("DASHBOARD_ADMIN_USER must be set (1-128 characters).");
  }
  const passwordHash = parsePasswordHash(env.DASHBOARD_ADMIN_PASSWORD_HASH ?? "");
  if (!passwordHash) {
    throw new ConfigError(
      "DASHBOARD_ADMIN_PASSWORD_HASH must be set to a scrypt hash. Generate one with `npm run hash-password -w backend`.",
    );
  }
  try {
    assertScryptParamsUsable(passwordHash);
  } catch {
    throw new ConfigError(
      "DASHBOARD_ADMIN_PASSWORD_HASH has scrypt parameters this system can't use. Regenerate it with `npm run hash-password -w backend`.",
    );
  }
  const sessionSecret = env.SESSION_SECRET ?? "";
  if (sessionSecret.length < MIN_SECRET_LENGTH) {
    throw new ConfigError(
      `SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters of random data (e.g. \`openssl rand -base64 48\`).`,
    );
  }
  const allowedOrigins = env.CORS_ALLOWED_ORIGINS?.trim()
    ? env.CORS_ALLOWED_ORIGINS.split(",").map((origin) => origin.trim())
    : DEFAULT_ALLOWED_ORIGINS;
  const invalid = allowedOrigins.filter((origin) => !isAllowedOrigin(origin));
  if (invalid.length > 0) {
    throw new ConfigError(
      `CORS_ALLOWED_ORIGINS has invalid entries (${invalid.join(", ")}): use exact https origins, or http://localhost for local development. Never "*".`,
    );
  }
  return { adminUser, passwordHash, sessionSecret, allowedOrigins };
}
