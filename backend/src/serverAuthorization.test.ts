import { describe, it, expect } from "vitest";
import request from "supertest";
import type { RequestHandler } from "express";
import { ApiErrorResponseSchema, ServerListResponseSchema, endpoints } from "@satisfactory-dash/shared";
import {
  alertCreateRuleRequest,
  alertDeleteDestinationResponse,
  alertDeleteRuleResponse,
  alertDestinationsConfigured,
  alertEventsPage,
  alertMuteClearedResponse,
  alertMuteSetResponse,
  alertPatchDiscordRequest,
  alertPutDiscordRequest,
  alertRuleCreated,
  alertRulesList,
  alertRuleUpdatedPresetDisabled,
  alertSendTestOk,
  alertSetMuteRequest,
  pushOptInRequest,
  alertStatusQuiet,
  alertUpdateRuleRequest,
  agentEnrollmentCodeResponse,
  commandPending,
  agentRevokeResponse,
  agentStatusEnrolled,
  factoryMixed,
  historyItems7d,
  historyPower24h,
  historyTransitions24h,
  powerHistoryNormal,
  powerOutage,
  statusRunning,
} from "@satisfactory-dash/shared/fixtures";
import { createApp } from "./app.js";
import { createLogger } from "./platform/logger.js";
import { InMemoryServerDirectory, createMembersRouter, createServerManagementRouters, createServersRouter } from "./modules/servers/index.js";
import type { MemberSelfService, ServerAccess, ServerManagementService } from "./modules/servers/index.js";
import { createTelemetryRouters } from "./modules/telemetry/index.js";
import { createSettingsRouters } from "./modules/settings/index.js";
import { createAlertsRouters, createPushRouters } from "./modules/alerts/index.js";
import type { AlertsService, PushService } from "./modules/alerts/index.js";
import { createAgentUserRouters } from "./modules/agents/index.js";
import type { AgentsService } from "./modules/agents/index.js";
import { MapLiveStore, createWorldRoutes } from "./modules/map/index.js";
import { scopedEndpoints } from "../test-support/scopedEndpoints.js";
import type { Method } from "../test-support/scopedEndpoints.js";

/**
 * ADR-0025 PR 6: the IDOR tests are GENERATED from the shared `endpoints` list, so a new
 * server-scoped route is covered the moment it is added to the contract, and a route that is in
 * the contract but not mounted (or mounted outside the membership check) fails here instead of
 * shipping unguarded. The app is the real one: real telemetry and settings routers behind the
 * real membership middleware, with stub services and an in-memory membership table.
 */

// ADR-0027 PR 7a added the alerts endpoints to the contract before their routes; PR 7b mounted them, so nothing about
// alerts is exempt any more and the generated tests cover all of them like every other scoped route.
// ADR-0031 PR 3 added the USER-facing agent routes (enrolment codes, agent status, revoke, a command's status) to the
// contract before their routes. PR 5a mounted the three agent ones and PR 5b the command's status (`GET
// /commands/:commandId`), so nothing is exempt any more: the generated tests cover every scoped route.
// ADR-0047 (#311 task 2a) added `members.leave` to the contract before its route; task 2b mounted it, so nothing is
// exempt again. Leave is a member's own write (`memberSelfService`), and the owner is refused with 409 would_orphan.
const SCOPED = scopedEndpoints(endpoints);
const RULE_ID = "3f0c2a1e-7b4d-4c8a-9e51-1a2b3c4d5e04";
const urlFor = (route: string, serverId: string) =>
  route.replace(":serverId", serverId).replace(":ruleId", RULE_ID).replace(":commandId", "cmd-1").replace(":layer", "rails");

const OWNER = "user-owner";
const ADMIN = "user-admin";
const VIEWER = "user-viewer";
const OUTSIDER = "user-outsider"; // signed in, member of nothing
const ELSEWHERE = "user-elsewhere"; // a member of the other server only
// ADR-0030: the seeded operator account. Deliberately only an ADMIN of alpha here, so the tests show that
// what makes a user allowed to manage servers is being the operator, not the role (the OWNER above is refused).
const OPERATOR = "user-operator";

// #526 (ADR-0046 section 1.8): "charlie" was created through self-serve (alpha and bravo by the operator). Its own members, so
// the generated tests above, which use alpha and bravo, are unchanged.
const SELF_SERVE_SERVER = "charlie";
const SS_OWNER = "user-ss-owner";
const SS_ADMIN = "user-ss-admin";
const SS_VIEWER = "user-ss-viewer";

const members: Record<string, Record<string, "owner" | "admin" | "viewer">> = {
  alpha: { [OWNER]: "owner", [ADMIN]: "admin", [VIEWER]: "viewer", [OPERATOR]: "admin" },
  bravo: { [ELSEWHERE]: "owner" },
  [SELF_SERVE_SERVER]: { [SS_OWNER]: "owner", [SS_ADMIN]: "admin", [SS_VIEWER]: "viewer" },
};

const connectionView = {
  id: "alpha",
  displayName: "Alpha",
  host: "192.168.1.20",
  apiPort: 7777,
  frmPort: 8080,
  apiTokenSet: true as const,
  apiTokenLast4: "1234",
  frmTokenSet: true,
  frmTokenLast4: "5678",
  state: "ok" as const,
  plainHttpOverLan: true,
};
const testPassed = { ok: true, api: { ok: true }, frm: { ok: true } };
const managementService: ServerManagementService = {
  canManage: (userId) => userId === OPERATOR,
  create: async () => connectionView,
  get: async () => connectionView,
  list: async () => [connectionView],
  listAgentServers: async () => [],
  renameAgentServer: async (_actor, id, displayName) => ({ id, displayName, kind: "agent" as const }),
  switchToLocal: async () => connectionView,
  update: async () => connectionView,
  remove: async () => undefined,
  testCandidate: async () => testPassed,
  testSaved: async () => testPassed,
};

/** The self-serve owner's actions: the real service re-checks self-serve and ownership under a row lock (selfServeOwner.db.test.ts);
 *  here only charlie is self-serve, and the route has already required the owner role. */
const selfServeOwner = {
  renameAsOwner: async (_actor: string, id: string, displayName: string) =>
    id === SELF_SERVE_SERVER ? { id, displayName, kind: "agent" as const } : ("not_self_serve" as const),
  removeAsOwner: async (_actor: string, id: string) => (id === SELF_SERVE_SERVER ? ("removed" as const) : ("not_self_serve" as const)),
};

const access: ServerAccess = {
  getRole: async (publicId, userId) => members[publicId]?.[userId],
  listForUser: async (userId) =>
    Object.entries(members)
      .filter(([, roles]) => Object.hasOwn(roles, userId))
      .map(([publicId, roles]) => ({ publicId, displayName: publicId, role: roles[userId]!, id: `uuid-${publicId}`, createdVia: "operator" as const })),
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
    // ADR-0027: stored history (the generated tests reach the routes without a query string: the defaults apply).
    history: {
      power: async () => historyPower24h.data,
      items: async () => historyItems7d.data,
      transitions: async () => historyTransitions24h.data,
    },
  },
  settings: {
    getSettings: async () => ({ autoPause: false, pending: false, editable: true }),
    setAutoPause: async (enabled: boolean) => ({ autoPause: enabled, pending: false, editable: true }),
  },
};

/** A stand-in for the alerts service: every method answers with its contract fixture, so the real router, its body and
 *  query validation and the real membership middleware are what the generated tests exercise. */
const alertsService: AlertsService = {
  listRules: async () => alertRulesList,
  createRule: async () => alertRuleCreated,
  updateRule: async () => alertRuleUpdatedPresetDisabled,
  deleteRule: async () => alertDeleteRuleResponse,
  getDestinations: async () => alertDestinationsConfigured,
  putDiscord: async () => alertDestinationsConfigured as { discord: NonNullable<typeof alertDestinationsConfigured.discord> },
  patchDiscord: async () => alertDestinationsConfigured as { discord: NonNullable<typeof alertDestinationsConfigured.discord> },
  removeDiscord: async () => alertDeleteDestinationResponse,
  testDiscord: async () => alertSendTestOk,
  listEvents: async () => alertEventsPage,
  getStatus: async () => alertStatusQuiet,
  setMute: async () => alertMuteSetResponse,
  clearMute: async () => alertMuteClearedResponse,
};

/** A stand-in for the push service (ADR-0044): the real router and membership middleware are what the generated tests exercise. */
const pushService: PushService = {
  config: () => ({ enabled: true, vapidPublicKey: "B".repeat(87) }),
  subscribe: async () => ({ created: true, subscription: { id: "5b1f0c2a-7b4d-4c8a-9e51-1a2b3c4d5e11", createdAt: "2026-10-20T10:00:00.000Z" } }),
  unsubscribe: async () => ({ deleted: true }),
  test: async () => ({ ok: false, code: "unavailable" }),
  getOptIn: async () => ({ optedIn: false }),
  setOptIn: async (_serverId, _userId, optedIn) => ({ optedIn }),
};

/** A stand-in for the agents service: every method answers with its contract fixture. */
const agentsService: AgentsService = {
  createEnrollmentCode: async () => agentEnrollmentCodeResponse,
  getStatus: async () => agentStatusEnrolled,
  revoke: async () => agentRevokeResponse,
};

/** A stand-in for leaving (ADR-0047), read from the same membership table: nothing is removed, so the tests stay independent. */
const memberSelfService: MemberSelfService = {
  leave: async (publicId, userId) => {
    const role = members[publicId]?.[userId];
    return role === undefined ? "not_member" : role === "owner" ? "last_owner" : "left";
  },
};

function buildApp(options: { isReady?: () => boolean } = {}) {
  // Both servers exist on this process: what differs is who belongs to them.
  const directory = new InMemoryServerDirectory([
    { id: "alpha", displayName: "Alpha", services },
    { id: "bravo", displayName: "Bravo", services },
    { id: SELF_SERVE_SERVER, displayName: "Charlie", services },
  ]);
  const management = createServerManagementRouters(managementService, { isReady: options.isReady, selfServeOwner });
  return createApp({
    logger: createLogger({ level: "silent" }, { write: () => {} }),
    routers: [],
    sessionGuard: fakeGuard,
    // The same order server.ts uses: collection routes before the servers router, scoped ones after everything.
    protectedRouters: [
      management.collection,
      createServersRouter(directory, access, options),
      // ADR-0038 M3 (#353): no row for either server yet, which is a valid 200 (a synthetic empty
      // response), so a plain empty fake db is enough to cover "a member can read it" here.
      createWorldRoutes(directory, { db: { query: () => Promise.resolve({ rows: [] }) }, mapLive: new MapLiveStore() }),
      ...createTelemetryRouters(directory, { db: { query: () => Promise.resolve({ rows: [] }) } }),
      ...createSettingsRouters(directory),
      ...createAlertsRouters(alertsService),
      ...createPushRouters(pushService),
      ...createAgentUserRouters(agentsService, { getCommand: async () => commandPending.command }),
      // ADR-0047: the real router; the stand-in answers like the database would (the owner is the last owner).
      createMembersRouter(memberSelfService),
      management.scoped,
    ],
  });
}

/** A valid body for each write endpoint that takes one (the auto-pause toggle, or an edit's fields). */
const ALERT_BODIES: Record<string, unknown> = {
  "alerts.rules.create": alertCreateRuleRequest,
  "alerts.rules.update": alertUpdateRuleRequest,
  "alerts.destinations.putDiscord": alertPutDiscordRequest,
  "alerts.destinations.patchDiscord": alertPatchDiscordRequest,
  "alerts.mute.set": alertSetMuteRequest,
  "push.optIn.put": pushOptInRequest,
};
const bodyFor = (name: string): unknown =>
  Object.hasOwn(ALERT_BODIES, name) ? ALERT_BODIES[name] : name === "serverManagement.update" || name === "serverManagement.renameAgent" ? { displayName: "Renamed" } : name === "serverManagement.switchToLocal" ? { host: "127.0.0.1", apiPort: 7777, frmPort: 8080, apiToken: "api-token-abcdef123456" } : { enabled: true };
// POST .../test takes no body, like the other action endpoints.
const hasBody = (name: string, method: Method) =>
  method !== "GET" &&
  method !== "DELETE" &&
  name !== "serverManagement.testSaved" &&
  name !== "alerts.destinations.testDiscord" &&
  name !== "members.leave" &&
  name !== "agent.enrollmentCode";
/** What a successful write answers: 200, except a create (201). */
const successStatus = (name: string): number => (name === "alerts.rules.create" || name === "agent.enrollmentCode" ? 201 : 200);

const call = (app: ReturnType<typeof buildApp>, name: string, method: Method, url: string, user: string) => {
  const req = request(app)[method.toLowerCase() as "get"](url).set("x-test-user", user);
  return hasBody(name, method) ? req.set("Content-Type", "application/json").send(JSON.stringify(bodyFor(name))) : req;
};

describe("the shared contract has server-scoped endpoints to generate from", () => {
  it("finds reads and at least one write", () => {
    expect(SCOPED.length).toBeGreaterThanOrEqual(5);
    expect(SCOPED.some((e) => e.method !== "GET")).toBe(true);
  });

  it("covers all 13 alerts endpoints (ADR-0027 PR 7b), none of them exempt, with a valid body for each write", () => {
    const alerts = SCOPED.filter((endpoint) => endpoint.name.startsWith("alerts."));
    expect(alerts).toHaveLength(13);
    for (const endpoint of alerts.filter((e) => hasBody(e.name, e.method))) {
      expect(ALERT_BODIES, endpoint.name).toHaveProperty([endpoint.name]);
    }
  });

  it("covers the three agent endpoints (ADR-0031 PR 5a): enrolment code, status and revoke", () => {
    const agent = SCOPED.filter((endpoint) => endpoint.name.startsWith("agent."));
    expect(agent.map((endpoint) => `${endpoint.method} ${endpoint.route.replace("/api/servers/:serverId", "")}`).sort()).toEqual([
      "DELETE /agent",
      "GET /agent",
      "POST /agent/enrollment-codes",
    ]);
  });

  it("covers the command status endpoint (ADR-0031 PR 5b), and nothing in the contract is left out", () => {
    expect(SCOPED.filter((endpoint) => endpoint.name.startsWith("commands.")).map((endpoint) => `${endpoint.method} ${endpoint.route.replace("/api/servers/:serverId", "")}`)).toEqual([
      "GET /commands/:commandId",
    ]);
  });

  it("covers members.leave (ADR-0047), the second member's own write, by the contract's flag", () => {
    expect(SCOPED.filter((e) => e.memberSelfService).map((e) => `${e.method} ${e.route}`).sort()).toEqual([
      "POST /api/servers/:serverId/members/me/leave",
      "PUT /api/servers/:serverId/alerts/push",
    ]);
  });

  // A route that is in the contract but not mounted answers the app's own 404 to an authorized owner; every scoped
  // endpoint must be served (the generated tests below assert the success status, so this only names the culprit).
  it("every scoped endpoint is mounted: an authorized owner never gets the unmatched-route 404", async () => {
    const app = buildApp();
    for (const endpoint of SCOPED.filter((e) => !e.operatorOnly)) {
      const res = await call(app, endpoint.name, endpoint.method, urlFor(endpoint.route, "alpha"), OWNER);
      expect(res.body?.error?.code, `${endpoint.name} is not mounted`).not.toBe("not_found");
    }
  });

  it("the agent API itself (/agent/v1) is not under /api/servers, so the membership tests do not select it", () => {
    const selected = scopedEndpoints(endpoints).map((endpoint) => endpoint.route);
    expect(selected.some((route) => route.startsWith("/agent/v1"))).toBe(false);
  });
});

// ADR-0044, ADR-0047: the writes every MEMBER may make (a member's own push opt-in, leaving the server), taken from the
// contract's flag. Leaving is refused to the owner (the last owner, with at most one): 409 would_orphan, reason last_owner.
const ownerRefused = (name: string): boolean => name === "members.leave";

describe.each(SCOPED)("$method $route ($name)", ({ name, method, route, operatorOnly, memberSelfService }) => {
  const app = buildApp();

  it("a signed-in non-member gets the same 404 as an unknown server, so existence is not revealed", async () => {
    const real = await call(app, name, method, urlFor(route, "alpha"), OUTSIDER);
    const other = await call(app, name, method, urlFor(route, "alpha"), ELSEWHERE);
    const missing = await call(app, name, method, urlFor(route, "no-such-server"), OUTSIDER);
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
    const res = await call(app, name, method, urlFor(route, "Bad_Id"), OWNER);
    expect(res.status).toBe(400);
  });

  if (operatorOnly) {
    // ADR-0030: no role is enough, only the operator account. Every member, an owner included, is refused with 403
    // (they are members, so the server's existence is no secret); the operator gets through.
    it.each([OWNER, ADMIN, VIEWER])("a member (%s) who is not the operator is refused with 403 forbidden", async (user) => {
      const res = await call(app, name, method, urlFor(route, "alpha"), user);
      expect(res.status).toBe(403);
      expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("forbidden");
    });

    it("the operator can use it", async () => {
      const res = await call(app, name, method, urlFor(route, "alpha"), OPERATOR);
      expect(res.status).toBe(200);
    });
  } else if (method === "GET") {
    it.each([OWNER, ADMIN, VIEWER])("a member (%s) can read it", async (user) => {
      const res = await call(app, name, method, urlFor(route, "alpha"), user);
      expect(res.status).toBe(200);
    });
  } else if (memberSelfService) {
    const allowed = ownerRefused(name) ? [ADMIN, VIEWER] : [OWNER, ADMIN, VIEWER];
    it.each(allowed)("a member (%s), a viewer included, can write it (it is their own relation to the server)", async (user) => {
      const res = await call(app, name, method, urlFor(route, "alpha"), user);
      expect(res.status).toBe(successStatus(name));
    });
    if (ownerRefused(name)) {
      it("the owner is refused with 409 would_orphan (reason last_owner), not a 403", async () => {
        const res = await call(app, name, method, urlFor(route, "alpha"), OWNER);
        expect(res.status).toBe(409);
        const { error } = ApiErrorResponseSchema.parse(res.body);
        expect([error.code, error.reason]).toEqual(["would_orphan", "last_owner"]);
      });
    }
  } else {
    it("a viewer's write is a 403 forbidden, not a 404", async () => {
      const res = await call(app, name, method, urlFor(route, "alpha"), VIEWER);
      expect(res.status).toBe(403);
      expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("forbidden");
    });

    it.each([OWNER, ADMIN])("the %s can write", async (user) => {
      const res = await call(app, name, method, urlFor(route, "alpha"), user);
      expect(res.status).toBe(successStatus(name));
    });
  }

  it("a role on one server grants nothing on another", async () => {
    // The owner of alpha is not a member of bravo.
    const res = await call(app, name, method, urlFor(route, "bravo"), OWNER);
    expect(res.status).toBe(404);
  });
});

// #526 (ADR-0046 section 1.8): the operator-only endpoints the contract flags `selfServeOwner` also accept the owner of a
// self-serve server. Taken from the flag, so flagging another endpoint is covered (or fails) here.
const SELF_SERVE_OWNER = SCOPED.filter((e) => {
  const [group, name] = e.name.split(".");
  const endpoint = (endpoints as unknown as Record<string, Record<string, object>>)[group!]?.[name!];
  return endpoint !== undefined && "selfServeOwner" in endpoint;
});

describe("the selfServeOwner endpoints", () => {
  it("are exactly renameAgent and remove", () => {
    expect(SELF_SERVE_OWNER.map((e) => e.name).sort()).toEqual(["serverManagement.remove", "serverManagement.renameAgent"]);
  });

  describe.each(SELF_SERVE_OWNER)("$method $route ($name)", ({ name, method, route }) => {
    const app = buildApp();

    it("the owner of a self-serve server can use it (200)", async () => {
      const res = await call(app, name, method, urlFor(route, SELF_SERVE_SERVER), SS_OWNER);
      expect(res.status).toBe(200);
    });

    it("the owner of an operator-created server is refused with 403", async () => {
      const res = await call(app, name, method, urlFor(route, "alpha"), OWNER);
      expect(res.status).toBe(403);
      expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("forbidden");
    });

    it.each([SS_ADMIN, SS_VIEWER])("an admin or viewer (%s) of a self-serve server is refused with 403", async (user) => {
      const res = await call(app, name, method, urlFor(route, SELF_SERVE_SERVER), user);
      expect(res.status).toBe(403);
      expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("forbidden");
    });

    it("a non-member of a self-serve server gets the 404 an unknown server gets (the operator included)", async () => {
      for (const user of [OUTSIDER, OPERATOR, OWNER]) {
        const res = await call(app, name, method, urlFor(route, SELF_SERVE_SERVER), user);
        expect(res.status).toBe(404);
        expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("server_not_found");
      }
    });

    it("without the self-serve wiring, the owner of a self-serve server is refused like any member (403)", async () => {
      const directory = new InMemoryServerDirectory([{ id: SELF_SERVE_SERVER, displayName: "Charlie", services }]);
      const management = createServerManagementRouters(managementService);
      const bare = createApp({
        logger: createLogger({ level: "silent" }, { write: () => {} }),
        routers: [],
        sessionGuard: fakeGuard,
        protectedRouters: [management.collection, createServersRouter(directory, access), management.scoped],
      });
      expect((await call(bare, name, method, urlFor(route, SELF_SERVE_SERVER), SS_OWNER)).status).toBe(403);
    });
  });
});

describe("the operator-only endpoints in the contract", () => {
  it("are exactly the server-management ones, and the generated tests cover the scoped ones", () => {
    const operatorOnlyNames = SCOPED.filter((e) => e.operatorOnly).map((e) => e.name).sort();
    expect(operatorOnlyNames).toEqual([
      "serverManagement.get",
      "serverManagement.remove",
      "serverManagement.renameAgent",
      "serverManagement.switchToLocal",
      "serverManagement.testSaved",
      "serverManagement.update",
    ]);
    expect(SCOPED.filter((e) => !e.operatorOnly).some((e) => e.name.startsWith("serverManagement"))).toBe(false);
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
