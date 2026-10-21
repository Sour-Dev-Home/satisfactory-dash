import { createECDH, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSecretsKeyring } from "../../../platform/secrets/secrets.js";
import { openPushSubscription, pushFieldContext, sendWebPush, PUSH_TTL_SECONDS } from "./pushSender.js";

const HOST = "push.example.test";
const ENDPOINT = `https://${HOST}/send/secret-endpoint-token`;
const vapidPair = createECDH("prime256v1");
vapidPair.generateKeys();
const vapid = {
  publicKey: vapidPair.getPublicKey().toString("base64url"),
  subject: "mailto:ops@example.test",
  privateKey: () => vapidPair.getPrivateKey().toString("base64url"),
};
const ua = createECDH("prime256v1");
ua.generateKeys();
const KEYS = { p256dh: ua.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") };
const message = (over: Partial<Parameters<typeof sendWebPush>[0]> = {}) => ({ endpoint: ENDPOINT, ...KEYS, payload: Buffer.from("{}"), urgency: "normal" as const, ...over });

function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond();
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const send = (status: number, headers: Record<string, string> = {}) => {
  const f = fakeFetch(() => new Response(status === 204 ? null : "body", { status, headers }));
  return sendWebPush(message(), { vapid, allowedHosts: [HOST], fetch: f.fn }).then((outcome) => ({ outcome, calls: f.calls }));
};

describe("sendWebPush (ADR-0044, 348-2)", () => {
  it("POSTs an aes128gcm body with VAPID, TTL and urgency, never following a redirect, with a deadline", async () => {
    const { outcome, calls } = await send(201);
    expect(outcome).toEqual({ kind: "sent" });
    expect(calls).toHaveLength(1);
    const init = calls[0]!.init;
    expect(calls[0]!.url).toBe(ENDPOINT);
    expect(init).toMatchObject({ method: "POST", redirect: "manual" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toMatchObject({ "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: String(PUSH_TTL_SECONDS), urgency: "normal" });
    expect((init.headers as Record<string, string>).authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
  });

  it.each([
    [404, { kind: "gone", status: 404 }],
    [410, { kind: "gone", status: 410 }],
    [500, { kind: "retry", code: "server_error" }],
    [503, { kind: "retry", code: "server_error" }],
    [301, { kind: "rejected", code: "redirect_refused", status: 301 }],
    [400, { kind: "rejected", code: "bad_request", status: 400 }],
    [401, { kind: "rejected", code: "vapid_rejected", status: 401 }],
    [403, { kind: "rejected", code: "vapid_rejected", status: 403 }],
    [413, { kind: "rejected", code: "too_large", status: 413 }],
    [418, { kind: "rejected", code: "unexpected_status", status: 418 }],
  ])("maps HTTP %i", async (status, expected) => {
    expect((await send(status)).outcome).toEqual(expected);
  });

  it("a 429 retries, honouring Retry-After within bounds", async () => {
    expect((await send(429, { "retry-after": "30" })).outcome).toEqual({ kind: "retry", code: "rate_limited", retryAfterMs: 30_000 });
    expect((await send(429, { "retry-after": "999999" })).outcome).toEqual({ kind: "retry", code: "rate_limited", retryAfterMs: 3_600_000 });
    expect((await send(429)).outcome).toEqual({ kind: "retry", code: "rate_limited" });
  });

  it("a network error or a timeout retries with a code, never the error's message", async () => {
    const net = fakeFetch(() => Promise.reject(new TypeError(`fetch failed ${ENDPOINT}`)));
    expect(await sendWebPush(message(), { vapid, allowedHosts: [HOST], fetch: net.fn })).toEqual({ kind: "retry", code: "network" });
    const slow = fakeFetch(() => Promise.reject(Object.assign(new Error("t"), { name: "TimeoutError" })));
    expect(await sendWebPush(message(), { vapid, allowedHosts: [HOST], fetch: slow.fn })).toEqual({ kind: "retry", code: "timeout" });
  });

  it("re-checks the endpoint against the allowlist and never fetches one that fails it", async () => {
    for (const endpoint of [`https://evil.example/send/x`, `http://${HOST}/send/x`, `https://${HOST}:8443/send/x`, `https://u:p@${HOST}/x`, `https://${HOST}/x#frag`]) {
      const f = fakeFetch(() => new Response(null, { status: 201 }));
      expect(await sendWebPush(message({ endpoint }), { vapid, allowedHosts: [HOST], fetch: f.fn })).toEqual({ kind: "rejected", code: "endpoint_refused" });
      expect(f.calls).toEqual([]);
    }
  });

  it("keys that cannot be encrypted to, or a payload too large, are refused without a request", async () => {
    const f = fakeFetch(() => new Response(null, { status: 201 }));
    expect(await sendWebPush(message({ p256dh: "B".repeat(87) }), { vapid, allowedHosts: [HOST], fetch: f.fn })).toEqual({ kind: "rejected", code: "bad_keys" });
    expect(await sendWebPush(message({ payload: Buffer.alloc(5000) }), { vapid, allowedHosts: [HOST], fetch: f.fn })).toEqual({ kind: "rejected", code: "too_large" });
    expect(f.calls).toEqual([]);
  });

  it("an outcome never carries the endpoint or a key", async () => {
    for (const status of [201, 301, 404, 429, 500, 400]) {
      const text = JSON.stringify((await send(status)).outcome);
      expect(text).not.toContain(HOST);
      expect(text).not.toContain(KEYS.auth);
    }
  });
});

describe("openPushSubscription", () => {
  const ring = createSecretsKeyring("k1", new Map([["k1", randomBytes(32)]]));
  const seal = (userId: string) => ({
    userId,
    keyId: "k1",
    endpointEnc: ring.seal(ENDPOINT, pushFieldContext(userId, "endpoint")).data,
    p256dhEnc: ring.seal(KEYS.p256dh, pushFieldContext(userId, "p256dh")).data,
    authEnc: ring.seal(KEYS.auth, pushFieldContext(userId, "auth")).data,
  });

  it("opens the three fields sealed for that user", () => {
    expect(openPushSubscription(ring, seal("u1"))).toEqual({ endpoint: ENDPOINT, ...KEYS });
  });

  it("fails closed (undefined, no throw) for fields moved to another user or swapped between fields", () => {
    expect(openPushSubscription(ring, { ...seal("u1"), userId: "u2" })).toBeUndefined();
    const s = seal("u1");
    expect(openPushSubscription(ring, { ...s, p256dhEnc: s.authEnc })).toBeUndefined();
  });
});

describe("Retry-After forms (RFC 9110 section 10.2.3)", () => {
  const NOW = Date.parse("2026-10-20T12:00:00Z");
  const sendAt = (status: number, headers: Record<string, string>) => {
    const f = fakeFetch(() => new Response("x", { status, headers }));
    return sendWebPush(message(), { vapid, allowedHosts: [HOST], fetch: f.fn, now: () => NOW });
  };

  it("honours an HTTP-date Retry-After on a 429, within bounds", async () => {
    expect(await sendAt(429, { "retry-after": "Tue, 20 Oct 2026 12:05:00 GMT" })).toEqual({ kind: "retry", code: "rate_limited", retryAfterMs: 300_000 });
    expect(await sendAt(429, { "retry-after": "Wed, 21 Oct 2026 12:00:00 GMT" })).toEqual({ kind: "retry", code: "rate_limited", retryAfterMs: 3_600_000 });
    // a date in the past is "now": the minimum, never negative
    expect(await sendAt(429, { "retry-after": "Tue, 20 Oct 2026 11:00:00 GMT" })).toEqual({ kind: "retry", code: "rate_limited", retryAfterMs: 1000 });
  });

  it("ignores garbage Retry-After values", async () => {
    for (const bad of ["soon", "-5", "1e9", "Infinity", "NaN", ""]) {
      expect(await sendAt(429, { "retry-after": bad })).toEqual({ kind: "retry", code: "rate_limited" });
    }
  });

  it("honours Retry-After on a 503 too", async () => {
    expect(await sendAt(503, { "retry-after": "120" })).toEqual({ kind: "retry", code: "server_error", retryAfterMs: 120_000 });
  });
});

describe("timeout (hunt)", () => {
  it("a push service that never answers is abandoned at the deadline as a timeout", async () => {
    const hang = (async (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)))) as unknown as typeof fetch;
    expect(await sendWebPush(message(), { vapid, allowedHosts: [HOST], fetch: hang, timeoutMs: 30 })).toEqual({ kind: "retry", code: "timeout" });
  });
});
