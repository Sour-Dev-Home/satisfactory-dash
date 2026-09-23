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
describe("GET /api/servers/default/{status,factory,power} against an unreachable game server", () => {
  it("status: resolves 503 with an error body instead of hanging or crashing", async () => {
    const res = await request(app).get("/api/servers/default/status");
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ code: "upstream_unreachable" });
    expect(res.body.error).toHaveProperty("detail");
  });

  it("factory: resolves 503 with an error body instead of hanging or crashing", async () => {
    const res = await request(app).get("/api/servers/default/factory");
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ code: "upstream_unreachable" });
    expect(res.body.error).toHaveProperty("detail");
  });

  it("power: resolves 503 with an error body instead of hanging or crashing", async () => {
    const res = await request(app).get("/api/servers/default/power");
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ code: "upstream_unreachable" });
    expect(res.body.error).toHaveProperty("detail");
  });

  // The vanilla-API path (status route) rejects with a Node `AggregateError` (from
  // the dual-stack DNS/connect failure inside `https.request`'s happy-eyeballs), which
  // used to make `detail` degrade to the bare, undiagnostic string "AggregateError"
  // since `String(err)` doesn't surface an AggregateError's wrapped `.errors` the way
  // it does a plain Error's `.message`. routes/formatErrorDetail.ts now unwraps it.
  // The transport now wraps it as the `.cause` of a VanillaApiRequestError tagged
  // `failureKind: "unreachable"`, so it appears inside a "(caused by: ...)" clause.
  it("status: detail includes the underlying connect failures, not a bare 'AggregateError' string", async () => {
    const res = await request(app).get("/api/servers/default/status");
    expect(res.status).toBe(503);
    expect(typeof res.body.error.detail).toBe("string");
    expect(res.body.error.detail).not.toBe("AggregateError");
    expect(res.body.error.detail).toMatch(/\(caused by: AggregateError \(.*ECONNREFUSED.*\)\)$/);
  });

  // A real refused connection, not a mock: confirms both transports classify it
  // as unreachable end to end, so the message isn't the neutral fallback.
  it.each(["/api/servers/default/status", "/api/servers/default/factory", "/api/servers/default/power"])(
    "%s: a refused connection is reported as unreachable",
    async (path) => {
      const res = await request(app).get(path);
      expect(res.body.error.message).toBe("Could not reach the Satisfactory dedicated server");
    },
  );
});
