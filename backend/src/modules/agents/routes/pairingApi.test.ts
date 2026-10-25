import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { ApiErrorResponseSchema, PairingPollResponseSchema, PairingStartResponseSchema } from "@satisfactory-dash/shared";
import { agentEnrollResponse, pairingPollRequest, pairingStartRequest, pairingStartResponse } from "@satisfactory-dash/shared/fixtures";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import { ServiceUnavailableError } from "../../../platform/errorResponse.js";
import { UserRateLimiter } from "../../../platform/userRateLimiter.js";
import type { PairingPollOutcome, PairingService } from "../services/pairingService.js";
import { createPairingApiRouter } from "./pairingApi.js";
import type { PairingApiDeps } from "./pairingApi.js";

function fakeService(overrides: Partial<PairingService> = {}): PairingService & { start: ReturnType<typeof vi.fn>; poll: ReturnType<typeof vi.fn> } {
  return {
    start: vi.fn(async () => pairingStartResponse),
    poll: vi.fn(async (): Promise<PairingPollOutcome> => ({ status: "pending" })),
    lookup: vi.fn(),
    approve: vi.fn(),
    ...overrides,
  } as never;
}

function build(service: PairingService, deps: Partial<PairingApiDeps> = {}) {
  return createApp({
    logger: createLogger({ level: "silent" }, { write: () => {} }),
    routers: [],
    agentRouters: [createPairingApiRouter({ service, ...deps })],
  });
}
const START = "/agent/v1/pairings";
const POLL = "/agent/v1/pairings/poll";
const json = (r: request.Test, body: unknown) => r.set("Content-Type", "application/json").send(JSON.stringify(body));
const codeOf = (res: request.Response) => ApiErrorResponseSchema.parse(res.body).error.code;

describe("POST /agent/v1/pairings (ADR-0051 section 1)", () => {
  it("answers 201 with the contract's shape and asks the service once", async () => {
    const service = fakeService();
    const res = await json(request(build(service)).post(START), pairingStartRequest);
    expect(res.status).toBe(201);
    expect(PairingStartResponseSchema.parse(res.body)).toEqual(pairingStartResponse);
    expect(service.start).toHaveBeenCalledWith(pairingStartRequest);
  });

  it("needs no credential and no session", async () => {
    const res = await json(request(build(fakeService())).post(START), { agentVersion: "0.1.0" });
    expect(res.status).toBe(201);
  });

  it("refuses a bad body with a fixed 400 that never echoes the input", async () => {
    const service = fakeService();
    for (const body of [{}, { agentVersion: "bad version!" }, { agentVersion: "0.1.0", extra: 1 }, { agentVersion: "0.1.0", serverName: "line\nbreak" }]) {
      const res = await json(request(build(service)).post(START), body);
      expect(res.status).toBe(400);
      expect(codeOf(res)).toBe("bad_request");
      expect(JSON.stringify(res.body)).not.toContain("line");
    }
    expect(service.start).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON (415) and an oversized one (413)", async () => {
    const app = build(fakeService());
    expect((await request(app).post(START).set("Content-Type", "text/plain").send("x")).status).toBe(415);
    expect((await json(request(app).post(START), { agentVersion: "0.1.0", serverName: "x".repeat(6000) })).status).toBe(413);
  });

  it("allows 6 an hour per network, then 429 with Retry-After", async () => {
    const app = build(fakeService());
    for (let i = 0; i < 6; i++) expect((await json(request(app).post(START), pairingStartRequest)).status).toBe(201);
    const res = await json(request(app).post(START), pairingStartRequest);
    expect(res.status).toBe(429);
    expect(codeOf(res)).toBe("rate_limited");
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("a network that is refused never spends the process-wide budget", async () => {
    const globalStartLimiter = new UserRateLimiter({ max: 7, windowMs: 3_600_000 });
    const app = build(fakeService(), { globalStartLimiter });
    for (let i = 0; i < 6; i++) await json(request(app).post(START), pairingStartRequest);
    for (let i = 0; i < 5; i++) expect((await json(request(app).post(START), pairingStartRequest)).status).toBe(429); // the network's own limit
    expect(globalStartLimiter.hit("all")).toBe(0); // the 7th of 7: nothing was spent by the five refusals
  });

  it("a process-wide refusal gives the network's hit back", async () => {
    const startLimiter = new UserRateLimiter({ max: 2, windowMs: 3_600_000 });
    const globalStartLimiter = new UserRateLimiter({ max: 1, windowMs: 3_600_000 });
    const refund = vi.spyOn(startLimiter, "refund");
    const app = build(fakeService(), { startLimiter, globalStartLimiter });
    expect((await json(request(app).post(START), pairingStartRequest)).status).toBe(201);
    expect((await json(request(app).post(START), pairingStartRequest)).status).toBe(429); // global
    expect((await json(request(app).post(START), pairingStartRequest)).status).toBe(429); // global again
    // Both refusals were the process-wide one, and each gave the network's hit back.
    expect(refund).toHaveBeenCalledTimes(2);
  });

  it("is 503 while the database is not available", async () => {
    const service = fakeService({ start: vi.fn(async () => { throw new ServiceUnavailableError(); }) });
    expect((await json(request(build(service)).post(START), pairingStartRequest)).status).toBe(503);
  });
});

describe("POST /agent/v1/pairings/poll", () => {
  it.each(["pending", "expired", "slow_down"] as const)("answers %s with 200 and only the status", async (status) => {
    const service = fakeService({ poll: vi.fn(async () => ({ status })) });
    const res = await json(request(build(service)).post(POLL), pairingPollRequest);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("answers approved with 201 and exactly enrol's credential shape", async () => {
    const service = fakeService({ poll: vi.fn(async () => ({ status: "approved" as const, ...agentEnrollResponse })) });
    const res = await json(request(build(service)).post(POLL), pairingPollRequest);
    expect(res.status).toBe(201);
    const parsed = PairingPollResponseSchema.parse(res.body);
    expect(parsed).toEqual({ status: "approved", ...agentEnrollResponse });
  });

  it("reads the secret from the BODY only: a query string or header is ignored", async () => {
    const service = fakeService();
    const res = await json(request(build(service)).post(`${POLL}?pairingSecret=${pairingPollRequest.pairingSecret}`).set("X-Pairing-Secret", pairingPollRequest.pairingSecret), {});
    expect(res.status).toBe(400);
    expect(service.poll).not.toHaveBeenCalled();
  });

  it("is 400 for a malformed secret or an extra field, and passes the secret to the service otherwise", async () => {
    const service = fakeService();
    const app = build(service);
    expect((await json(request(app).post(POLL), { pairingSecret: "short" })).status).toBe(400);
    expect((await json(request(app).post(POLL), { ...pairingPollRequest, more: 1 })).status).toBe(400);
    expect((await json(request(app).post(POLL), pairingPollRequest)).status).toBe(200);
    expect(service.poll).toHaveBeenCalledExactlyOnceWith(pairingPollRequest.pairingSecret);
  });

  it("is limited per network, 429 with Retry-After", async () => {
    const pollLimiter = new UserRateLimiter({ max: 3, windowMs: 60_000 });
    const app = build(fakeService(), { pollLimiter });
    for (let i = 0; i < 3; i++) expect((await json(request(app).post(POLL), pairingPollRequest)).status).toBe(200);
    const res = await json(request(app).post(POLL), pairingPollRequest);
    expect(res.status).toBe(429);
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
  });
});
