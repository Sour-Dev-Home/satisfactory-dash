import { ConfigError } from "../../platform/errors.js";

/** ADR-0013: the frontend's production origin, where a finished sign-in sends the browser back. */
const DEFAULT_FRONTEND_ORIGIN = "https://satis-manager.com";

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  /** The exact callback URL registered with Google; also where the code exchange is anchored. */
  redirectUri: string;
  /** Lowercased. The one Google account allowed to claim the seeded operator (ADR-0025 decision 5). */
  bootstrapOwnerEmail: string;
  /** The frontend's origin (one of CORS_ALLOWED_ORIGINS): every redirect after sign-in starts here. */
  frontendOrigin: string;
}

const GOOGLE_VARIABLES = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "BOOTSTRAP_OWNER_EMAIL"] as const;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * ADR-0025 decisions 3 and 5. All-or-nothing: none of the four Google settings set means Google
 * sign-in is off (undefined); some but not all is a startup error, so a half-configured deploy
 * fails loudly instead of quietly running without it. Messages name variables, never values.
 */
export function loadGoogleConfigFromEnv(env: NodeJS.ProcessEnv, allowedOrigins: string[]): GoogleConfig | undefined {
  const value = (name: string) => env[name]?.trim() ?? "";
  const missing = GOOGLE_VARIABLES.filter((name) => value(name) === "");
  if (missing.length === GOOGLE_VARIABLES.length) {
    return undefined;
  }
  if (missing.length > 0) {
    throw new ConfigError(
      `Google sign-in is half configured: ${missing.join(", ")} must also be set (or unset all of ${GOOGLE_VARIABLES.join(", ")}).`,
    );
  }
  let redirect: URL;
  try {
    redirect = new URL(value("GOOGLE_REDIRECT_URI"));
  } catch {
    throw new ConfigError("GOOGLE_REDIRECT_URI must be an absolute URL.");
  }
  const secureOrLocal =
    redirect.protocol === "https:" ||
    (redirect.protocol === "http:" && (redirect.hostname === "localhost" || redirect.hostname === "127.0.0.1"));
  if (!secureOrLocal || redirect.search !== "" || redirect.hash !== "") {
    throw new ConfigError("GOOGLE_REDIRECT_URI must be an https URL (http only for localhost) with no query or fragment.");
  }
  const bootstrapOwnerEmail = value("BOOTSTRAP_OWNER_EMAIL").toLowerCase();
  if (!EMAIL_SHAPE.test(bootstrapOwnerEmail) || bootstrapOwnerEmail.length > 320) {
    throw new ConfigError("BOOTSTRAP_OWNER_EMAIL must be an email address.");
  }
  const frontendOrigin = value("FRONTEND_ORIGIN") || DEFAULT_FRONTEND_ORIGIN;
  if (!allowedOrigins.includes(frontendOrigin)) {
    throw new ConfigError("FRONTEND_ORIGIN must be one of CORS_ALLOWED_ORIGINS (exact match).");
  }
  return {
    clientId: value("GOOGLE_CLIENT_ID"),
    clientSecret: value("GOOGLE_CLIENT_SECRET"),
    redirectUri: redirect.toString(),
    bootstrapOwnerEmail,
    frontendOrigin,
  };
}
