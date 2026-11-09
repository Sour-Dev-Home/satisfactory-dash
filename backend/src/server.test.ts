import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { hashPassword } from "./modules/identity/passwordHash.js";

let app: Express;
/** Session cookie for the real wiring's protected routes (ADR-0011). */
let session: string;
const PASSWORD = "server-test-password";

/** A port that nothing listens on, on ::1 or 127.0.0.1. A fixed privileged port, never a released ephemeral one:
 *  supertest binds ephemeral ports for every request in every parallel test file, and one took a released port and
 *  answered the "game server" with a 404 (Dependabot PR #611's run). The OS never hands out port 1 as ephemeral. */
const CLOSED_PORT = 1;

// server.ts reads its config when imported, so pin every setting first. The retired game-server variables are still set
// (to a closed port) to prove they are ignored: no server is built from them (ADR-0066). server.ts also loads
// backend/.env, but dotenv never overrides a variable that's already set, so setting them here keeps a developer's local
// .env out of the test (found by PR #20's review).
beforeAll(async () => {
  const port = String(CLOSED_PORT);
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

  // ADR-0044: web push lives in the database (subscriptions, opt-ins), so without DATABASE_URL none of its routes exist:
  // a signed-in user gets the app's unmatched-route 404, never a half-working endpoint.
  it.each(["/api/push/config", "/api/servers/default/alerts/push"])("does not mount the push route %s without a database", async (path) => {
    const res = await request(app).get(path).set("Cookie", session);
    expect(res.status).toBe(404);
  });
});

// ADR-0066 build PR 5: the game-server settings above are ignored now. Without a database the backend builds no game
// server at all (servers come only from the database, and connect through the mod), so nothing is polled and every
// per-server route answers 404 server_not_found, never a 503 from a connection attempt.
describe("the real wiring without a database serves no game server", () => {
  it("lists no servers", async () => {
    const res = await request(app).get("/api/servers").set("Cookie", session);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("\"default\"");
  });

  it.each(["/api/servers/default/status", "/api/servers/default/factory", "/api/servers/default/power"])(
    "%s: answers 404 server_not_found, without trying the configured address",
    async (path) => {
      const res = await request(app).get(path).set("Cookie", session);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("server_not_found");
    },
  );
});
