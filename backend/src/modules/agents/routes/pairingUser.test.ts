import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { RequestHandler } from "express";
import { ApiErrorResponseSchema, CompatResponseSchema, PairingApproveResponseSchema, PairingLookupResponseSchema } from "@satisfactory-dash/shared";
import {
  pairingApproveRequestExisting,
  pairingApproveRequestNew,
  pairingApproveResponse,
  pairingLookupRequest,
  pairingLookupResponse,
} from "@satisfactory-dash/shared/fixtures";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import { UserRateLimiter } from "../../../platform/userRateLimiter.js";
import { pairingNotFound } from "../services/pairingService.js";
import type { PairingService } from "../services/pairingService.js";
import { createCompatRouter, createPairingUserRouter } from "./pairingUser.js";
import type { PairingUserRouterOptions } from "./pairingUser.js";

const OPERATOR = "op";
const guard: RequestHandler = (req, res, next) => {
  const id = req.header("x-test-user");
  if (id === undefined) {
    res.status(401).json({ error: { code: "unauthorized", message: "Sign in to continue", requestId: "t" } });
    return;
  }
  res.locals.user = { id, name: id };
  next();
};

function fakeService(overrides: Partial<PairingService> = {}) {
  return {
    start: vi.fn(),
    poll: vi.fn(),
    lookup: vi.fn(async () => pairingLookupResponse),
    approve: vi.fn(async () => pairingApproveResponse),
    ...overrides,
  } as PairingService & { lookup: ReturnType<typeof vi.fn>; approve: ReturnType<typeof vi.fn> };
}
function build(service: PairingService, options: Partial<PairingUserRouterOptions> = {}) {
  return createApp({
    logger: createLogger({ level: "silent" }, { write: () => {} }),
    routers: [],
    sessionGuard: guard,
    protectedRouters: [createPairingUserRouter(service, { isOperator: (id) => id === OPERATOR, ...options }), createCompatRouter()],
  });
}
const LOOKUP = "/api/pairings/lookup";
const APPROVE = "/api/pairings/approve";
const post = (app: ReturnType<typeof build>, path: string, user: string | undefined, body: unknown) => {
  let req = request(app).post(path);
  if (user !== undefined) req = req.set("x-test-user", user);
  return req.set("Content-Type", "application/json").send(JSON.stringify(body));
};
const codeOf = (res: request.Response) => ApiErrorResponseSchema.parse(res.body).error.code;
const notFound = () => vi.fn(async () => { throw pairingNotFound(); });

describe("POST /api/pairings/lookup", () => {
  it("is 401 without a session and never reaches the service", async () => {
    const service = fakeService();
    expect((await post(build(service), LOOKUP, undefined, pairingLookupRequest)).status).toBe(401);
    expect(service.lookup).not.toHaveBeenCalled();
  });

  it("answers with who is asking", async () => {
    const service = fakeService();
    const res = await post(build(service), LOOKUP, "player", pairingLookupRequest);
    expect(res.status).toBe(200);
    expect(PairingLookupResponseSchema.parse(res.body)).toEqual(pairingLookupResponse);
    expect(service.lookup).toHaveBeenCalledWith(pairingLookupRequest.userCode);
  });

  it("is a fixed 400 for a lower-case, malformed or extra-field body", async () => {
    const app = build(fakeService());
    for (const body of [{ userCode: "ab3d-7xq2-k5mn" }, { userCode: "nope" }, {}, { ...pairingLookupRequest, extra: 1 }]) {
      const res = await post(app, LOOKUP, "player", body);
      expect(res.status).toBe(400);
      expect(codeOf(res)).toBe("bad_request");
    }
  });

  it("an unknown, spent or expired code is the SAME 404 not_found, whatever the reason", async () => {
    const bodies = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const res = await post(build(fakeService({ lookup: notFound() })), LOOKUP, "player", pairingLookupRequest);
      expect(res.status).toBe(404);
      expect(codeOf(res)).toBe("not_found");
      bodies.add(JSON.stringify({ ...res.body, error: { ...res.body.error, requestId: "x" } }));
    }
    expect(bodies.size).toBe(1);
  });
});

describe("POST /api/pairings/approve", () => {
  it("is 401 without a session", async () => {
    const service = fakeService();
    expect((await post(build(service), APPROVE, undefined, pairingApproveRequestNew)).status).toBe(401);
    expect(service.approve).not.toHaveBeenCalled();
  });

  it("approves a new server and an existing one, passing the signed-in account", async () => {
    const service = fakeService();
    const app = build(service);
    for (const body of [pairingApproveRequestNew, pairingApproveRequestExisting]) {
      const res = await post(app, APPROVE, "player", body);
      expect(res.status).toBe(200);
      expect(PairingApproveResponseSchema.parse(res.body)).toEqual(pairingApproveResponse);
    }
    expect(service.approve).toHaveBeenNthCalledWith(1, "player", pairingApproveRequestNew);
    expect(service.approve).toHaveBeenNthCalledWith(2, "player", pairingApproveRequestExisting);
  });

  it("is 400 for a bad target, a bad server id or an unknown kind", async () => {
    const app = build(fakeService());
    for (const target of [{ kind: "other" }, { kind: "existing" }, { kind: "existing", serverId: "Not A Valid Id!" }, { kind: "new", serverId: "x" }]) {
      expect((await post(app, APPROVE, "player", { userCode: pairingLookupRequest.userCode, target })).status).toBe(400);
    }
  });

  it("a not-owned or unknown server, a bad code and a lost race are all the same 404 not_found body", async () => {
    const seen = new Set<string>();
    for (const body of [pairingApproveRequestNew, pairingApproveRequestExisting]) {
      const res = await post(build(fakeService({ approve: notFound() })), APPROVE, "player", body);
      expect(res.status).toBe(404);
      expect(codeOf(res)).toBe("not_found");
      seen.add(JSON.stringify({ ...res.body, error: { ...res.body.error, requestId: "x" } }));
    }
    expect(seen.size).toBe(1);
  });
});

describe("code entry limits (lookup and approve share them)", () => {
  it("10 tries a minute per account, hit or miss, then 429 with Retry-After; another account is unaffected", async () => {
    const service = fakeService({ lookup: notFound() });
    const app = build(service, { networkLimiter: new UserRateLimiter({ max: 1000, windowMs: 60_000 }) });
    for (let i = 0; i < 10; i++) expect((await post(app, LOOKUP, "player", pairingLookupRequest)).status).toBe(404);
    const res = await post(app, APPROVE, "player", pairingApproveRequestNew);
    expect(res.status).toBe(429);
    expect(codeOf(res)).toBe("rate_limited");
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    expect((await post(app, LOOKUP, "other", pairingLookupRequest)).status).toBe(404);
    expect(service.lookup).toHaveBeenCalledTimes(11);
  });

  it("20 tries an hour per account, even spread over minutes", async () => {
    let t = 0;
    const clock = () => t;
    const app = build(fakeService({ lookup: notFound() }), {
      minuteLimiter: new UserRateLimiter({ max: 10, windowMs: 60_000, now: clock }),
      hourlyLimiter: new UserRateLimiter({ max: 20, windowMs: 3_600_000, now: clock }),
      networkLimiter: new UserRateLimiter({ max: 1000, windowMs: 60_000, now: clock }),
    });
    for (let i = 0; i < 20; i++) {
      t = i * 61_000; // one per window of the minute limiter
      expect((await post(app, LOOKUP, "player", pairingLookupRequest)).status).toBe(404);
    }
    t = 20 * 61_000;
    expect((await post(app, LOOKUP, "player", pairingLookupRequest)).status).toBe(429);
  });

  it("the operator is exempt from the hourly limit but not the minute one", async () => {
    let t = 0;
    const clock = () => t;
    const app = build(fakeService({ lookup: notFound() }), {
      minuteLimiter: new UserRateLimiter({ max: 10, windowMs: 60_000, now: clock }),
      hourlyLimiter: new UserRateLimiter({ max: 2, windowMs: 3_600_000, now: clock }),
      networkLimiter: new UserRateLimiter({ max: 1000, windowMs: 60_000, now: clock }),
    });
    for (let i = 0; i < 5; i++) {
      t = i * 61_000;
      expect((await post(app, LOOKUP, OPERATOR, pairingLookupRequest)).status).toBe(404);
    }
    for (let i = 0; i < 10; i++) await post(app, LOOKUP, OPERATOR, pairingLookupRequest);
    expect((await post(app, LOOKUP, OPERATOR, pairingLookupRequest)).status).toBe(429);
  });

  it("an hourly refusal gives the minute slot back", async () => {
    const minuteLimiter = new UserRateLimiter({ max: 10, windowMs: 60_000 });
    const app = build(fakeService({ lookup: notFound() }), {
      minuteLimiter,
      hourlyLimiter: new UserRateLimiter({ max: 1, windowMs: 3_600_000 }),
      networkLimiter: new UserRateLimiter({ max: 1000, windowMs: 60_000 }),
    });
    await post(app, LOOKUP, "player", pairingLookupRequest);
    for (let i = 0; i < 5; i++) expect((await post(app, LOOKUP, "player", pairingLookupRequest)).status).toBe(429);
    // 1 allowed + 5 refused-and-refunded: the minute window holds 1, not 6.
    for (let i = 0; i < 9; i++) expect(minuteLimiter.hit("player")).toBe(0);
  });

  it("a network is limited across accounts (30 a minute)", async () => {
    const app = build(fakeService({ lookup: notFound() }), {
      minuteLimiter: new UserRateLimiter({ max: 1000, windowMs: 60_000 }),
      hourlyLimiter: new UserRateLimiter({ max: 1000, windowMs: 3_600_000 }),
      networkLimiter: new UserRateLimiter({ max: 3, windowMs: 60_000 }),
    });
    for (let i = 0; i < 3; i++) expect((await post(app, LOOKUP, `user-${i}`, pairingLookupRequest)).status).toBe(404);
    expect((await post(app, LOOKUP, "user-9", pairingLookupRequest)).status).toBe(429);
  });

  it("a malformed body still spends a try, so junk cannot probe for free", async () => {
    const app = build(fakeService(), { minuteLimiter: new UserRateLimiter({ max: 2, windowMs: 60_000 }) });
    expect((await post(app, LOOKUP, "player", {})).status).toBe(400);
    expect((await post(app, LOOKUP, "player", {})).status).toBe(400);
    expect((await post(app, LOOKUP, "player", pairingLookupRequest)).status).toBe(429);
  });

  it("is 503 while the servers are not loaded", async () => {
    const service = fakeService();
    expect((await post(build(service, { isReady: () => false }), LOOKUP, "player", pairingLookupRequest)).status).toBe(503);
    expect(service.lookup).not.toHaveBeenCalled();
  });
});

describe("GET /api/compat", () => {
  it("is 401 without a session and the contract's block with one", async () => {
    const app = build(fakeService());
    expect((await request(app).get("/api/compat")).status).toBe(401);
    const res = await request(app).get("/api/compat").set("x-test-user", "player");
    expect(res.status).toBe(200);
    const parsed = CompatResponseSchema.parse(res.body);
    expect(parsed.agent.advisories).toEqual([]);
    expect(parsed.mod.minSafe).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
