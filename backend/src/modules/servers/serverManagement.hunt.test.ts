import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { RequestHandler } from "express";
import { createApp } from "../../app.js";
import { createLogger } from "../../platform/logger.js";
import { InMemoryServerDirectory } from "./serverDirectory.js";
import { createServerManagementRouters } from "./serverManagementRouter.js";
import { createServersRouter } from "./serversRouter.js";
import type { ServerManagementService } from "./serverManagement.js";

const guard: RequestHandler = (req, res, next) => {
  res.locals.user = { id: req.header("x-test-user") ?? "op", name: "x" };
  next();
};

// ADR-0066 build PR 6: the direct-poll routes (create, update, ...) are deleted, and with them their body-validation and
// address-guard cases. What stays here is the management routes that remain.
function app() {
  const service = {
    canManage: (id: string) => id === "op",
    remove: vi.fn(),
    listAgentServers: vi.fn(),
    renameAgentServer: vi.fn(),
  };
  const m = createServerManagementRouters(service as ServerManagementService);
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

describe("management request validation holes", () => {
  it("a malformed JSON body does not echo its content", async () => {
    const { app: a } = app();
    const res = await request(a)
      .patch("/api/servers/home/name")
      .set("x-test-user", "op")
      .set("Content-Type", "application/json")
      .send('{"apiToken":"LEAKME-123",');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain("LEAKME");
  });

  it("rename and DELETE on a server the caller is a mere viewer of are 403 for a non-operator, and 404 for a non-member", async () => {
    const { app: a, service } = app();
    for (const [method, suffix] of [["patch", "/name"], ["delete", ""]] as const) {
      const viewer = await request(a)[method](`/api/servers/home${suffix}`).set("x-test-user", "someone").set("Content-Type", "application/json").send('{"displayName":"X"}');
      expect(viewer.status).toBe(403);
      const stranger = await request(a)[method](`/api/servers/nope${suffix}`).set("x-test-user", "someone").set("Content-Type", "application/json").send('{"displayName":"X"}');
      expect(stranger.status).toBe(404);
    }
    expect(service.renameAgentServer).not.toHaveBeenCalled();
    expect(service.remove).not.toHaveBeenCalled();
  });
});
