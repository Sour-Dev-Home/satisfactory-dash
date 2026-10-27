import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { RequestHandler } from "express";
import { ApiErrorResponseSchema, DeliveryIngestResponseSchema, endpoints } from "@satisfactory-dash/shared";
import type { DeliverySnapshot } from "@satisfactory-dash/shared";
import { deliverySnapshotSample } from "@satisfactory-dash/shared/fixtures";
import { createApp } from "../../app.js";
import { createLogger } from "../../platform/logger.js";
import { ConfigError } from "../../platform/errors.js";
import { UserRateLimiter } from "../../platform/userRateLimiter.js";
import {
  DELIVERY_INGEST_PER_HOUR,
  bearerMatches,
  createDeliveryIngestRouter,
  loadDeliveryIngestConfig,
} from "./deliveryIngest.js";
import type { DeliveryIngestConfig } from "./deliveryIngest.js";

const SECRET = "s3cret-for-tests-only_0123456789abcdefABCDEF";
const DIGEST = createHash("sha256").update(SECRET).digest("hex");
const CONFIG: DeliveryIngestConfig = { secretSha256: Buffer.from(DIGEST, "hex") };
const PATH = endpoints.metrics.deliveryIngest.path();

// A session guard that refuses everyone: the ingest must answer before it (it is a public router).
const guard: RequestHandler = (_req, res) => {
  res.status(401).json({ error: { code: "unauthorized", message: "Sign in to continue", requestId: "t" } });
};

function build(options: { config?: DeliveryIngestConfig | undefined; store?: ((s: DeliverySnapshot) => Promise<void>) | null; acceptLimiter?: UserRateLimiter; attemptLimiter?: UserRateLimiter } = {}) {
  const store = options.store === null ? undefined : (options.store ?? vi.fn(async () => {}));
  const app = createApp({
    logger: createLogger({ level: "silent" }, { write: () => {} }),
    routers: [
      createDeliveryIngestRouter({
        config: "config" in options ? options.config : CONFIG,
        store,
        ...(options.acceptLimiter && { acceptLimiter: options.acceptLimiter }),
        ...(options.attemptLimiter && { attemptLimiter: options.attemptLimiter }),
      }),
    ],
    sessionGuard: guard,
    protectedRouters: [],
  });
  return { app, store };
}

/** `auth` null sends no Authorization header at all. */
const post = (app: ReturnType<typeof build>["app"], body: unknown, auth: string | null = `Bearer ${SECRET}`) => {
  const req = request(app).post(PATH).set("Content-Type", "application/json");
  return (auth === null ? req : req.set("Authorization", auth)).send(JSON.stringify(body));
};

describe("loadDeliveryIngestConfig", () => {
  it("is off when unset or blank", () => {
    expect(loadDeliveryIngestConfig({})).toBeUndefined();
    expect(loadDeliveryIngestConfig({ METRICS_INGEST_SECRET_SHA256: "  " })).toBeUndefined();
  });

  it("takes 64 hex digits, in either case, around whitespace", () => {
    expect(loadDeliveryIngestConfig({ METRICS_INGEST_SECRET_SHA256: ` ${DIGEST.toUpperCase()}\n` })?.secretSha256.equals(CONFIG.secretSha256)).toBe(true);
  });

  it("refuses anything else without echoing the value", () => {
    for (const bad of [DIGEST.slice(1), `${DIGEST}0`, `${DIGEST.slice(2)}zz`, SECRET]) {
      let error: unknown;
      try {
        loadDeliveryIngestConfig({ METRICS_INGEST_SECRET_SHA256: bad });
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).not.toContain(bad);
    }
  });
});

describe("bearerMatches", () => {
  it("matches only the exact secret under the Bearer scheme", () => {
    expect(bearerMatches(`Bearer ${SECRET}`, CONFIG.secretSha256)).toBe(true);
    for (const header of [undefined, "", SECRET, `bearer ${SECRET}`, `Bearer  ${SECRET}`, `Bearer ${SECRET} `, `Bearer ${SECRET}x`, `Bearer ${DIGEST}`, `Basic ${SECRET}`, ["Bearer", SECRET]]) {
      expect(bearerMatches(header, CONFIG.secretSha256), String(header)).toBe(false);
    }
  });

  it("refuses a token too short to be a real secret, even when its hash is configured", () => {
    const short = "short-secret";
    expect(bearerMatches(`Bearer ${short}`, createHash("sha256").update(short).digest())).toBe(false);
  });
});

describe("POST /api/internal/metrics/delivery", () => {
  it("200 stores a valid snapshot, before any session", async () => {
    const { app, store } = build();
    const res = await post(app, deliverySnapshotSample);
    expect(res.status).toBe(200);
    expect(DeliveryIngestResponseSchema.parse(res.body)).toEqual({ ok: true });
    expect(store).toHaveBeenCalledWith(deliverySnapshotSample);
  });

  it("404 (the unknown-route answer) when the secret hash is unset, even with the right secret", async () => {
    const { app, store } = build({ config: undefined });
    for (const auth of [`Bearer ${SECRET}`, null]) {
      const res = await post(app, deliverySnapshotSample, auth);
      expect(res.status).toBe(404);
      expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("not_found");
    }
    expect(store).not.toHaveBeenCalled();
  });

  it("404 without a database to store into", async () => {
    const { app } = build({ store: null });
    expect((await post(app, deliverySnapshotSample)).status).toBe(404);
  });

  it("401 for a missing, malformed or wrong secret, one message for all, and nothing stored", async () => {
    const { app, store } = build();
    const messages = new Set<string>();
    for (const auth of [null, "Bearer", `Bearer ${SECRET}x`, `Bearer ${DIGEST}`, `Basic ${SECRET}`]) {
      const res = await post(app, deliverySnapshotSample, auth);
      expect(res.status, String(auth)).toBe(401);
      const error = ApiErrorResponseSchema.parse(res.body).error;
      expect(error.code).toBe("unauthorized");
      messages.add(error.message);
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    }
    expect(messages.size).toBe(1);
    expect(store).not.toHaveBeenCalled();
  });

  it("400 for a body the strict schema refuses, without echoing it", async () => {
    const { app, store } = build();
    const bodies = [
      {},
      { ...deliverySnapshotSample, schemaVersion: 1 },
      { ...deliverySnapshotSample, author: "someone@example.test" },
      { ...deliverySnapshotSample, ci: { ...deliverySnapshotSample.ci, headSha: "abc123" } },
      [deliverySnapshotSample],
    ];
    for (const body of bodies) {
      const res = await post(app, body);
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(400);
      expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("bad_request");
      expect(JSON.stringify(res.body)).not.toContain("someone@example.test");
    }
    const broken = await request(app).post(PATH).set("Content-Type", "application/json").set("Authorization", `Bearer ${SECRET}`).send("{not json");
    expect(broken.status).toBe(400);
    expect(store).not.toHaveBeenCalled();
  });

  it("415 for a body that is not JSON", async () => {
    const { app } = build();
    const res = await request(app).post(PATH).set("Content-Type", "text/plain").set("Authorization", `Bearer ${SECRET}`).send("hello");
    expect(res.status).toBe(415);
  });

  it("413 over 16 KB, even though the general /api parser would take 100 KB", async () => {
    const { app, store } = build();
    const res = await post(app, { ...deliverySnapshotSample, padding: "x".repeat(17 * 1024) });
    expect(res.status).toBe(413);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("payload_too_large");
    expect(store).not.toHaveBeenCalled();
  });

  it("checks the secret before reading the body: a wrong secret with an oversized body is 401, not 413", async () => {
    const { app } = build();
    const res = await post(app, { padding: "x".repeat(200 * 1024) }, `Bearer ${SECRET}x`);
    expect(res.status).toBe(401);
  });

  it(`429 past ${DELIVERY_INGEST_PER_HOUR} accepted pushes an hour, with Retry-After`, async () => {
    const { app, store } = build({ acceptLimiter: new UserRateLimiter({ max: 2, windowMs: 60_000 }) });
    expect((await post(app, deliverySnapshotSample)).status).toBe(200);
    expect((await post(app, deliverySnapshotSample)).status).toBe(200);
    const limited = await post(app, deliverySnapshotSample);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect(store).toHaveBeenCalledTimes(2);
  });

  it("wrong secrets do not use up the accepted-push budget, but do hit the per-network attempt limit", async () => {
    const { app } = build({
      acceptLimiter: new UserRateLimiter({ max: 1, windowMs: 60_000 }),
      attemptLimiter: new UserRateLimiter({ max: 3, windowMs: 60_000 }),
    });
    expect((await post(app, deliverySnapshotSample, "Bearer nope-nope-nope-nope-nope-nope-nope-nope")).status).toBe(401);
    expect((await post(app, deliverySnapshotSample, "Bearer nope-nope-nope-nope-nope-nope-nope-nope")).status).toBe(401);
    expect((await post(app, deliverySnapshotSample)).status).toBe(200);
    expect((await post(app, deliverySnapshotSample)).status).toBe(429);
  });

  // (Outside test/dev the envelope carries no `detail`; errorResponse.test.ts covers that.)
  it("a store failure is a 500 with the internal envelope", async () => {
    const { app } = build({ store: async () => Promise.reject(new Error("db down")) });
    const res = await post(app, deliverySnapshotSample);
    expect(res.status).toBe(500);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("internal");
  });
});
