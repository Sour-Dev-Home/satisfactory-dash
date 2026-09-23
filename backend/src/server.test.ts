import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import net from "node:net";
import type { Express } from "express";
import { hashPassword } from "./modules/identity/passwordHash.js";

let app: Express;
/** Session cookie for the real wiring's protected routes (ADR-0011). */
let session: string;
const PASSWORD = "server-test-password";

/** A port that nothing is listening on: bind an ephemeral port, then release it. No
 *  host, so it's reserved dual-stack (both ::1 and 127.0.0.1, which "localhost"
 *  resolves to). */
async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

// server.ts reads its config when imported, so pin every game-server setting first.
// These tests used to rely on nothing listening on the defaults (7777/8080) and failed
// on any machine running a real dedicated server. server.ts also loads backend/.env,
// but dotenv never overrides a variable that's already set, so setting all of them
// here keeps a developer's local .env out of the test (found by PR #20's review).
beforeAll(async () => {
  const port = String(await closedPort());
  // "localhost" resolves to both ::1 and 127.0.0.1, which is what produces the
  // AggregateError the detail test below checks.
  process.env.SATISFACTORY_SERVER_HOST = "localhost";
  process.env.SATISFACTORY_API_PORT = port;
  process.env.FRM_WEB_PORT = port;
  process.env.SATISFACTORY_REQUEST_TIMEOUT_MS = "2000";
  process.env.SATISFACTORY_API_TOKEN = "";
  process.env.FRM_AUTH_TOKEN = "";
  process.env.SATISFACTORY_API_REJECT_UNAUTHORIZED = "";
  // ADR-0011: the backend refuses to start without login settings.
  process.env.DASHBOARD_ADMIN_USER = "operator";
  process.env.DASHBOARD_ADMIN_PASSWORD_HASH = await hashPassword(PASSWORD);
  process.env.SESSION_SECRET = "server-test-session-secret-0123456789abcdef";
  process.env.CORS_ALLOWED_ORIGINS = "";
  ({ app } = await import("./server.js"));
  const res = await request(app)
    .post("/api/auth/login")
    .set("Content-Type", "application/json")
    .send(JSON.stringify({ username: "operator", password: PASSWORD }));
  session = [res.headers["set-cookie"]].flat()[0].split(";")[0];
});

describe("GET /api/health", () => {
  it("returns ok status", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

// ADR-0011, checked against the real wiring rather than a test pipeline.
describe("the real wiring requires a session", () => {
  it.each(["/api/servers", "/api/servers/default/status", "/api/servers/default/power"])(
    "answers %s with 401 when signed out",
    async (path) => {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("unauthorized");
    },
  );

  it("serves the server list once signed in", async () => {
    const res = await request(app).get("/api/servers").set("Cookie", session);
    expect(res.status).toBe(200);
  });
});

// These exercise the *real* wiring in server.ts end to end (real adapter -> real
// service -> real route), unlike routes/*.test.ts and services/*.test.ts, which each
// substitute a fixture/fake one layer down. Both game-server ports point at a closed
// port (see beforeAll above), so every one of these is expected to fail to connect — which is exactly the case this
// checks: that a real adapter connection failure propagates through the real service
// and is turned into a clean 503 by the route, rather than the request crashing,
// hanging, or an unhandled rejection escaping past Express's control flow.
describe("GET /api/servers/default/{status,factory,power} against an unreachable game server", () => {
  it("status: resolves 503 with an error body instead of hanging or crashing", async () => {
    const res = await request(app).get("/api/servers/default/status").set("Cookie", session);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ code: "upstream_unreachable" });
    expect(res.body.error).toHaveProperty("detail");
  });

  it("factory: resolves 503 with an error body instead of hanging or crashing", async () => {
    const res = await request(app).get("/api/servers/default/factory").set("Cookie", session);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ code: "upstream_unreachable" });
    expect(res.body.error).toHaveProperty("detail");
  });

  it("power: resolves 503 with an error body instead of hanging or crashing", async () => {
    const res = await request(app).get("/api/servers/default/power").set("Cookie", session);
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
    const res = await request(app).get("/api/servers/default/status").set("Cookie", session);
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
      const res = await request(app).get(path).set("Cookie", session);
      expect(res.body.error.message).toBe("Could not reach the Satisfactory dedicated server");
    },
  );
});
