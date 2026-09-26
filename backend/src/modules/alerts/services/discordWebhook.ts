/**
 * ADR-0027 decision 5 (security): the ONLY URL shape the backend will ever send an alert to. The webhook URL is a
 * bearer secret typed in by a user, so this is what stops it becoming a way to make the backend fetch anything else
 * (SSRF): only `https` to `discord.com` or `discordapp.com`, exactly, no userinfo, no port, no query, no fragment, and
 * exactly Discord's webhook path. It is checked when a webhook is saved AND again just before every send (after it is
 * decrypted), and the sender never follows a redirect, so a URL that passes here can only reach Discord's own API.
 * Nothing here ever puts the URL (or any part of it beyond the last 4 characters) in a message or a log.
 */

export type WebhookRejection =
  | "not_a_string"
  | "too_long"
  | "not_a_url"
  | "not_https"
  | "credentials_in_url"
  | "host_not_allowed"
  | "port_not_allowed"
  | "query_or_fragment"
  | "path_not_a_webhook";

export type WebhookParseResult = { ok: true; url: string; last4: string } | { ok: false; code: WebhookRejection };

/** The exact hosts (no subdomains: `evil.discord.com.attacker.example`, `x.discord.com` and the like are refused). */
export const ALLOWED_WEBHOOK_HOSTS: readonly string[] = ["discord.com", "discordapp.com"];

const MAX_LENGTH = 300;
// /api/webhooks/<id>/<token> or /api/v<N>/webhooks/<id>/<token>. The id is a snowflake; the token is URL-safe base64.
const WEBHOOK_PATH = /^\/api(?:\/v\d{1,2})?\/webhooks\/\d{15,25}\/[A-Za-z0-9_-]{20,120}$/;

/**
 * Validates a webhook URL and returns it in canonical form plus its last 4 characters (the only part ever shown back).
 * Never throws and never echoes the input.
 */
export function parseDiscordWebhookUrl(raw: unknown): WebhookParseResult {
  if (typeof raw !== "string") return { ok: false, code: "not_a_string" };
  const input = raw.trim();
  if (input.length === 0 || input.length > MAX_LENGTH) return { ok: false, code: "too_long" };
  // Refuse before parsing anything that could make two parsers disagree: whitespace or control characters inside,
  // a backslash (some parsers treat it as a slash), or a percent sign (encoded dots, slashes, at-signs).
  if (/[\s\u0000-\u001f\u007f\\%]/.test(input)) return { ok: false, code: "not_a_url" };
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, code: "not_a_url" };
  }
  if (url.protocol !== "https:") return { ok: false, code: "not_https" };
  if (url.username !== "" || url.password !== "") return { ok: false, code: "credentials_in_url" };
  if (!ALLOWED_WEBHOOK_HOSTS.includes(url.hostname)) return { ok: false, code: "host_not_allowed" };
  if (url.port !== "") return { ok: false, code: "port_not_allowed" }; // 443 is normalised to "" by URL, anything else stays
  if (url.search !== "" || url.hash !== "") return { ok: false, code: "query_or_fragment" };
  if (!WEBHOOK_PATH.test(url.pathname)) return { ok: false, code: "path_not_a_webhook" };
  // The raw input must not have ended in a bare "?" or "#" (URL drops them from search/hash).
  if (input.includes("?") || input.includes("#")) return { ok: false, code: "query_or_fragment" };
  const canonical = `https://${url.hostname}${url.pathname}`;
  return { ok: true, url: canonical, last4: canonical.slice(-4) };
}
