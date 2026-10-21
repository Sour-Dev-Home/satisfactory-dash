import { describe, it, expect } from "vitest";
import request from "supertest";
import { ServerListResponseSchema } from "@satisfactory-dash/shared";
import { createApp } from "../../app.js";
import { createLogger } from "../../platform/logger.js";
import { InMemoryServerDirectory } from "./serverDirectory.js";
import { createServersRouter } from "./serversRouter.js";
import type { ServerAccess } from "./serverAccess.js";

/** ADR-0046: the server list says whether self-serve is on, how each server was created, and whether it has enrolled. */

const access: ServerAccess = {
  getRole: async () => undefined,
  listForUser: async () => [
    { publicId: "op-server", displayName: "Operator", role: "viewer", id: "uuid-op", createdVia: "operator" },
    { publicId: "mine-done", displayName: "Done", role: "owner", id: "uuid-done", createdVia: "self_serve" },
    { publicId: "mine-new", displayName: "New", role: "owner", id: "uuid-new", createdVia: "self_serve" },
  ],
};

const directory = () =>
  new InMemoryServerDirectory([
    { id: "op-server", displayName: "Operator", services: {} },
    { id: "mine-done", displayName: "Done", services: {} },
    { id: "mine-new", displayName: "New", services: {} },
    { id: "not-mine", displayName: "Not mine", services: {} },
  ]);

function build(options: Parameters<typeof createServersRouter>[2]) {
  return createApp({
    logger: createLogger({ level: "silent" }, { write: () => {} }),
    routers: [],
    sessionGuard: (_req, res, next) => {
      res.locals.user = { id: "u1" };
      next();
    },
    protectedRouters: [createServersRouter(directory(), access, options)],
  });
}

async function list(options: Parameters<typeof createServersRouter>[2]) {
  const res = await request(build(options)).get("/api/servers");
  expect(res.status).toBe(200);
  return ServerListResponseSchema.parse(res.body);
}

describe("GET /api/servers, self-serve fields", () => {
  it("reports selfServeEnabled true and false, and omits it when the composition root does not say", async () => {
    expect((await list({ selfServeEnabled: true })).selfServeEnabled).toBe(true);
    expect((await list({ selfServeEnabled: false })).selfServeEnabled).toBe(false);
    expect("selfServeEnabled" in (await list({}))).toBe(false);
  });

  it("gives createdVia for every server the caller can see, and only those", async () => {
    const { servers } = await list({});
    expect(servers.map((s) => [s.id, s.createdVia])).toEqual([
      ["op-server", "operator"],
      ["mine-done", "self_serve"],
      ["mine-new", "self_serve"],
    ]);
  });

  it("marks enrolled from the injected lookup: enrolled vs pending, asked once with the visible internal ids", async () => {
    const asked: (readonly string[])[] = [];
    const { servers } = await list({
      enrolledServerIds: async (ids) => {
        asked.push(ids);
        return new Set(["uuid-op", "uuid-done"]);
      },
    });
    expect(servers.map((s) => [s.id, s.enrolled])).toEqual([
      ["op-server", true],
      ["mine-done", true],
      ["mine-new", false],
    ]);
    expect(asked).toEqual([["uuid-op", "uuid-done", "uuid-new"]]);
  });

  it("omits enrolled without the lookup, and never leaks the internal id", async () => {
    const res = await request(build({})).get("/api/servers");
    const servers = (res.body as { servers: Record<string, unknown>[] }).servers;
    expect(servers.every((s) => !("enrolled" in s))).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("uuid-");
  });

  it("answers 503 when the enrolled lookup fails with a database outage", async () => {
    const outage = new Error("Connection terminated unexpectedly");
    const res = await request(
      build({
        enrolledServerIds: async () => {
          throw outage;
        },
      }),
    ).get("/api/servers");
    expect(res.status).toBe(503);
  });
});
