import { ConfigError } from "../../platform/errors.js";

/**
 * ADR-0044 (#348): web push configuration, read once at startup.
 *
 * VAPID (RFC 8292): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` are all set or all unset; anything in
 * between stops the backend at startup, naming the variable (never its value). All unset means push is not configured,
 * which is a normal state: `GET /api/push/config` then answers `enabled: false`. The private key signs the push
 * requests; it comes from the environment only (`.env` for now, SSM `/satis/prod/*` after the AWS move), is never
 * returned by an API and never logged: it is a function on the config object, so a stray `JSON.stringify(config)` or a
 * logged config object cannot leak it. Rotating the keys invalidates every subscription (ADR-0044 decision 4).
 *
 * The push-service host allowlist (`PUSH_ENDPOINT_HOSTS`, comma-separated, replaces the default) is the SSRF rule for
 * subscription endpoints: an endpoint is a URL supplied by a user that the backend will later POST to.
 */

export interface VapidConfig {
  /** The application server key, base64url (65 bytes decoded). Not secret: the browser needs it to subscribe. */
  publicKey: string;
  /** "mailto:..." or an https URL: where a push service can reach the operator. */
  subject: string;
  /** The signing key (base64url, 32 bytes decoded). A function so it never shows up in a serialised config. */
  privateKey(): string;
}

export interface PushConfig {
  /** null when push is not configured (no VAPID variables set). */
  vapid: VapidConfig | null;
  /** Exact hosts, or `*.suffix` entries that match any single or nested subdomain of the suffix. */
  allowedHosts: readonly string[];
}

/**
 * Hosts accepted when `PUSH_ENDPOINT_HOSTS` is not set.
 * [NEEDS VERIFICATION] (ADR-0044 decision 3): capture real endpoints from Chrome, Firefox, Edge and Safari before fixing
 * this list. Apple's push server is deliberately NOT here: its address is unverified, so iOS subscriptions are refused
 * until the operator sets it in `PUSH_ENDPOINT_HOSTS` (TODO [NEEDS VERIFICATION]: add it once captured from a real device).
 */
export const DEFAULT_PUSH_ENDPOINT_HOSTS: readonly string[] = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "*.notify.windows.com",
];

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const HOST_ENTRY = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function decodedLength(value: string): number | undefined {
  if (!BASE64URL.test(value)) return undefined;
  const bytes = Buffer.from(value, "base64url");
  return bytes.toString("base64url") === value ? bytes.length : undefined;
}

function parseVapid(env: NodeJS.ProcessEnv): VapidConfig | null {
  const names = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const;
  const values = names.map((name) => env[name]?.trim() ?? "");
  const set = values.filter((value) => value !== "").length;
  if (set === 0) return null;
  if (set !== names.length) {
    throw new ConfigError("VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT must be set together, or all left unset.");
  }
  const [publicKey, privateKey, subject] = values as [string, string, string];
  if (decodedLength(publicKey) !== 65 || Buffer.from(publicKey, "base64url")[0] !== 0x04) {
    throw new ConfigError("VAPID_PUBLIC_KEY must be an uncompressed P-256 public key (65 bytes) encoded as base64url without padding.");
  }
  if (decodedLength(privateKey) !== 32) {
    throw new ConfigError("VAPID_PRIVATE_KEY must be a P-256 private key (32 bytes) encoded as base64url without padding.");
  }
  if (!/^mailto:[^\s@]+@[^\s@]+$/.test(subject) && !/^https:\/\/[^\s/]+/.test(subject)) {
    throw new ConfigError("VAPID_SUBJECT must be a mailto: address or an https URL.");
  }
  return { publicKey, subject, privateKey: () => privateKey };
}

function parseHosts(env: NodeJS.ProcessEnv): readonly string[] {
  const raw = env.PUSH_ENDPOINT_HOSTS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_PUSH_ENDPOINT_HOSTS;
  const hosts = raw.split(",").map((entry) => entry.trim().toLowerCase());
  for (const host of hosts) {
    if (!HOST_ENTRY.test(host)) {
      throw new ConfigError("PUSH_ENDPOINT_HOSTS must be comma-separated hostnames, each an exact host or `*.suffix` (for example `*.example.com`).");
    }
  }
  return hosts;
}

export function loadPushConfig(env: NodeJS.ProcessEnv = process.env): PushConfig {
  return { vapid: parseVapid(env), allowedHosts: parseHosts(env) };
}

/** True when `host` (already lower-cased by the URL parser) is on the allowlist. A `*.suffix` entry needs at least one
 *  extra label, so the bare suffix itself and look-alikes such as `evil-notify.windows.com` do not match. */
export function hostAllowed(host: string, allowedHosts: readonly string[]): boolean {
  return allowedHosts.some((entry) => (entry.startsWith("*.") ? host.endsWith(entry.slice(1)) && host.length > entry.length - 1 : host === entry));
}
