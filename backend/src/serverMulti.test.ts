import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import net from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Express } from "express";
import { hashPassword } from "./modules/identity/passwordHash.js";

// ADR-0025 PR 1: the real wiring (server.ts) with SATISFACTORY_SERVERS_FILE naming two servers.
// Each must get its own connection (proved by which closed port its connect failure names), its
// own telemetry bundle (each id answers on its own routes), and the list must show both.

let app: Express;
let session: string;
let dir: string;
const PASSWORD = "server-multi-test-password";

async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

const ports = { alpha: 0, beta: 0 };

beforeAll(async () => {
  ports.alpha = await closedPort();
  ports.beta = await closedPort();
  dir = mkdtempSync(path.join(tmpdir(), "servers-file-"));
  const file = path.join(dir, "servers.json");
  writeFileSync(
    file,
    JSON.stringify({
      servers: [
        { id: "alpha", name: "Alpha factory", host: "127.0.0.1", apiPort: ports.alpha, frmPort: ports.alpha },
        { id: "beta", name: "Beta factory", host: "127.0.0.1", apiPort: ports.beta, frmPort: ports.beta },
      ],
    }),
  );
  process.env.SATISFACTORY_SERVERS_FILE = file;
  // A stray single-server env must not matter once the file is set.
  process.env.SATISFACTORY_SERVER_ID = "not-used";
  process.env.SATISFACTORY_SERVER_HOST = "localhost";
  process.env.SATISFACTORY_API_PORT = "1";
  process.env.FRM_WEB_PORT = "1";
  process.env.SATISFACTORY_REQUEST_TIMEOUT_MS = "2000";
  process.env.SATISFACTORY_API_TOKEN = "";
  process.env.FRM_AUTH_TOKEN = "";
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

describe("two servers from SATISFACTORY_SERVERS_FILE", () => {
  it("lists both, with their display names and no host or port", async () => {
    const res = await request(app).get("/api/servers").set("Cookie", session);
    expect(res.status).toBe(200);
    const servers = res.body.data?.servers ?? res.body.servers ?? res.body.data;
    expect(servers).toEqual([
      expect.objectContaining({ id: "alpha", displayName: "Alpha factory" }),
      expect.objectContaining({ id: "beta", displayName: "Beta factory" }),
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/127\.0\.0\.1|localhost/);
  });

  it("gives each server its own connection: a failure names that server's port, not the other's", async () => {
    const alpha = await request(app).get("/api/servers/alpha/status").set("Cookie", session);
    const beta = await request(app).get("/api/servers/beta/status").set("Cookie", session);
    expect(alpha.status).toBe(503);
    expect(beta.status).toBe(503);
    expect(alpha.body.error.detail).toContain(`127.0.0.1:${ports.alpha}`);
    expect(alpha.body.error.detail).not.toContain(`:${ports.beta}`);
    expect(beta.body.error.detail).toContain(`127.0.0.1:${ports.beta}`);
    expect(beta.body.error.detail).not.toContain(`:${ports.alpha}`);
  });

  it("serves every data route per server, and answers an unlisted id with 404", async () => {
    for (const id of ["alpha", "beta"]) {
      for (const route of ["factory", "power", "power/history"]) {
        const res = await request(app).get(`/api/servers/${id}/${route}`).set("Cookie", session);
        expect(res.status, `${id}/${route}`).not.toBe(404);
      }
    }
    const missing = await request(app).get("/api/servers/not-used/status").set("Cookie", session);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("server_not_found");
  });
});
