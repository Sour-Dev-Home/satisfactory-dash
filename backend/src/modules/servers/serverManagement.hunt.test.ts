import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { RequestHandler } from "express";
import { createApp } from "../../app.js";
import { createLogger } from "../../platform/logger.js";
import { InMemoryServerDirectory } from "./serverDirectory.js";
import { createServerManagementRouters } from "./serverManagementRouter.js";
import { createServersRouter } from "./serversRouter.js";
import type { ServerManagementService } from "./serverManagement.js";
import { isAllowedAddress, isLoopbackAddress, resolveAllowedAddress } from "./addressGuard.js";

const guard: RequestHandler = (req, res, next) => {
  res.locals.user = { id: req.header("x-test-user") ?? "op", name: "x" };
  next();
};

function app() {
  const service = {
    canManage: (id: string) => id === "op",
    create: vi.fn(async () => {
      throw new Error("must not be reached");
    }),
    get: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    testCandidate: vi.fn(),
    testSaved: vi.fn(),
  } as unknown as ServerManagementService;
  const m = createServerManagementRouters(service);
  const directory = new InMemoryServerDirectory([{ id: "home", displayName: "Home", services: {} }]);
  const access = {
    getRole: async (id: string) => (id === "home" ? ("viewer" as const) : undefined),
    listForUser: async () => [],
  };
  return {
    service,
    app: createApp({
      logger: createLogger({ level: "silent" }, { write: () => {} }),
      routers: [],
      sessionGuard: guard,
      protectedRouters: [m.collection, createServersRouter(directory, access), m.scoped],
    }),
  };
}

const good = { id: "alt", displayName: "Alt", host: "192.168.1.30", apiPort: 7777, frmPort: 8080, apiToken: "tok" };

describe("management request validation holes", () => {
  it.each([
    ["__proto__ key", '{"__proto__":{"x":1},"id":"alt","displayName":"A","host":"127.0.0.1","apiPort":1,"frmPort":2,"apiToken":"t"}'],
    ["constructor key", JSON.stringify({ ...good, constructor: { prototype: {} } })],
    ["reserved id", JSON.stringify({ ...good, id: "test-connection" })],
    ["host with userinfo", JSON.stringify({ ...good, host: "a@b" })],
    ["host with a zone id", JSON.stringify({ ...good, host: "fe80::1%eth0" })],
    ["float port", JSON.stringify({ ...good, apiPort: 7777.5 })],
    ["string port", JSON.stringify({ ...good, apiPort: "7777" })],
    ["token with a newline", JSON.stringify({ ...good, apiToken: "a\nb" })],
    ["null api token", JSON.stringify({ ...good, apiToken: null })],
    ["null frm token on create", JSON.stringify({ ...good, frmToken: null })],
    ["oversized body", JSON.stringify({ ...good, apiToken: "a".repeat(200_000) })],
  ])("create refuses %s with a 4xx and never reaches the service", async (_name, body) => {
    const { app: a, service } = app();
    const res = await request(a).post("/api/servers").set("x-test-user", "op").set("Content-Type", "application/json").send(body);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(service.create).not.toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toContain("a".repeat(50));
  });

  it("a validation error never echoes a token value", async () => {
    const { app: a } = app();
    const res = await request(a)
      .post("/api/servers")
      .set("x-test-user", "op")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ ...good, apiToken: "SECRET TOKEN WITH SPACES", extra: "SECRET-EXTRA" }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain("SECRET TOKEN");
  });

  it("a malformed JSON body does not echo its content", async () => {
    const { app: a } = app();
    const res = await request(a)
      .post("/api/servers")
      .set("x-test-user", "op")
      .set("Content-Type", "application/json")
      .send('{"apiToken":"LEAKME-123",');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain("LEAKME");
  });

  it("PATCH and DELETE on a server the caller is a mere viewer of are 403 for a non-operator, and 404 for a non-member", async () => {
    const { app: a, service } = app();
    for (const method of ["patch", "delete"] as const) {
      const viewer = await request(a)[method]("/api/servers/home").set("x-test-user", "someone").set("Content-Type", "application/json").send("{}");
      expect(viewer.status).toBe(403);
      const stranger = await request(a)[method]("/api/servers/nope").set("x-test-user", "someone").set("Content-Type", "application/json").send("{}");
      expect(stranger.status).toBe(404);
    }
    expect(service.update).not.toHaveBeenCalled();
    expect(service.remove).not.toHaveBeenCalled();
  });
});

describe("address guard edge cases", () => {
  it.each(["::", "::ffff:8.8.8.8", "::ffff:169.254.169.254", "0:0:0:0:0:0:0:2", "fe80::1", "fc00::1", "100.64.0.1", "172.32.0.1", "172.15.0.1", "192.169.0.1", "0.0.0.0", "255.255.255.255", "224.0.0.1", "64:ff9b::7f00:1", "::127.0.0.1", "::7f00:1"])(
    "refuses %s",
    (address) => {
      expect(isAllowedAddress(address)).toBe(false);
    },
  );
  it.each(["127.0.0.1", "127.255.255.254", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.1", "::1", "0:0:0:0:0:0:0:1", "::ffff:10.0.0.1", "::ffff:7f00:1"])(
    "allows %s",
    (address) => {
      expect(isAllowedAddress(address)).toBe(true);
    },
  );
  it("loopback only for 127/8, ::1 and mapped 127", () => {
    expect(isLoopbackAddress("::ffff:127.0.0.5")).toBe(true);
    expect(isLoopbackAddress("10.0.0.1")).toBe(false);
    expect(isLoopbackAddress("::ffff:10.0.0.1")).toBe(false);
  });
  it("one bad address among good ones refuses the host, and an empty answer does too", async () => {
    await expect(resolveAllowedAddress("h", async () => ["10.0.0.1", "8.8.8.8"])).rejects.toThrow();
    await expect(resolveAllowedAddress("h", async () => [])).rejects.toThrow();
    await expect(resolveAllowedAddress("[::1]")).resolves.toBe("::1");
    await expect(resolveAllowedAddress("h", async () => ["::1", "10.0.0.2"])).resolves.toBe("10.0.0.2");
  });
});
