import { ConfigError } from "../../platform/errors.js";

export interface AuthConfig {
  /** The operator account's display name (ensureLocalUser). Nobody signs in with it (ADR-0025 PR 9). */
  adminUser: string;
  /** Exact origins allowed to call the API with credentials (CORS). */
  allowedOrigins: string[];
}

/** The operator's display name when DASHBOARD_ADMIN_USER is unset. */
const DEFAULT_ADMIN_USER = "operator";
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
 * The identity settings, validated at startup: the backend refuses to start if one is malformed.
 * Google is the only way in since ADR-0025 PR 9, so DASHBOARD_ADMIN_PASSWORD_HASH and SESSION_SECRET
 * are no longer read (set or not, they are ignored).
 */
export function loadAuthConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  // Unset or blank (e.g. an empty compose interpolation) means the default.
  const adminUser = env.DASHBOARD_ADMIN_USER?.trim() || DEFAULT_ADMIN_USER;
  if (adminUser.length > 128) {
    throw new ConfigError("DASHBOARD_ADMIN_USER, when set, must be 1-128 characters (the operator's display name).");
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
  return { adminUser, allowedOrigins };
}
