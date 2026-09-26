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
  alertStatusQuiet,
  alertUpdateRuleRequest,
  agentEnrollmentCodeResponse,
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
import { InMemoryServerDirectory, createServerManagementRouters, createServersRouter } from "./modules/servers/index.js";
import type { ServerAccess, ServerManagementService } from "./modules/servers/index.js";
import { createTelemetryRouters } from "./modules/telemetry/index.js";
import { createSettingsRouters } from "./modules/settings/index.js";
import { createAlertsRouters } from "./modules/alerts/index.js";
import type { AlertsService } from "./modules/alerts/index.js";
import { createAgentUserRouters } from "./modules/agents/index.js";
import type { AgentsService } from "./modules/agents/index.js";
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
// contract before their routes. PR 5a mounted the three agent ones, so the generated tests cover them like every other
// scoped route; the command's status (`GET /commands/:commandId`) arrives with the commands table in PR 5b, which deletes
// this line. A guard test below makes that impossible to forget.
const COMMANDS_NOT_YET_MOUNTED = (name: string): boolean => name.startsWith("commands.");
const SCOPED = scopedEndpoints(endpoints).filter((endpoint) => !COMMANDS_NOT_YET_MOUNTED(endpoint.name));
const RULE_ID = "3f0c2a1e-7b4d-4c8a-9e51-1a2b3c4d5e04";
const urlFor = (route: string, serverId: string) => route.replace(":serverId", serverId).replace(":ruleId", RULE_ID).replace(":commandId", "cmd-1");

const OWNER = "user-owner";
const ADMIN = "user-admin";
const VIEWER = "user-viewer";
const OUTSIDER = "user-outsider"; // signed in, member of nothing
const ELSEWHERE = "user-elsewhere"; // a member of the other server only
// ADR-0030: the seeded operator account. Deliberately only an ADMIN of alpha here, so the tests show that
// what makes a user allowed to manage servers is being the operator, not the role (the OWNER above is refused).
const OPERATOR = "user-operator";

const members: Record<string, Record<string, "owner" | "admin" | "viewer">> = {
  alpha: { [OWNER]: "owner", [ADMIN]: "admin", [VIEWER]: "viewer", [OPERATOR]: "admin" },
  bravo: { [ELSEWHERE]: "owner" },
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
  update: async () => connectionView,
  remove: async () => undefined,
  testCandidate: async () => testPassed,
  testSaved: async () => testPassed,
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

/** A stand-in for the agents service: every method answers with its contract fixture. */
const agentsService: AgentsService = {
  createEnrollmentCode: async () => agentEnrollmentCodeResponse,
  getStatus: async () => agentStatusEnrolled,
  revoke: async () => agentRevokeResponse,
};

function buildApp(options: { isReady?: () => boolean } = {}) {
  // Both servers exist on this process: what differs is who belongs to them.
  const directory = new InMemoryServerDirectory([
    { id: "alpha", displayName: "Alpha", services },
    { id: "bravo", displayName: "Bravo", services },
  ]);
  const management = createServerManagementRouters(managementService, { isReady: options.isReady });
  return createApp({
    logger: createLogger({ level: "silent" }, { write: () => {} }),
    routers: [],
    sessionGuard: fakeGuard,
    // The same order server.ts uses: collection routes before the servers router, scoped ones after everything.
    protectedRouters: [
      management.collection,
      createServersRouter(directory, access, options),
      ...createTelemetryRouters(directory),
      ...createSettingsRouters(directory),
      ...createAlertsRouters(alertsService),
      ...createAgentUserRouters(agentsService),
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
};
const bodyFor = (name: string): unknown =>
  name in ALERT_BODIES ? ALERT_BODIES[name] : name === "serverManagement.update" ? { displayName: "Renamed" } : { enabled: true };
// POST .../test takes no body, like the other action endpoints.
const hasBody = (name: string, method: Method) =>
  method !== "GET" &&
  method !== "DELETE" &&
  name !== "serverManagement.testSaved" &&
  name !== "alerts.destinations.testDiscord" &&
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

  it("exempts only the command status endpoint (ADR-0031 PR 5b), and no other", () => {
    const exempt = scopedEndpoints(endpoints).filter((endpoint) => COMMANDS_NOT_YET_MOUNTED(endpoint.name));
    expect(exempt.map((endpoint) => `${endpoint.method} ${endpoint.route.replace("/api/servers/:serverId", "")}`).sort()).toEqual([
      "GET /commands/:commandId",
    ]);
  });

  // Expires on its own: the moment PR 5b mounts it, this fails until COMMANDS_NOT_YET_MOUNTED is deleted, so the
  // route can never ship without the generated authorization tests.
  it("the exempt command endpoint is still unmounted: an authorized owner gets the app's own unmatched-route 404", async () => {
    const app = buildApp();
    for (const endpoint of scopedEndpoints(endpoints).filter((e) => COMMANDS_NOT_YET_MOUNTED(e.name))) {
      const res = await call(app, endpoint.name, endpoint.method, urlFor(endpoint.route, "alpha"), OWNER);
      const mounted = `${endpoint.name} is now mounted: delete COMMANDS_NOT_YET_MOUNTED so the generated authorization tests cover it (ADR-0031 PR 5b)`;
      expect(res.status, mounted).toBe(404);
      expect(res.body?.error?.code, mounted).toBe("not_found");
    }
  });

  it("the agent API itself (/agent/v1) is not under /api/servers, so the membership tests do not select it", () => {
    const selected = scopedEndpoints(endpoints).map((endpoint) => endpoint.route);
    expect(selected.some((route) => route.startsWith("/agent/v1"))).toBe(false);
  });
});

describe.each(SCOPED)("$method $route ($name)", ({ name, method, route, operatorOnly }) => {
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

describe("the operator-only endpoints in the contract", () => {
  it("are exactly the server-management ones, and the generated tests cover the scoped ones", () => {
    const operatorOnlyNames = SCOPED.filter((e) => e.operatorOnly).map((e) => e.name).sort();
    expect(operatorOnlyNames).toEqual([
      "serverManagement.get",
      "serverManagement.remove",
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
