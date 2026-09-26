import { isIP } from "node:net";
import { DEFAULT_REQUEST_TIMEOUT_MS } from "@satisfactory-dash/game-adapter";
import type { SatisfactoryServerConfig } from "@satisfactory-dash/game-adapter";
import { ConfigError } from "../../platform/errors.js";

/**
 * Assembles a `SatisfactoryServerConfig` (the type lives in the game-adapter package) from environment variables, so
 * "one server now, many via AWS later" (root CLAUDE.md) is a config change, not a rewrite. Reading the environment
 * is the backend's job: the adapter package never does it.
 */

const DEFAULT_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS;
/** Bounds for SATISFACTORY_REQUEST_TIMEOUT_MS. Below 1 s a healthy game server can miss its
 *  own deadline; above 60 s a dead one would freeze every request for a minute (ADR-0022). */
export const MIN_REQUEST_TIMEOUT_MS = 1000;
export const MAX_REQUEST_TIMEOUT_MS = 60_000;

/**
 * An environment variable that must be a plain whole number in a range. Unset or empty means
 * the default. Anything else (words, 0, negatives, decimals, "1e3", hex, units, a huge value)
 * is a ConfigError, so the backend refuses to start (fail fast) instead of running with NaN.
 * The message names the variable and the range and never echoes the offending value.
 */
function parseIntegerEnv(
  name: string,
  raw: string | undefined,
  { min, max, defaultValue, unit }: { min: number; max: number; defaultValue: number; unit?: string },
): number {
  const text = raw?.trim();
  if (!text) {
    return defaultValue;
  }
  const value = /^\d{1,9}$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(
      `${name} must be a whole number${unit ? ` ${unit}` : ""} from ${min} to ${max} (or unset for ${defaultValue}).`,
    );
  }
  return value;
}

/**
 * SATISFACTORY_REQUEST_TIMEOUT_MS as a whole number of milliseconds in range. A bad value
 * used to become NaN, and AbortSignal.timeout(NaN) throws, which made every FRM call fail as
 * "unreachable" while the backend looked healthy.
 */
export function parseRequestTimeoutMs(raw: string | undefined): number {
  return parseIntegerEnv("SATISFACTORY_REQUEST_TIMEOUT_MS", raw, {
    min: MIN_REQUEST_TIMEOUT_MS,
    max: MAX_REQUEST_TIMEOUT_MS,
    defaultValue: DEFAULT_TIMEOUT_MS,
    unit: "of milliseconds",
  });
}

const DEFAULT_API_PORT = 7777;
const DEFAULT_FRM_PORT = 8080;

/** A TCP port from an environment variable: a whole number from 1 to 65535, or the default
 *  when unset or empty. A non-numeric port used to become NaN and fail every request. */
export function parsePortEnv(name: string, raw: string | undefined, defaultValue: number): number {
  return parseIntegerEnv(name, raw, { min: 1, max: 65535, defaultValue });
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

/** True only for loopback: `localhost`, 127.0.0.0/8, ::1 and IPv4-mapped 127/8. Any other host (a LAN address, or a name
 *  that cannot be classified without DNS) is not, so the caller treats it as off this machine. */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) {
    return true;
  }
  switch (isIP(h)) {
    case 4:
      return h.split(".")[0] === "127";
    case 6: {
      const mapped = h.match(/^::ffff:(\d+)\.\d+\.\d+\.\d+$/);
      return mapped ? mapped[1] === "127" : h === "::1";
    }
    default:
      return false;
  }
}

/**
 * ADR-0030 amendment 1: the public ids of configured servers whose host is not loopback. Their vanilla API
 * certificate is not verified, so on a LAN it could be impersonated. Ids only: never the address.
 */
export function nonLoopbackServerIds(servers: { id: string; config: { host: string } }[]): string[] {
  return servers.filter((server) => !isLoopbackHost(server.config.host)).map((server) => server.id);
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

// ADR-0030's `createSatisfactoryServerConfig` (a stored connection's config) moved to the game-adapter package with
// the type; the module's index re-exports it from there.

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
    apiPort: parsePortEnv("SATISFACTORY_API_PORT", env.SATISFACTORY_API_PORT, DEFAULT_API_PORT),
    apiToken: env.SATISFACTORY_API_TOKEN,
    apiAllowSelfSignedCert: allowSelfSignedCert(env, host),
    frmPort: parsePortEnv("FRM_WEB_PORT", env.FRM_WEB_PORT, DEFAULT_FRM_PORT),
    frmToken: env.FRM_AUTH_TOKEN,
    requestTimeoutMs: parseRequestTimeoutMs(env.SATISFACTORY_REQUEST_TIMEOUT_MS),
  };
}
