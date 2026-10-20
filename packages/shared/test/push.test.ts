import { describe, expect, it } from "vitest";
import * as fixtures from "../fixtures/index";
import {
  ApiErrorResponseSchema,
  KnownErrorCode,
  MAX_PUSH_SUBSCRIPTIONS_PER_USER,
  PushConfigResponseSchema,
  PushOptInRequestSchema,
  PushSubscribeRequestSchema,
  PushSubscribeResponseSchema,
  endpoints,
} from "../src/index";

describe("push contract: subscribing (ADR-0044)", () => {
  it("accepts a browser's PushSubscription.toJSON() shape", () => {
    expect(PushSubscribeRequestSchema.parse(fixtures.pushSubscribeRequest)).toEqual(fixtures.pushSubscribeRequest);
  });

  it("is strict: no extra field (expirationTime, a user id) and no extra key", () => {
    expect(PushSubscribeRequestSchema.safeParse({ ...fixtures.pushSubscribeRequest, userId: "x" }).success).toBe(false);
    expect(PushSubscribeRequestSchema.safeParse({ ...fixtures.pushSubscribeRequest, expirationTime: null }).success).toBe(false);
    expect(PushSubscribeRequestSchema.safeParse({ ...fixtures.pushSubscribeRequest, keys: { ...fixtures.pushSubscribeRequest.keys, extra: "x" } }).success).toBe(false);
  });

  it("refuses malformed keys (wrong length, not base64url, missing) and a missing or oversized endpoint", () => {
    const { endpoint, keys } = fixtures.pushSubscribeRequest;
    const bad = [
      { endpoint, keys: { ...keys, p256dh: "short" } },
      { endpoint, keys: { ...keys, p256dh: `${"B".repeat(86)}+` } },
      { endpoint, keys: { ...keys, auth: "C".repeat(23) } },
      { endpoint, keys: { p256dh: keys.p256dh } },
      { endpoint: "", keys },
      { endpoint: `https://push.example.test/${"a".repeat(2048)}`, keys },
      { keys },
    ];
    for (const body of bad) expect(PushSubscribeRequestSchema.safeParse(body).success, JSON.stringify(Object.keys(body))).toBe(false);
  });

  it("the response carries an id and a time, and NEVER the endpoint or keys", () => {
    expect(PushSubscribeResponseSchema.parse(fixtures.pushSubscribeResponse)).toEqual(fixtures.pushSubscribeResponse);
    expect(Object.keys(fixtures.pushSubscribeResponse).sort()).toEqual(["createdAt", "id"]);
  });

  it("the per-user limit is 10", () => {
    expect(MAX_PUSH_SUBSCRIPTIONS_PER_USER).toBe(10);
  });
});

describe("push contract: config and opt-in", () => {
  it("config: the public key is optional (absent while disabled)", () => {
    expect(PushConfigResponseSchema.parse(fixtures.pushConfigEnabled).vapidPublicKey).toBeDefined();
    expect(PushConfigResponseSchema.parse(fixtures.pushConfigDisabled)).toEqual({ enabled: false });
  });

  it("opt-in takes exactly { optedIn: boolean }", () => {
    expect(PushOptInRequestSchema.safeParse({ optedIn: true }).success).toBe(true);
    expect(PushOptInRequestSchema.safeParse({ optedIn: "yes" }).success).toBe(false);
    expect(PushOptInRequestSchema.safeParse({ optedIn: true, userId: "x" }).success).toBe(false);
    expect(PushOptInRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("push contract: errors", () => {
  it("push_endpoint_invalid and push_disabled are known codes, parse in the envelope, and never echo a URL", () => {
    for (const code of ["push_endpoint_invalid", "push_disabled"]) expect(KnownErrorCode.safeParse(code).success, code).toBe(true);
    const errors = [fixtures.errorPushEndpointInvalid, fixtures.errorPushDisabled].map((e) => ApiErrorResponseSchema.parse(e));
    expect(errors.map((e) => e.error.code)).toEqual(["push_endpoint_invalid", "push_disabled"]);
    expect(errors[0]?.error.reason).toBe("host_not_allowed");
    for (const e of errors) expect(e.error.message).not.toMatch(/https?:/i);
  });
});

describe("push contract: endpoints", () => {
  it("the methods and routes are the documented ones", () => {
    const { config, subscribe, unsubscribe, test, optIn } = endpoints.push;
    expect([config, subscribe, unsubscribe, test, optIn.get, optIn.put].map((e) => `${e.method} ${e.route}`)).toEqual([
      "GET /api/push/config",
      "POST /api/push/subscriptions",
      "DELETE /api/push/subscriptions/:id",
      "POST /api/push/subscriptions/:id/test",
      "GET /api/servers/:serverId/alerts/push",
      "PUT /api/servers/:serverId/alerts/push",
    ]);
  });

  it("only the opt-in write is a member self-service write (a viewer may use it)", () => {
    expect("memberSelfService" in endpoints.push.optIn.put).toBe(true);
    for (const e of [endpoints.push.config, endpoints.push.subscribe, endpoints.push.unsubscribe, endpoints.push.test, endpoints.push.optIn.get]) {
      expect("memberSelfService" in e).toBe(false);
    }
  });

  it("the path builders encode the ids", () => {
    expect(endpoints.push.unsubscribe.path("a/b")).toBe("/api/push/subscriptions/a%2Fb");
    expect(endpoints.push.test.path("x")).toBe("/api/push/subscriptions/x/test");
    expect(endpoints.push.optIn.put.path("srv-1")).toBe("/api/servers/srv-1/alerts/push");
  });
});
