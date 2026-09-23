import { isIP } from "node:net";

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
  /** Accept the vanilla API's self-signed cert (the game server's default). Off unless
   *  the host is loopback/private or the operator explicitly opts out; see
   *  `allowSelfSignedCert` below. */
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

/** A configuration the backend refuses to start with. server.ts reports it and exits. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function isPrivateIPv4(address: string): boolean {
  const [a, b] = address.split(".").map(Number);
  return (
    a === 127 || // loopback
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) // link-local
  );
}

/** True for loopback and private-network hosts, where a self-signed game-server cert
 *  is expected and the path never leaves the local network. A hostname other than
 *  `localhost` can't be classified without DNS, so it counts as not private. */
export function isLoopbackOrPrivateHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) {
    return true;
  }
  switch (isIP(h)) {
    case 4:
      return isPrivateIPv4(h);
    case 6: {
      const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
      if (mapped) {
        return isPrivateIPv4(mapped[1]);
      }
      // loopback, unique-local fc00::/7, link-local fe80::/10
      return h === "::1" || /^f[cd]/.test(h) || /^fe[89ab]/.test(h);
    }
    default:
      return false;
  }
}

/**
 * Security finding #2 (fixed in PR 3): certificate verification used to be OFF unless
 * SATISFACTORY_API_REJECT_UNAUTHORIZED was exactly "true", for any host. Now it is ON
 * by default and relaxed only for loopback/private hosts (ADR-0013 runs the backend on
 * the game-server PC and talks to it over loopback). An explicit "true" or "false"
 * always wins; any other value, including a typo, falls back to the host-based default
 * rather than silently disabling verification.
 */
export function allowSelfSignedCert(env: NodeJS.ProcessEnv, host: string): boolean {
  const setting = env.SATISFACTORY_API_REJECT_UNAUTHORIZED?.trim().toLowerCase();
  if (setting === "true") {
    return false;
  }
  if (setting === "false") {
    return true;
  }
  return isLoopbackOrPrivateHost(host);
}

export function loadSatisfactoryServerConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SatisfactoryServerConfig {
  // `||`, not `??`: a variable set to "" (.env.example ships several) means unset.
  // The host is trimmed once so the TLS decision and the connection see the same
  // value (found by PR #17's fresh-eyes review).
  const host = env.SATISFACTORY_SERVER_HOST?.trim() || "localhost";
  // FRM's web server is plain HTTP with no TLS option (frmApiClient.ts builds http://
  // URLs; docs-vault/raw-sources/frm-config.md has no TLS setting), so its auth token
  // and data may only travel on a loopback/private path. No opt-out: ADR-0013 runs the
  // backend on the game-server machine, and FRM is never exposed directly. The host is
  // shared with the vanilla API, so this also rules out a public vanilla host.
  if (!isLoopbackOrPrivateHost(host)) {
    throw new ConfigError(
      `SATISFACTORY_SERVER_HOST "${host}" is not a loopback or private address. The FRM web server ` +
        "speaks plain HTTP only, so its auth token and data must not cross a public network. Run " +
        "the backend on the game-server machine or its private network, and use an IP address " +
        "(a hostname other than localhost can't be verified as private).",
    );
  }
  return {
    host,
    apiPort: Number(env.SATISFACTORY_API_PORT || 7777),
    apiToken: env.SATISFACTORY_API_TOKEN,
    apiAllowSelfSignedCert: allowSelfSignedCert(env, host),
    frmPort: Number(env.FRM_WEB_PORT || 8080),
    frmToken: env.FRM_AUTH_TOKEN,
    requestTimeoutMs: Number(env.SATISFACTORY_REQUEST_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  };
}

/** ADR-0001: server ids are opaque, lowercase and URL-safe, never a host or port. Kept
 *  in step with packages/shared's ServerIdSchema (config.test.ts asserts they agree);
 *  adapters don't import the public contract. */
export const SERVER_ID_PATTERN = /^[a-z0-9-]{1,32}$/;

export interface ServerRegistryEntry {
  id: string;
  /** Shown to users by GET /api/servers. Never a host or port. */
  displayName: string;
  config: SatisfactoryServerConfig;
}

/**
 * ADR-0001: single-server mode is a registry of one. SATISFACTORY_SERVER_ID (default
 * "default") and SATISFACTORY_SERVER_NAME name it; every data route is scoped to that
 * id, so adding a second server later is a registry change, not a URL change.
 */
export function loadServerRegistryFromEnv(env: NodeJS.ProcessEnv = process.env): ServerRegistryEntry[] {
  const id = env.SATISFACTORY_SERVER_ID?.trim() || "default";
  if (!SERVER_ID_PATTERN.test(id)) {
    throw new ConfigError(
      `SATISFACTORY_SERVER_ID "${id}" is invalid: use 1-32 characters of lowercase letters, digits and dashes.`,
    );
  }
  return [
    {
      id,
      displayName: env.SATISFACTORY_SERVER_NAME?.trim() || "Satisfactory server",
      config: loadSatisfactoryServerConfigFromEnv(env),
    },
  ];
}
