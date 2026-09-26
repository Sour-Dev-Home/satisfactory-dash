import { parseDiscordWebhookUrl } from "./discordWebhook.js";

/**
 * ADR-0027 decision 5: one POST to a Discord webhook. The URL is validated again right here (the allowlist in
 * discordWebhook.ts) so nothing else can reach `fetch`; redirects are NEVER followed (`redirect: "manual"`, and any 3xx
 * is refused without looking at `Location`); the request has a deadline; the response body is read only for a 429
 * (capped) to learn `retry_after`. The outcome carries a stable code and never the URL, a header, a body or an error
 * message (a thrown error can quote the URL, so it is reduced to a code).
 */

export type SendOutcome =
  | { kind: "sent" }
  | { kind: "retry"; code: "rate_limited" | "server_error" | "network" | "timeout"; retryAfterMs?: number }
  /** 404 (the webhook was deleted) or 401 (its token is no longer valid): the destination is dead, disable it. */
  | { kind: "gone"; status: 401 | 404 }
  /** Discord refused this message for good (a 400, another 4xx, a redirect, a URL we would not send to). */
  | { kind: "rejected"; code: "bad_request" | "forbidden" | "redirect_refused" | "invalid_url" | "unexpected_status" };

export interface DiscordSenderOptions {
  /** Injectable for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_429_BODY_BYTES = 4096;
const MIN_RETRY_AFTER_MS = 1000;
const MAX_RETRY_AFTER_MS = 60 * 60 * 1000;

/** Seconds (possibly fractional) from a Retry-After header or the JSON `retry_after`, as ms within sane bounds. */
function retryAfterMs(header: string | null, body: string): number | undefined {
  let seconds: number | undefined;
  if (header !== null && /^\d+(\.\d+)?$/.test(header.trim())) seconds = Number(header);
  if (seconds === undefined) {
    try {
      const parsed: unknown = JSON.parse(body);
      const value = typeof parsed === "object" && parsed !== null ? (parsed as { retry_after?: unknown }).retry_after : undefined;
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) seconds = value;
    } catch {
      // not JSON: no hint
    }
  }
  if (seconds === undefined) return undefined;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(MIN_RETRY_AFTER_MS, Math.ceil(seconds * 1000)));
}

export async function sendDiscordMessage(url: string, payload: unknown, options: DiscordSenderOptions = {}): Promise<SendOutcome> {
  const parsed = parseDiscordWebhookUrl(url);
  if (!parsed.ok) return { kind: "rejected", code: "invalid_url" }; // never fetched
  const doFetch = options.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await doFetch(parsed.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    return { kind: "retry", code: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
  }
  const status = response.status;
  // The body is never needed except to learn retry_after; drop it so the connection is released.
  const discard = () => void response.body?.cancel().catch(() => {});
  if (status >= 200 && status < 300) {
    discard();
    return { kind: "sent" };
  }
  if (status >= 300 && status < 400) {
    discard(); // a redirect is never followed: an allowlisted host must not be able to send us elsewhere
    return { kind: "rejected", code: "redirect_refused" };
  }
  if (status === 429) {
    let body = "";
    try {
      body = (await response.text()).slice(0, MAX_429_BODY_BYTES);
    } catch {
      // no body: fall back to the header
    }
    const after = retryAfterMs(response.headers.get("retry-after"), body);
    return { kind: "retry", code: "rate_limited", ...(after !== undefined ? { retryAfterMs: after } : {}) };
  }
  discard();
  if (status === 404 || status === 401) return { kind: "gone", status };
  if (status >= 500) return { kind: "retry", code: "server_error" };
  if (status === 400) return { kind: "rejected", code: "bad_request" };
  if (status === 403) return { kind: "rejected", code: "forbidden" };
  return { kind: "rejected", code: "unexpected_status" };
}
