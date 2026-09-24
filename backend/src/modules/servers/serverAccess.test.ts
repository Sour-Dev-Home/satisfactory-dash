import { describe, it, expect } from "vitest";
import request from "supertest";
import type { RequestHandler } from "express";
import { createApp } from "../../app.js";
import { createLogger } from "../../platform/logger.js";
import { InMemoryServerDirectory } from "./serverDirectory.js";
import { createServersRouter } from "./serversRouter.js";
import type { ServerAccess } from "./serverAccess.js";

/** Edge cases of the membership middleware: verbs, id spelling, outages, missing user. */

const roles: Record<string, Record<string, "owner" | "admin" | "viewer">> = {
  alpha: { own: "owner", adm: "admin", view: "viewer" },
};

let lookups = 0;
let failWith: unknown;
const access: ServerAccess = {
  getRole: async (publicId, userId) => {
    lookups += 1;
    if (failWith) throw failWith;
    return roles[publicId]?.[userId];
  },
  listForUser: async (userId) => {
    if (failWith) throw failWith;
    return Object.entries(roles)
      .filter(([, m]) => userId in m)
      .map(([publicId, m]) => ({ publicId, displayName: publicId, role: m[userId]! }));
  },
};

const guard =
  (mode: "header" | "nouser" | "baduser"): RequestHandler =>
  (req, res, next) => {
    if (mode === "nouser") return next();
    if (mode === "baduser") {
      res.locals.user = { id: 42 };
      return next();
    }
    res.locals.user = { id: req.header("x-test-user") ?? "nobody" };
    next();
  };

function build(mode: "header" | "nouser" | "baduser" = "header", isReady?: () => boolean) {
  const directory = new InMemoryServerDirectory([
    { id: "alpha", displayName: "Alpha", services: {} },
    { id: "ghost", displayName: "Ghost", services: {} }, // in the process, but nobody is a member
  ]);
  const scoped = (async (_req, res) => {
    res.json({ role: res.locals.serverRole });
  }) as RequestHandler;
  return createApp({
    logger: createLogger({ level: "silent" }, { write: () => {} }),
    routers: [],
    sessionGuard: guard(mode),
    protectedRouters: [
      createServersRouter(directory, access, isReady ? { isReady } : {}),
      (() => {
        const r = require_router();
        r.all("/servers/:serverId/thing", scoped);
        return r;
      })(),
    ],
  });
}

import { Router } from "express";
const require_router = () => Router();

const code = (res: request.Response) => (res.body as { error?: { code?: string } }).error?.code;

describe("createAuthorizeServer verbs", () => {
  const app = build();
  it("lets a viewer HEAD and OPTIONS but refuses every other verb with 403", async () => {
    expect((await request(app).head("/api/servers/alpha/thing").set("x-test-user", "view")).status).toBe(200);
    expect((await request(app).options("/api/servers/alpha/thing").set("x-test-user", "view")).status).toBe(200);
    for (const m of ["post", "put", "patch", "delete"] as const) {
      const res = await request(app)[m]("/api/servers/alpha/thing").set("x-test-user", "view");
      expect([m, res.status, code(res)]).toEqual([m, 403, "forbidden"]);
    }
  });
  it("lets owner and admin write", async () => {
    for (const u of ["own", "adm"]) {
      expect((await request(app).post("/api/servers/alpha/thing").set("x-test-user", u)).status).toBe(200);
    }
  });
  it("gives a non-member the 404 even for a write verb (no 403 that would confirm existence)", async () => {
    for (const path of ["alpha", "ghost", "nope"]) {
      const res = await request(app).delete(`/api/servers/${path}/thing`).set("x-test-user", "stranger");
      expect([res.status, code(res)]).toEqual([404, "server_not_found"]);
    }
  });
});

describe("createAuthorizeServer id spelling", () => {
  const app = build();
  it.each(["ALPHA", "Alpha", "alpha%2F..", "alpha%00", "alpha%20", "%61lpha%2F", "alpha..%2Fghost"])(
    "does not let %s reach a member's role on alpha",
    async (id) => {
      const res = await request(app).get(`/api/servers/${id}/thing`).set("x-test-user", "own");
      // Either rejected outright or 404, but never served with the owner role.
      expect(res.status === 400 || res.status === 404).toBe(true);
    },
  );
  it("an encoded but identical id (%61lpha) resolves to alpha, as its decoded form", async () => {
    const res = await request(app).get("/api/servers/%61lpha/thing").set("x-test-user", "own");
    expect(res.status).toBe(200);
  });
  it("a trailing slash on the scoped route is still checked", async () => {
    const res = await request(app).get("/api/servers/alpha/thing/").set("x-test-user", "stranger");
    expect(res.status).toBe(404);
  });
  it("a malformed percent escape is a client error, not a 500", async () => {
    const res = await request(app).get("/api/servers/%E0%A4%A/thing").set("x-test-user", "own");
    expect(res.status).toBeLessThan(500);
  });
});

describe("createAuthorizeServer preconditions and failures", () => {
  it("a missing res.locals.user is 401 with no membership lookup", async () => {
    lookups = 0;
    const res = await request(build("nouser")).get("/api/servers/alpha/thing");
    expect([res.status, code(res), lookups]).toEqual([401, "unauthorized", 0]);
  });
  it("a non-string user id is 401, never coerced into a lookup", async () => {
    lookups = 0;
    const res = await request(build("baduser")).get("/api/servers/alpha/thing");
    expect([res.status, lookups]).toEqual([401, 0]);
    expect((await request(build("baduser")).get("/api/servers")).status).toBe(401);
  });
  it("not-ready is 503 for members and non-members alike, with no lookup", async () => {
    lookups = 0;
    const app = build("header", () => false);
    for (const u of ["own", "stranger"]) {
      const res = await request(app).get("/api/servers/alpha/thing").set("x-test-user", u);
      expect([res.status, code(res)]).toEqual([503, "service_unavailable"]);
    }
    expect((await request(app).get("/api/servers").set("x-test-user", "own")).status).toBe(503);
    expect(lookups).toBe(0);
  });
  it("a database outage is 503, never 404, on the scoped route and the list", async () => {
    failWith = Object.assign(new Error("Connection terminated unexpectedly"), {});
    try {
      const app = build();
      expect((await request(app).get("/api/servers/alpha/thing").set("x-test-user", "own")).status).toBe(503);
      expect((await request(app).get("/api/servers").set("x-test-user", "own")).status).toBe(503);
    } finally {
      failWith = undefined;
    }
  });
  it("any other lookup failure is a 500, not a 404 or a 503", async () => {
    failWith = new Error("relation servers.server_members does not exist");
    try {
      const res = await request(build()).get("/api/servers/alpha/thing").set("x-test-user", "own");
      expect([res.status, code(res)]).toEqual([500, "internal"]);
    } finally {
      failWith = undefined;
    }
  });
  it("the list is the intersection of membership and the process directory", async () => {
    const orig = roles.beta;
    roles.beta = { own: "owner" }; // member of beta, but this process does not serve beta
    try {
      const res = await request(build()).get("/api/servers").set("x-test-user", "own");
      expect((res.body as { servers: { id: string }[] }).servers.map((s) => s.id)).toEqual(["alpha"]);
    } finally {
      if (orig) roles.beta = orig;
      else delete roles.beta;
    }
  });
});
