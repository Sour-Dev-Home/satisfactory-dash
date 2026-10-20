import { createHash } from "node:crypto";
import { hostAllowed } from "../pushConfig.js";

/**
 * ADR-0044 decision 3 (security): the ONLY shape of subscription endpoint the backend will ever send a push to. The
 * endpoint is a capability URL supplied by a user, so this is what stops it becoming a way to make the backend fetch
 * anything else (SSRF): `https` to an allowlisted push-service host, no userinfo, no port, no fragment. It is checked
 * when a subscription is saved AND again just before every send (348-2), and the sender never follows a redirect.
 * Nothing here ever puts the URL (or any part of it) in a message, a reason or a log: a refusal is a stable code only.
 */

export type PushEndpointRejection =
  | "too_long"
  | "not_a_url"
  | "not_https"
  | "credentials_in_url"
  | "port_not_allowed"
  | "fragment_not_allowed"
  | "host_not_allowed";

export type PushEndpointResult = { ok: true; url: string; host: string; hash: Buffer } | { ok: false; reason: PushEndpointRejection };

const MAX_LENGTH = 2048;

/** Whitespace of any kind, C0/C1 controls or a backslash: anything that could make two URL parsers disagree. */
function hasAmbiguousCharacter(input: string): boolean {
  for (const char of input) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f) || char === "\\" || /\s/.test(char)) return true;
  }
  return false;
}

/** Validates an endpoint against the allowlist. Never throws and never echoes the input. `hash` is the sha256 of the
 *  canonical URL (the idempotency key: the same endpoint twice is one subscription). */
export function parsePushEndpoint(raw: unknown, allowedHosts: readonly string[]): PushEndpointResult {
  if (typeof raw !== "string" || raw.length === 0) return { ok: false, reason: "not_a_url" };
  if (raw.length > MAX_LENGTH) return { ok: false, reason: "too_long" };
  if (hasAmbiguousCharacter(raw)) return { ok: false, reason: "not_a_url" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "not_a_url" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "not_https" };
  if (url.username !== "" || url.password !== "") return { ok: false, reason: "credentials_in_url" };
  if (url.port !== "") return { ok: false, reason: "port_not_allowed" }; // 443 is normalised to "" by URL
  if (url.hash !== "" || raw.includes("#")) return { ok: false, reason: "fragment_not_allowed" };
  if (!hostAllowed(url.hostname, allowedHosts)) return { ok: false, reason: "host_not_allowed" };
  const canonical = url.href;
  return { ok: true, url: canonical, host: url.hostname, hash: createHash("sha256").update(canonical).digest() };
}
