import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Express } from "express";
import { hashPassword } from "./modules/identity/passwordHash.js";

// ADR-0066 build PR 5: SATISFACTORY_SERVERS_FILE (ADR-0025 PR 1) is retired. The real wiring (server.ts) with a file
// naming two servers must build neither: servers come only from the database and connect through the mod.

let app: Express;
let session: string;
let dir: string;
const PASSWORD = "server-multi-test-password";

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "servers-file-"));
  const file = path.join(dir, "servers.json");
  writeFileSync(
    file,
    JSON.stringify({
      servers: [
        { id: "alpha", name: "Alpha factory", host: "127.0.0.1", apiPort: 1, frmPort: 1 },
        { id: "beta", name: "Beta factory", host: "127.0.0.1", apiPort: 9, frmPort: 9 },
      ],
    }),
  );
  process.env.SATISFACTORY_SERVERS_FILE = file;
  process.env.SATISFACTORY_SERVER_ID = "not-used";
  process.env.SATISFACTORY_SERVER_HOST = "localhost";
  process.env.SATISFACTORY_API_PORT = "1";
  process.env.FRM_WEB_PORT = "1";
  process.env.DASHBOARD_ADMIN_USER = "operator";
  process.env.DASHBOARD_ADMIN_PASSWORD_HASH = await hashPassword(PASSWORD);
  process.env.SESSION_SECRET = "server-multi-session-secret-0123456789abcdef";
  process.env.CORS_ALLOWED_ORIGINS = "";
  ({ app } = await import("./server.js"));
  const res = await request(app)
    .post("/api/auth/login")
    .set("Content-Type", "application/json")
    .send(JSON.stringify({ username: "operator", password: PASSWORD }));
  session = [res.headers["set-cookie"]].flat()[0].split(";")[0];
}, 30_000);

afterAll(() => {
  delete process.env.SATISFACTORY_SERVERS_FILE;
  rmSync(dir, { recursive: true, force: true });
});

describe("a servers file is ignored (ADR-0066)", () => {
  it("lists neither server, and leaks no host or port", async () => {
    const res = await request(app).get("/api/servers").set("Cookie", session);
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/alpha|beta|not-used/);
    expect(text).not.toMatch(/127\.0\.0\.1|localhost/);
  });

  it.each(["alpha", "beta", "not-used"])("answers %s's routes with 404 server_not_found", async (id) => {
    for (const route of ["status", "factory", "power", "power/history"]) {
      const res = await request(app).get(`/api/servers/${id}/${route}`).set("Cookie", session);
      expect(res.status, `${id}/${route}`).toBe(404);
      expect(res.body.error.code).toBe("server_not_found");
    }
  });
});
