/**
 * Connection config for a single Satisfactory dedicated server. Read from env vars so
 * "one server now, many via AWS later" (root CLAUDE.md) is a config change, not a
 * rewrite — this is the one place that assembles env into a typed shape.
 */
export interface SatisfactoryServerConfig {
  host: string;
  /** Vanilla Dedicated Server HTTPS API port. Always TLS, self-signed by default
   *  (docs-vault/raw-sources/dedicated-server-api.md, "Certificate Validation and
   *  Encryption"). */
  apiPort: number;
  /** Bearer token for admin-privileged vanilla API functions. Not required for the
   *  read-only functions this adapter currently calls (HealthCheck, QueryServerState). */
  apiToken?: string;
  /** Accept the vanilla API's self-signed cert. Only safe for a trusted/local network
   *  path; revisit once a real cert chain is configured for a non-local deployment. */
  apiAllowSelfSignedCert: boolean;
  /** FicsitRemoteMonitoring Web Server port (default 8080 per
   *  docs-vault/raw-sources/frm-config.md). Confirmed live in the Phase 2 spike — see
   *  docs-vault/wiki/frm-api.md — that FRM's documented tunneled-transport fallback
   *  through apiPort does not work on this game/FRM version, so the adapter talks to
   *  this port directly. */
  frmPort: number;
  /** Sent as the `X-FRM-Authorization` header per
   *  docs-vault/raw-sources/frm-authentication.md. [NEEDS VERIFICATION] — not
   *  live-tested against an instance that actually enforces the token; the Phase 2
   *  spike's server accepted requests with no token at all. */
  frmToken?: string;
  requestTimeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

export function loadSatisfactoryServerConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SatisfactoryServerConfig {
  return {
    host: env.SATISFACTORY_SERVER_HOST ?? "localhost",
    apiPort: Number(env.SATISFACTORY_API_PORT ?? 7777),
    apiToken: env.SATISFACTORY_API_TOKEN,
    apiAllowSelfSignedCert: env.SATISFACTORY_API_REJECT_UNAUTHORIZED !== "true",
    frmPort: Number(env.FRM_WEB_PORT ?? 8080),
    frmToken: env.FRM_AUTH_TOKEN,
    requestTimeoutMs: Number(env.SATISFACTORY_REQUEST_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
  };
}
