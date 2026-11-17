import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Express } from "express";

// ADR-0066 build PR 5: SATISFACTORY_SERVERS_FILE (ADR-0025 PR 1) is retired. The real wiring (server.ts) with a file
// naming two servers must build neither: servers come only from the database and connect through the mod.

let app: Express;
let dir: string;

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
  process.env.CORS_ALLOWED_ORIGINS = "";
  ({ app } = await import("./server.js"));
}, 30_000);

afterAll(() => {
  delete process.env.SATISFACTORY_SERVERS_FILE;
  rmSync(dir, { recursive: true, force: true });
});

// Without DATABASE_URL nobody can sign in since ADR-0025 PR 9, so the signed-in checks this file used to make (the list
// shows neither server, their routes answer 404 server_not_found) cannot run here. In database mode the server list
// comes only from the database: modules/servers/serverManagement.db.test.ts ("the managed list ...").
describe("a servers file is ignored (ADR-0066)", () => {
  it("the backend still boots with one set, and is healthy", async () => {
    expect((await request(app).get("/api/health")).status).toBe(200);
  });

  it.each(["alpha", "beta", "not-used"])("answers %s's routes with the plain 401, leaking no host or port", async (id) => {
    for (const route of ["status", "factory", "power", "power/history"]) {
      const res = await request(app).get(`/api/servers/${id}/${route}`);
      expect(res.status, `${id}/${route}`).toBe(401);
      expect(res.body.error.code).toBe("unauthorized");
      expect(JSON.stringify(res.body)).not.toMatch(/127\.0\.0\.1|localhost/);
    }
  });
});
