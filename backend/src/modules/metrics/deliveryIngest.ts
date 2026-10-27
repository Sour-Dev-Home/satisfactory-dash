import { createHash, timingSafeEqual } from "node:crypto";
import express, { Router } from "express";
import type { RequestHandler } from "express";
import { DeliveryIngestResponseSchema, DeliverySnapshotSchema, endpoints } from "@satisfactory-dash/shared";
import type { DeliverySnapshot } from "@satisfactory-dash/shared";
import { clientIp } from "../../platform/clientIp.js";
import { BadRequestError, RateLimitedError, RouteNotFoundError, UnauthorizedError } from "../../platform/errorResponse.js";
import { ConfigError } from "../../platform/errors.js";
import { routePath } from "../../platform/routePath.js";
import { sendValidated } from "../../platform/sendValidated.js";
import { UserRateLimiter } from "../../platform/userRateLimiter.js";

/**
 * ADR-0056 section 4 (PR 6b): `POST /api/internal/metrics/delivery`, the daily delivery snapshot pushed by a workflow.
 *
 * - The backend holds no GitHub token and not even the secret: only `METRICS_INGEST_SECRET_SHA256`, the hex SHA-256 of
 *   the bearer secret. A request's `Authorization: Bearer <secret>` is hashed and compared with `timingSafeEqual`.
 * - Unset means the feature is off: the route answers the same 404 as an unknown /api path, so it says nothing.
 * - 401 for a missing, malformed or wrong secret (one message for all), 413 over 16 KB, 400 for a body the shared
 *   strict schema refuses, 429 past the limits. Its only power is adding one snapshot row.
 * - The secret and the header are never logged: the request logger redacts `authorization`, and nothing here logs.
 */
export const METRICS_INGEST_SECRET_ENV = "METRICS_INGEST_SECRET_SHA256";

/** The body cap (ADR-0056 section 4). A real snapshot is about 2 KB. */
export const DELIVERY_INGEST_BODY_LIMIT = "16kb";
/** Accepted (authenticated) pushes, across the process: the workflow pushes once a day (ADR-0056 section 4, Q3). */
export const DELIVERY_INGEST_PER_HOUR = 10;
/** Every attempt from one client address, before the secret is checked: noise control, not the protection (the secret is). */
export const DELIVERY_INGEST_ATTEMPTS_PER_NETWORK_PER_HOUR = 30;

const HOUR_MS = 60 * 60 * 1000;
// RFC 6750's b64token, 32 to 512 characters: a shorter secret can never match, so a weak one cannot be configured into use.
const BEARER = /^Bearer ([A-Za-z0-9\-._~+/]{32,512}=*)$/;
const UNAUTHORIZED_MESSAGE = "The ingest secret is missing or not valid";
const DIGEST_HEX = /^[0-9a-f]{64}$/;

export interface DeliveryIngestConfig {
  /** The SHA-256 of the bearer secret (32 bytes). */
  secretSha256: Buffer;
}

/** `METRICS_INGEST_SECRET_SHA256`: unset or blank means off (`undefined`); otherwise exactly 64 hex digits, or a ConfigError. */
export function loadDeliveryIngestConfig(env: Record<string, string | undefined>): DeliveryIngestConfig | undefined {
  const text = env[METRICS_INGEST_SECRET_ENV]?.trim().toLowerCase();
  if (!text) return undefined;
  if (!DIGEST_HEX.test(text)) {
    // Never echo the value: it is only a hash, but a pasted secret by mistake must not reach a log.
    throw new ConfigError(`${METRICS_INGEST_SECRET_ENV} must be the hex SHA-256 of the ingest secret (64 hex digits), or unset to turn the ingest off.`);
  }
  return { secretSha256: Buffer.from(text, "hex") };
}

/** True when `header` carries a bearer secret whose SHA-256 equals `expected`, compared in constant time. */
export function bearerMatches(header: unknown, expected: Buffer): boolean {
  const match = typeof header === "string" ? BEARER.exec(header) : null;
  if (!match) return false;
  const presented = createHash("sha256").update(match[1]!, "utf8").digest();
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

export interface DeliveryIngestRouterOptions {
  /** Undefined when `METRICS_INGEST_SECRET_SHA256` is unset: the route is off (404). */
  config: DeliveryIngestConfig | undefined;
  /** Stores a validated snapshot; undefined without a database (the route is off, 404). */
  store: ((snapshot: DeliverySnapshot) => Promise<void>) | undefined;
  attemptLimiter?: UserRateLimiter;
  acceptLimiter?: UserRateLimiter;
}

/** Mount with the public /api routers (before the session guard): the workflow has a secret, not a session. */
export function createDeliveryIngestRouter(options: DeliveryIngestRouterOptions): Router {
  const { config, store } = options;
  const attemptLimiter = options.attemptLimiter ?? new UserRateLimiter({ max: DELIVERY_INGEST_ATTEMPTS_PER_NETWORK_PER_HOUR, windowMs: HOUR_MS });
  const acceptLimiter = options.acceptLimiter ?? new UserRateLimiter({ max: DELIVERY_INGEST_PER_HOUR, windowMs: HOUR_MS });

  const enabled: RequestHandler = (_req, _res, next) => {
    if (!config || !store) throw new RouteNotFoundError();
    next();
  };
  const attempts: RequestHandler = (req, _res, next) => {
    const wait = attemptLimiter.hit(clientIp(req));
    if (wait > 0) throw new RateLimitedError(wait, "Too many requests. Try again later.");
    next();
  };
  const authenticated: RequestHandler = (req, _res, next) => {
    if (!bearerMatches(req.headers.authorization, config!.secretSha256)) throw new UnauthorizedError(UNAUTHORIZED_MESSAGE);
    next();
  };
  const accepted: RequestHandler = (_req, _res, next) => {
    const wait = acceptLimiter.hit("delivery");
    if (wait > 0) throw new RateLimitedError(wait, "Too many delivery snapshots. Try again later.");
    next();
  };

  const router = Router();
  const { deliveryIngest } = endpoints.metrics;
  // app.ts skips its own /api JSON parser for this path, so the body is read only after the secret checks out.
  router.post(
    routePath(deliveryIngest.route),
    enabled,
    attempts,
    authenticated,
    accepted,
    express.json({ limit: DELIVERY_INGEST_BODY_LIMIT }),
    async (req, res) => {
      const parsed = DeliverySnapshotSchema.safeParse(req.body);
      // Never echo the body or zod's message: a generic reason is enough for a workflow's log.
      if (!parsed.success) throw new BadRequestError("Invalid request: the body is not a schemaVersion 2 delivery snapshot");
      await store!(parsed.data);
      sendValidated(res, DeliveryIngestResponseSchema, { ok: true });
    },
  );
  return router;
}
