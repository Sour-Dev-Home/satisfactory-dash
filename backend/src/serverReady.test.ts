import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { hashPassword } from "./modules/identity/passwordHash.js";

// ADR-0025 PR 2, checked against the real wiring: /api/health stays liveness whatever the
// database does, and /api/health/ready is 200 with no database configured (today's deploy) and
// 503 while a configured database has not been reached yet (under NODE_ENV=test nothing listens
// and nothing connects, so it stays "not started").

async function loadApp(): Promise<Express> {
  vi.resetModules();
  return (await import("./server.js")).app;
}

beforeAll(async () => {
  process.env.SATISFACTORY_SERVER_HOST = "localhost";
  process.env.SATISFACTORY_API_PORT = "1";
  process.env.FRM_WEB_PORT = "1";
  process.env.SATISFACTORY_REQUEST_TIMEOUT_MS = "2000";
  process.env.DASHBOARD_ADMIN_USER = "operator";
  process.env.DASHBOARD_ADMIN_PASSWORD_HASH = await hashPassword("server-ready-test-password");
  process.env.SESSION_SECRET = "server-ready-session-secret-0123456789abcdef";
  process.env.CORS_ALLOWED_ORIGINS = "";
}, 30_000);

afterEach(() => {
  delete process.env.DATABASE_URL;
});

describe("health endpoints in the real wiring", () => {
  it("without DATABASE_URL: liveness ok and readiness 200 (nothing to wait for)", async () => {
    const app = await loadApp();
    expect((await request(app).get("/api/health")).body).toEqual({ status: "ok" });
    const ready = await request(app).get("/api/health/ready");
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ status: "ok" });
  }, 30_000);

  it("with DATABASE_URL set but not yet connected: liveness ok, readiness 503 with no detail", async () => {
    process.env.DATABASE_URL = "postgres://satis_app:hunter2@127.0.0.1:1/satis";
    const app = await loadApp();
    expect((await request(app).get("/api/health")).status).toBe(200);
    const ready = await request(app).get("/api/health/ready");
    expect(ready.status).toBe(503);
    expect(ready.body).toEqual({ status: "unavailable" });
    expect(JSON.stringify(ready.body)).not.toMatch(/hunter2|127\.0\.0\.1/);
  }, 30_000);

  it("readiness needs no session (it is public, like liveness)", async () => {
    const app = await loadApp();
    expect((await request(app).get("/api/health/ready")).status).not.toBe(401);
  }, 30_000);
});
