import { describe, it, expect } from "vitest";
import request from "supertest";
import type { RequestHandler } from "express";
import { ApiErrorResponseSchema, ServerListResponseSchema, endpoints } from "@satisfactory-dash/shared";
import {
  factoryMixed,
  powerHistoryNormal,
  powerOutage,
  statusRunning,
} from "@satisfactory-dash/shared/fixtures";
import { createApp } from "./app.js";
import { createLogger } from "./platform/logger.js";
import { InMemoryServerDirectory, createServersRouter } from "./modules/servers/index.js";
import type { ServerAccess } from "./modules/servers/index.js";
import { createTelemetryRouters } from "./modules/telemetry/index.js";
import { createSettingsRouters } from "./modules/settings/index.js";
import { scopedEndpoints } from "../test-support/scopedEndpoints.js";
import type { Method } from "../test-support/scopedEndpoints.js";

/**
 * ADR-0025 PR 6: the IDOR tests are GENERATED from the shared `endpoints` list, so a new
 * server-scoped route is covered the moment it is added to the contract, and a route that is in
 * the contract but not mounted (or mounted outside the membership check) fails here instead of
 * shipping unguarded. The app is the real one: real telemetry and settings routers behind the
 * real membership middleware, with stub services and an in-memory membership table.
 */

const SCOPED = scopedEndpoints(endpoints);
const urlFor = (route: string, serverId: string) => route.replace(":serverId", serverId);

const OWNER = "user-owner";
const ADMIN = "user-admin";
const VIEWER = "user-viewer";
const OUTSIDER = "user-outsider"; // signed in, member of nothing
const ELSEWHERE = "user-elsewhere"; // a member of the other server only

const members: Record<string, Record<string, "owner" | "admin" | "viewer">> = {
  alpha: { [OWNER]: "owner", [ADMIN]: "admin", [VIEWER]: "viewer" },
  bravo: { [ELSEWHERE]: "owner" },
};

const access: ServerAccess = {
  getRole: async (publicId, userId) => members[publicId]?.[userId],
  listForUser: async (userId) =>
    Object.entries(members)
      .filter(([, roles]) => userId in roles)
      .map(([publicId, roles]) => ({ publicId, displayName: publicId, role: roles[userId]! })),
};

/** Stands in for the session guard: the test names the signed-in user in a header. */
const fakeGuard: RequestHandler = (req, res, next) => {
  const id = req.header("x-test-user");
  if (id === undefined) {
    res.status(401).json({ error: { code: "unauthorized", message: "Sign in to continue", requestId: "t" } });
    return;
  }
  res.locals.user = { id, name: id };
  next();
};

const services = {
  telemetry: {
    status: { getStatus: async () => statusRunning.data },
    production: { getFactoryOverview: async () => factoryMixed.data },
    power: { getPowerOverview: async () => powerOutage.data },
    powerHistory: {
      getPowerHistory: () => ({ data: powerHistoryNormal.data, observedAt: powerHistoryNormal.observedAt, stale: false }),
    },
    players: { getPlayers: async () => ({ available: true, players: [{ name: "Pioneer", online: true }] }) },
  },
  settings: {
    getSettings: async () => ({ autoPause: false, pending: false, editable: true }),
    setAutoPause: async (enabled: boolean) => ({ autoPause: enabled, pending: false, editable: true }),
  },
};

function buildApp(options: { isReady?: () => boolean } = {}) {
  // Both servers exist on this process: what differs is who belongs to them.
  const directory = new InMemoryServerDirectory([
    { id: "alpha", displayName: "Alpha", services },
    { id: "bravo", displayName: "Bravo", services },
  ]);
  return createApp({
    logger: createLogger({ level: "silent" }, { write: () => {} }),
    routers: [],
    sessionGuard: fakeGuard,
    protectedRouters: [
      createServersRouter(directory, access, options),
      ...createTelemetryRouters(directory),
      ...createSettingsRouters(directory),
    ],
  });
}

const call = (app: ReturnType<typeof buildApp>, method: Method, url: string, user: string) => {
  const req = request(app)[method.toLowerCase() as "get"](url).set("x-test-user", user);
  return method === "GET" ? req : req.set("Content-Type", "application/json").send(JSON.stringify({ enabled: true }));
};

describe("the shared contract has server-scoped endpoints to generate from", () => {
  it("finds reads and at least one write", () => {
    expect(SCOPED.length).toBeGreaterThanOrEqual(5);
    expect(SCOPED.some((e) => e.method !== "GET")).toBe(true);
  });
});

describe.each(SCOPED)("$method $route ($name)", ({ method, route }) => {
  const app = buildApp();

  it("a signed-in non-member gets the same 404 as an unknown server, so existence is not revealed", async () => {
    const real = await call(app, method, urlFor(route, "alpha"), OUTSIDER);
    const other = await call(app, method, urlFor(route, "alpha"), ELSEWHERE);
    const missing = await call(app, method, urlFor(route, "no-such-server"), OUTSIDER);
    for (const res of [real, other, missing]) {
      expect(res.status).toBe(404);
      expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("server_not_found");
    }
    expect(real.body.error.message).toBe(missing.body.error.message);
  });

  it("is refused without a session before any membership lookup", async () => {
    const res = await request(app)[method.toLowerCase() as "get"](urlFor(route, "alpha"));
    expect(res.status).toBe(401);
  });

  it("a malformed server id is a 400 for everyone", async () => {
    const res = await call(app, method, urlFor(route, "Bad_Id"), OWNER);
    expect(res.status).toBe(400);
  });

  if (method === "GET") {
    it.each([OWNER, ADMIN, VIEWER])("a member (%s) can read it", async (user) => {
      const res = await call(app, method, urlFor(route, "alpha"), user);
      expect(res.status).toBe(200);
    });
  } else {
    it("a viewer's write is a 403 forbidden, not a 404", async () => {
      const res = await call(app, method, urlFor(route, "alpha"), VIEWER);
      expect(res.status).toBe(403);
      expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("forbidden");
    });

    it.each([OWNER, ADMIN])("the %s can write", async (user) => {
      const res = await call(app, method, urlFor(route, "alpha"), user);
      expect(res.status).toBe(200);
    });
  }

  it("a role on one server grants nothing on another", async () => {
    // The owner of alpha is not a member of bravo.
    const res = await call(app, method, urlFor(route, "bravo"), OWNER);
    expect(res.status).toBe(404);
  });
});

describe("the per-user server list", () => {
  const app = buildApp();

  it("names only the servers the user belongs to", async () => {
    const mine = await request(app).get(endpoints.servers.path()).set("x-test-user", ELSEWHERE);
    expect(ServerListResponseSchema.parse(mine.body).servers.map((s) => s.id)).toEqual(["bravo"]);
    const nothing = await request(app).get(endpoints.servers.path()).set("x-test-user", OUTSIDER);
    expect(nothing.body.servers).toEqual([]);
  });
});

describe("a database outage is a 503, never a 404", () => {
  it("for the scoped routes and the list", async () => {
    const down = { ...access, getRole: () => Promise.reject(Object.assign(new Error("boom"), { code: "ECONNREFUSED" })) };
    const directory = new InMemoryServerDirectory([{ id: "alpha", displayName: "Alpha", services }]);
    const app = createApp({
      logger: createLogger({ level: "silent" }, { write: () => {} }),
      routers: [],
      sessionGuard: fakeGuard,
      protectedRouters: [createServersRouter(directory, down), ...createTelemetryRouters(directory)],
    });
    const res = await request(app).get(urlFor(endpoints.status.route, "alpha")).set("x-test-user", OWNER);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("service_unavailable");
  });

  it("while the configured servers are not yet registered", async () => {
    const app = buildApp({ isReady: () => false });
    const res = await request(app).get(urlFor(endpoints.status.route, "alpha")).set("x-test-user", OWNER);
    expect(res.status).toBe(503);
  });
});
