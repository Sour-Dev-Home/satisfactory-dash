import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";

let app: Express;

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
  process.env.SATISFACTORY_SERVER_HOST = "localhost";
  process.env.SATISFACTORY_API_PORT = port;
  process.env.FRM_WEB_PORT = port;
  process.env.SATISFACTORY_REQUEST_TIMEOUT_MS = "2000";
  process.env.SATISFACTORY_API_TOKEN = "";
  process.env.FRM_AUTH_TOKEN = "";
  process.env.SATISFACTORY_API_REJECT_UNAUTHORIZED = "";
  // ADR-0025 PR 9: no password settings are needed (or read). The retired ones are set to junk to prove it.
  process.env.DASHBOARD_ADMIN_USER = "operator";
  process.env.DASHBOARD_ADMIN_PASSWORD_HASH = "retired-and-ignored";
  process.env.SESSION_SECRET = "short";
  process.env.CORS_ALLOWED_ORIGINS = "";
  ({ app } = await import("./server.js"));
});

describe("GET /api/health", () => {
  it("returns ok status", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

// ADR-0011, checked against the real wiring rather than a test pipeline. This file runs without DATABASE_URL, where
// (since ADR-0025 PR 9) nobody can sign in, so only the signed-out answers are checkable here. The signed-in server
// list in database mode is covered by modules/servers/serverManagement.db.test.ts ("the managed list ...").
describe("the real wiring requires a session", () => {
  it.each([
    "/api/servers",
    "/api/servers/default/status",
    "/api/servers/default/factory",
    "/api/servers/default/power",
    "/api/push/config",
  ])("answers %s with 401 when signed out", async (path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthorized");
  });
});

describe("the real wiring without a database offers no sign-in (ADR-0025 PR 9)", () => {
  it("GET /api/auth/session is signed out with no sign-in method", async () => {
    const res = await request(app).get("/api/auth/session");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: false, signInMethods: [] });
  });

  it("an old session cookie is signed out and cleared", async () => {
    const res = await request(app).get("/api/auth/session").set("Cookie", "sd_session=eyJzdWIiOiJvcGVyYXRvciJ9.c2ln");
    expect(res.body).toEqual({ authenticated: false, signInMethods: [] });
    expect([res.headers["set-cookie"]].flat().join("\n")).toMatch(/sd_session=;/);
    expect((await request(app).get("/api/servers").set("Cookie", "sd_session=eyJzdWIiOiJvcGVyYXRvciJ9.c2ln")).status).toBe(401);
  });

  it("password login is gone: POST /api/auth/login is an unknown route (401 to a visitor) and sets no cookie", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ username: "operator", password: "anything" }));
    expect(res.status).toBe(401);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });
});
