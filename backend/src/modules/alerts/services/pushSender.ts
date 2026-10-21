import type { SecretsKeyring } from "../../../platform/secrets/secrets.js";
import { parsePushEndpoint } from "./pushEndpoint.js";
import { encryptPushPayload, PushCryptoError, vapidAuthorization, type VapidKeys } from "./webPushCrypto.js";

/**
 * ADR-0044 (#348, task 348-2): one web push request (RFC 8030) to one subscription. The endpoint is checked against the
 * allowlist again RIGHT HERE (pushEndpoint.ts), so nothing else can reach `fetch`; redirects are never followed
 * (`redirect: "manual"`, any 3xx refused without reading `Location`); the request has a deadline; the response body is
 * never read. The outcome is a stable code and never carries the endpoint, a key, a header, a body or an error message.
 */

export type PushSendOutcome =
  | { kind: "sent" }
  | { kind: "retry"; code: "rate_limited" | "server_error" | "network" | "timeout"; retryAfterMs?: number }
  /** 404 or 410 (RFC 8030 section 7.3): the subscription is gone; delete it. */
  | { kind: "gone"; status: 404 | 410 }
  /** Refused for good: another 4xx, a redirect, an endpoint off the allowlist, keys that cannot encrypt. */
  | {
      kind: "rejected";
      code: "endpoint_refused" | "bad_keys" | "too_large" | "redirect_refused" | "vapid_rejected" | "bad_request" | "unexpected_status";
      status?: number;
    };

export interface PushMessage {
  endpoint: string;
  p256dh: string;
  auth: string;
  /** The plaintext (UTF-8 JSON, at most 3 KB: alertMessage.ts formatPushMessage keeps it there). */
  payload: Buffer;
  /** RFC 8030 section 5.3. */
  urgency: "high" | "normal";
}

export interface PushSenderOptions {
  vapid: VapidKeys;
  allowedHosts: readonly string[];
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
/** RFC 8030 section 5.2: how long the push service keeps an undelivered message (an alert hours old is noise). */
export const PUSH_TTL_SECONDS = 4 * 60 * 60;
const MIN_RETRY_AFTER_MS = 1000;
const MAX_RETRY_AFTER_MS = 60 * 60 * 1000;

/** RFC 9110 section 10.2.3: delay-seconds or an HTTP-date; anything else is ignored. Bounded either way. */
function retryAfterMs(header: string | null, nowMs: number): number | undefined {
  if (header === null) return undefined;
  const value = header.trim();
  let ms: number;
  if (/^\d+(\.\d+)?$/.test(value)) ms = Math.ceil(Number(value) * 1000);
  else if (/^[A-Za-z]{3}, \d{1,2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value) && Number.isFinite(Date.parse(value))) ms = Date.parse(value) - nowMs;
  else return undefined;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(MIN_RETRY_AFTER_MS, ms));
}

/** The context a subscription field is sealed under (pushService.ts seals with the same). */
export const pushFieldContext = (userId: string, field: "endpoint" | "p256dh" | "auth"): string => `push:${userId}:${field}`;

/** Opens a subscription's three sealed fields; undefined (never a throw, never a value in an error) if any cannot be. */
export function openPushSubscription(
  ring: SecretsKeyring,
  sealed: { userId: string; keyId: string; endpointEnc: Buffer; p256dhEnc: Buffer; authEnc: Buffer },
): { endpoint: string; p256dh: string; auth: string } | undefined {
  try {
    return {
      endpoint: ring.open(sealed.keyId, sealed.endpointEnc, pushFieldContext(sealed.userId, "endpoint")),
      p256dh: ring.open(sealed.keyId, sealed.p256dhEnc, pushFieldContext(sealed.userId, "p256dh")),
      auth: ring.open(sealed.keyId, sealed.authEnc, pushFieldContext(sealed.userId, "auth")),
    };
  } catch {
    return undefined;
  }
}

export async function sendWebPush(message: PushMessage, options: PushSenderOptions): Promise<PushSendOutcome> {
  const endpoint = parsePushEndpoint(message.endpoint, options.allowedHosts);
  if (!endpoint.ok) return { kind: "rejected", code: "endpoint_refused" }; // never fetched
  let body: Buffer;
  let authorization: string;
  try {
    body = encryptPushPayload({ plaintext: message.payload, p256dh: message.p256dh, auth: message.auth });
    authorization = vapidAuthorization(endpoint.url, options.vapid, (options.now ?? Date.now)());
  } catch (err) {
    if (err instanceof PushCryptoError && err.code === "too_large") return { kind: "rejected", code: "too_large" };
    if (err instanceof PushCryptoError && err.code === "bad_vapid_key") return { kind: "rejected", code: "vapid_rejected" };
    return { kind: "rejected", code: "bad_keys" };
  }
  const doFetch = options.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await doFetch(endpoint.url, {
      method: "POST",
      headers: {
        authorization,
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: String(PUSH_TTL_SECONDS),
        urgency: message.urgency,
      },
      body: new Uint8Array(body),
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    return { kind: "retry", code: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
  }
  const status = response.status;
  void response.body?.cancel().catch(() => {}); // the body is never needed: release the connection
  if (status >= 200 && status < 300) return { kind: "sent" };
  if (status >= 300 && status < 400) return { kind: "rejected", code: "redirect_refused", status };
  if (status === 404 || status === 410) return { kind: "gone", status };
  if (status === 429 || status >= 500) {
    const after = retryAfterMs(response.headers.get("retry-after"), (options.now ?? Date.now)());
    return { kind: "retry", code: status === 429 ? "rate_limited" : "server_error", ...(after !== undefined ? { retryAfterMs: after } : {}) };
  }
  // 401/403: the push service refused our VAPID token (keys rotated, or the subscription belongs to other keys).
  if (status === 401 || status === 403) return { kind: "rejected", code: "vapid_rejected", status };
  if (status === 400 || status === 413) return { kind: "rejected", code: status === 413 ? "too_large" : "bad_request", status };
  return { kind: "rejected", code: "unexpected_status", status };
}
