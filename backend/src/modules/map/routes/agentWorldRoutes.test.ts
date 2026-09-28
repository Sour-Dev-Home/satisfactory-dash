import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { endpoints } from "@satisfactory-dash/shared";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import { UserRateLimiter } from "../../../platform/userRateLimiter.js";
import { createAgentWorldRouter } from "./agentWorldRoutes.js";
import type { WorldIngestPort } from "../services/worldIngestService.js";

/** Stands in for agents' real createAgentAuth: this route's own tests only need to know it was
 *  reached with SOME agent identity, not re-test credential lookup (that's agents' own test). */
function fakeAuth(publicId = "default") {
  return (_req: unknown, res: { locals: Record<string, unknown> }, next: () => void) => {
    res.locals.agent = { serverUuid: `uuid-${publicId}`, publicId };
    next();
  };
}

function build(overrides: { ingest?: WorldIngestPort; auth?: ReturnType<typeof fakeAuth>; worldLayerMaxBytes?: number; worldRateLimiter?: UserRateLimiter } = {}) {
  const ingest = overrides.ingest ?? { ingest: vi.fn(async () => ({ accepted: true as const, unchanged: false })) };
  const router = createAgentWorldRouter({
    auth: overrides.auth ?? fakeAuth(),
    ingest,
    worldLayerMaxBytes: overrides.worldLayerMaxBytes,
    worldRateLimiter: overrides.worldRateLimiter,
  });
  return { app: createApp({ logger: createLogger({ level: "silent" }), routers: [], agentRouters: [router] }), ingest };
}

const railBody = { observedAt: "2026-09-28T00:00:00.000Z", data: [{ id: "r1", points: [[0, 0], [1, 1]] }] };
/** Typed as a string; superagent then writes the bytes as they are (agentApi.test.ts's own convention) — needed so a
 *  gzip Buffer isn't re-serialized as JSON by supertest's default "application/json" serializer. */
const rawBody = (body: Buffer): string => body as unknown as string;

describe("POST /agent/v1/world/:layer", () => {
  it("accepts a valid body and forwards it to the ingest service, keyed by the agent's own publicId and the URL's layer", async () => {
    const { app, ingest } = build({ auth: fakeAuth("srv-9") });
    const res = await request(app).post(endpoints.agentApi.world.path("rails")).send(railBody);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accepted: true, unchanged: false });
    expect(ingest.ingest).toHaveBeenCalledWith("srv-9", "rails", railBody);
  });

  it("an unknown layer is a 400, never reaching the ingest service", async () => {
    const { app, ingest } = build();
    const res = await request(app).post(endpoints.agentApi.world.path("belts")).send(railBody);
    expect(res.status).toBe(400);
    expect(ingest.ingest).not.toHaveBeenCalled();
  });

  it("a body missing observedAt or data is a 400 with a fixed message, not the schema's issues", async () => {
    const { app } = build();
    const res = await request(app).post(endpoints.agentApi.world.path("rails")).send({ data: [] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).not.toMatch(/observedAt/);
  });

  it("accepts a gzip-encoded body", async () => {
    const { app, ingest } = build();
    const res = await request(app)
      .post(endpoints.agentApi.world.path("rails"))
      .set("Content-Type", "application/json")
      .set("Content-Encoding", "gzip")
      .serialize(rawBody)
      .send(gzipSync(Buffer.from(JSON.stringify(railBody))));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(ingest.ingest).toHaveBeenCalledWith("default", "rails", railBody);
  });

  it("a decompressed body over the byte cap is 413, not truncated (byte cap != item-count truncation)", async () => {
    const { app, ingest } = build({ worldLayerMaxBytes: 50 }); // the plain body below is 85 bytes
    const res = await request(app).post(endpoints.agentApi.world.path("rails")).send(railBody);
    expect(res.status).toBe(413);
    expect(ingest.ingest).not.toHaveBeenCalled();
  });

  it("without a valid agent credential (auth rejects), never reaches the ingest service", async () => {
    const rejecting = (_req: unknown, _res: unknown, next: (err?: Error) => void) => next(new Error("unauthorized"));
    const { app, ingest } = build({ auth: rejecting as unknown as ReturnType<typeof fakeAuth> });
    await request(app).post(endpoints.agentApi.world.path("rails")).send(railBody);
    expect(ingest.ingest).not.toHaveBeenCalled();
  });

  // Found by test-hunter (PR #374): the route's body check originally only asserted
  // `typeof observedAt === "string"`, never its FORMAT — a non-ISO string would sail through and
  // reach `WorldIngestPort.ingest` unmodified, to be written as `$4::timestamptz` by
  // worldLayerRepository.ts's UPSERT_IF_CHANGED, which would throw at the database instead of
  // answering a clean 400 — rejecting the WHOLE ingest, contrary to this module's own
  // "conform, don't reject" rule for everything else in the same body. Fixed by validating against
  // the now-exported `IsoTimeSchema` (packages/shared/src/map.ts) before calling ingest.
  it("a non-ISO observedAt is a 400, never forwarded to the ingest service", async () => {
    const { app, ingest } = build();
    const res = await request(app)
      .post(endpoints.agentApi.world.path("rails"))
      .send({ ...railBody, observedAt: "not-a-real-timestamp" });
    expect(res.status).toBe(400);
    expect(ingest.ingest).not.toHaveBeenCalled();
  });

  // Architect review, PR #374: unlike the snapshot route (agentApi.ts's snapshotRateLimit), this
  // route had no per-credential rate limit — a valid credential could loop 2 MB bodies, each a
  // potential 2 MB jsonb upsert. Per credential (serverUuid), across every layer, default 20/10 min.
  describe("per-credential rate limit (architect review, PR #374)", () => {
    it("the 21st request in the window is 429, with Retry-After; the 20th still succeeds", async () => {
      const { app, ingest } = build({ worldRateLimiter: new UserRateLimiter({ max: 20, windowMs: 10 * 60_000 }) });
      for (let i = 0; i < 20; i++) {
        const res = await request(app).post(endpoints.agentApi.world.path("rails")).send(railBody);
        expect(res.status, `request ${i + 1}`).toBe(200);
      }
      const res = await request(app).post(endpoints.agentApi.world.path("rails")).send(railBody);
      expect(res.status).toBe(429);
      expect(res.headers["retry-after"]).toBeTruthy();
      expect(ingest.ingest).toHaveBeenCalledTimes(20);
    });

    it("the limit is per credential, not global: a different agent's requests are unaffected", async () => {
      const limiter = new UserRateLimiter({ max: 1, windowMs: 10 * 60_000 });
      const { app: appA } = build({ auth: fakeAuth("srv-a"), worldRateLimiter: limiter });
      const { app: appB } = build({ auth: fakeAuth("srv-b"), worldRateLimiter: limiter });
      await request(appA).post(endpoints.agentApi.world.path("rails")).send(railBody);
      const blocked = await request(appA).post(endpoints.agentApi.world.path("rails")).send(railBody);
      expect(blocked.status).toBe(429);
      const other = await request(appB).post(endpoints.agentApi.world.path("rails")).send(railBody);
      expect(other.status).toBe(200);
    });

    it("counts across every layer, not per layer", async () => {
      const { app } = build({ worldRateLimiter: new UserRateLimiter({ max: 1, windowMs: 10 * 60_000 }) });
      await request(app).post(endpoints.agentApi.world.path("rails")).send(railBody);
      const res = await request(app).post(endpoints.agentApi.world.path("resourceNodes")).send({ observedAt: railBody.observedAt, data: [] });
      expect(res.status).toBe(429);
    });

    it("checks the rate limit before parsing the body: once past the limit, an over-cap body is still 429, not 413", async () => {
      const { app, ingest } = build({ worldRateLimiter: new UserRateLimiter({ max: 1, windowMs: 10 * 60_000 }), worldLayerMaxBytes: 1 });
      await request(app).post(endpoints.agentApi.world.path("rails")).send(railBody); // consumes the one allowed request (itself over the 1-byte cap, but that's not what this asserts)
      const res = await request(app).post(endpoints.agentApi.world.path("rails")).send(railBody);
      expect(res.status).toBe(429);
      expect(ingest.ingest).not.toHaveBeenCalled();
    });
  });
});
