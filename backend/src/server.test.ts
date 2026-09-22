import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "./server.js";

describe("GET /api/health", () => {
  it("returns ok status", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

// These exercise the *real* wiring in server.ts end to end (real adapter -> real
// service -> real route), unlike routes/*.test.ts and services/*.test.ts, which each
// substitute a fixture/fake one layer down. Nothing in the .env-less test environment
// points at a live game server (config.ts defaults to localhost:7777 / :8080), so
// every one of these is expected to fail to connect — which is exactly the case this
// checks: that a real adapter connection failure propagates through the real service
// and is turned into a clean 503 by the route, rather than the request crashing,
// hanging, or an unhandled rejection escaping past Express's control flow.
describe("GET /api/status, /api/factory, /api/power against an unreachable game server", () => {
  it("status: resolves 503 with an error body instead of hanging or crashing", async () => {
    const res = await request(app).get("/api/status");
    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty("error");
    expect(res.body).toHaveProperty("detail");
  });

  it("factory: resolves 503 with an error body instead of hanging or crashing", async () => {
    const res = await request(app).get("/api/factory");
    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty("error");
    expect(res.body).toHaveProperty("detail");
  });

  it("power: resolves 503 with an error body instead of hanging or crashing", async () => {
    const res = await request(app).get("/api/power");
    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty("error");
    expect(res.body).toHaveProperty("detail");
  });

  // Documents a real gap found in this pass: the vanilla-API path (status route)
  // rejects with a bare Node `AggregateError` (from the dual-stack DNS/connect
  // failure inside `https.request`/Node's happy-eyeballs), and `String(err)` on an
  // AggregateError does not include the wrapped errors' messages the way it does for
  // a plain Error. So `/api/status`'s `detail` degrades to the literal string
  // "AggregateError" with none of the underlying "why" (contrast with /api/factory
  // and /api/power's `detail`, which retain the FRM endpoint name and cause via
  // FrmApiRequestError's message). Not a crash and not a contract violation — the
  // shared response shape doesn't promise anything about `detail`'s content — but it
  // is a real, previously-untested asymmetry in error-message usefulness across the
  // three routes. Flagged for the implementer rather than fixed here.
  it("status: detail degrades to a near-useless 'AggregateError' string on a real connect failure (documents a gap, not a hard requirement)", async () => {
    const res = await request(app).get("/api/status");
    expect(res.status).toBe(503);
    expect(typeof res.body.detail).toBe("string");
    expect(res.body.detail).toBe("AggregateError");
  });
});
