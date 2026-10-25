import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { RequestHandler } from "express";
import { ApiErrorResponseSchema, MetricsOverviewSchema } from "@satisfactory-dash/shared";
import { createApp } from "../../app.js";
import { createLogger } from "../../platform/logger.js";
import { UserRateLimiter } from "../../platform/userRateLimiter.js";
import { createMetricsRouter } from "./metricsRouter.js";
import { createMetricsService } from "./metricsService.js";
import type { MetricsService } from "./metricsService.js";

const OPERATOR = "op";
const MEMBER = "member";

const guard: RequestHandler = (req, res, next) => {
  const id = req.header("x-test-user");
  if (id === undefined) {
    res.status(401).json({ error: { code: "unauthorized", message: "Sign in to continue", requestId: "t" } });
    return;
  }
  // A display name and an email ride along on the session, as in production; none may reach the response.
  res.locals.user = { id, name: "Pat Example", email: "pat@example.test" };
  next();
};

const rows = (histRows: unknown[], counterRows: unknown[]) => ({
  query: vi.fn(async (sql: string) => ({ rows: sql.includes("unnest") ? histRows : counterRows })),
});

function build(service: MetricsService, options: { isReady?: () => boolean; limiter?: UserRateLimiter } = {}) {
  return createApp({
    logger: createLogger({ level: "silent" }, { write: () => {} }),
    routers: [],
    sessionGuard: guard,
    protectedRouters: [createMetricsRouter(service, { isOperator: (id) => id === OPERATOR, ...options })],
  });
}

const get = (app: ReturnType<typeof build>, url: string, user?: string) => {
  const req = request(app).get(url);
  return user === undefined ? req : req.set("x-test-user", user);
};

const seeded = () =>
  createMetricsService({
    db: rows(
      [{ metric: "poller.cycle.duration", labels: { server: "abc123", group: "fast" }, ord: 4, n: 3 }],
      [{ metric: "satis.agent.refused", labels: { server: "abc123", status: "401" }, total: 2 }],
    ),
    now: () => Date.parse("2026-10-25T10:30:00Z"),
  });

describe("GET /api/admin/metrics", () => {
  it("is 401 signed out and 403 for anyone but the operator, without touching the database", async () => {
    const db = rows([], []);
    const app = build(createMetricsService({ db }));
    expect((await get(app, "/api/admin/metrics")).status).toBe(401);
    const refused = await get(app, "/api/admin/metrics", MEMBER);
    expect(refused.status).toBe(403);
    expect(ApiErrorResponseSchema.parse(refused.body).error.code).toBe("forbidden");
    expect(db.query).not.toHaveBeenCalled();
  });

  it("is 503 until the servers are registered", async () => {
    const res = await get(build(seeded(), { isReady: () => false }), "/api/admin/metrics", OPERATOR);
    expect(res.status).toBe(503);
  });

  it("answers the operator with a contract-valid overview, defaulting to 24h", async () => {
    const res = await get(build(seeded()), "/api/admin/metrics", OPERATOR);
    expect(res.status).toBe(200);
    const body = MetricsOverviewSchema.parse(res.body);
    expect(body.window).toBe("24h");
    expect(body.system.available).toBe(true);
    expect(body.alerts).toEqual({ available: false, reason: "not_built" });
    expect(body.delivery).toEqual({ available: false, reason: "not_built" });
  });

  it.each(["1h", "24h", "7d"] as const)("accepts window=%s", async (window) => {
    const res = await get(build(seeded()), `/api/admin/metrics?window=${window}`, OPERATOR);
    expect(res.status).toBe(200);
    expect(res.body.window).toBe(window);
  });

  it.each(["30d", "", "24H", "1h&window=bad"])("refuses window=%s with 400", async (window) => {
    const res = await get(build(seeded()), `/api/admin/metrics?window=${window}`, OPERATOR);
    expect(res.status).toBe(400);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("bad_request");
  });

  it("carries public server ids only: no display name, owner or email, even from the session", async () => {
    const res = await get(build(seeded()), "/api/admin/metrics?window=7d", OPERATOR);
    const text = JSON.stringify(res.body);
    expect(text).toContain("abc123");
    for (const secret of ["Pat Example", "pat@example.test", OPERATOR]) expect(text).not.toContain(secret);
  });

  it("rate limits the operator, not a refused caller", async () => {
    const app = build(seeded(), { limiter: new UserRateLimiter({ max: 1, windowMs: 60_000 }) });
    expect((await get(app, "/api/admin/metrics", MEMBER)).status).toBe(403);
    expect((await get(app, "/api/admin/metrics", MEMBER)).status).toBe(403);
    expect((await get(app, "/api/admin/metrics", OPERATOR)).status).toBe(200);
    const limited = await get(app, "/api/admin/metrics", OPERATOR);
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
  });

  it("a database failure is the error envelope (the platform's 500), not a hang or a partial page", async () => {
    const db = { query: vi.fn(async () => { throw new Error("connection refused"); }) };
    const res = await get(build(createMetricsService({ db })), "/api/admin/metrics", OPERATOR);
    expect(res.status).toBe(500);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("internal");
  });
});
