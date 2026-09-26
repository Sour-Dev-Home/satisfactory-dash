import { describe, expect, it } from "vitest";
import request from "supertest";
import type { RequestHandler } from "express";
import { ApiErrorResponseSchema, endpoints } from "@satisfactory-dash/shared";
import {
  alertCreateRuleRequest,
  alertDeleteRuleResponse,
  alertDestinationsConfigured,
  alertEventsLastPage,
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
} from "@satisfactory-dash/shared/fixtures";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import { ApiFailure, RateLimitedError, ServiceUnavailableError } from "../../../platform/errorResponse.js";
import { InMemoryServerDirectory, createServersRouter } from "../../servers/index.js";
import type { ServerAccess } from "../../servers/index.js";
import { createAlertsRouters } from "../index.js";
import type { AlertsService } from "../services/alertsService.js";

/** HTTP behaviour of the alerts routes (ADR-0027 PR 7b), with a stub service. The SQL is in the db tests. */

const SERVER = "alpha";
const RULE = "3f0c2a1e-7b4d-4c8a-9e51-1a2b3c4d5e04";
const roles: Record<string, "owner" | "admin" | "viewer"> = { owner: "owner", viewer: "viewer" };
const access: ServerAccess = {
  getRole: async (publicId, userId) => (publicId === SERVER ? roles[userId] : undefined),
  listForUser: async () => [],
};
const guard: RequestHandler = (req, res, next) => {
  res.locals.user = { id: req.header("x-test-user") ?? "owner" };
  next();
};

function stubService(over: Partial<AlertsService> = {}): AlertsService & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {};
  const track =
    <F extends (...args: never[]) => unknown>(name: string, fn: F) =>
    (...args: Parameters<F>) => {
      (calls[name] ??= []).push(args as unknown[]);
      return fn(...args);
    };
  const base = {
    listRules: track("listRules", async () => alertRulesList),
    createRule: track("createRule", async () => alertRuleCreated),
    updateRule: track("updateRule", async () => alertRuleUpdatedPresetDisabled),
    deleteRule: track("deleteRule", async () => alertDeleteRuleResponse),
    getDestinations: track("getDestinations", async () => alertDestinationsConfigured),
    putDiscord: track("putDiscord", async () => ({ discord: alertDestinationsConfigured.discord })),
    patchDiscord: track("patchDiscord", async () => ({ discord: alertDestinationsConfigured.discord })),
    removeDiscord: track("removeDiscord", async () => ({ deleted: true as const })),
    testDiscord: track("testDiscord", async () => alertSendTestOk),
    listEvents: track("listEvents", async () => alertEventsPage),
    getStatus: track("getStatus", async () => alertStatusQuiet),
    setMute: track("setMute", async () => alertMuteSetResponse),
    clearMute: track("clearMute", async () => alertMuteClearedResponse),
  } as unknown as AlertsService;
  return Object.assign(base, over, { calls });
}

function build(service: AlertsService, lines: string[] = []) {
  const directory = new InMemoryServerDirectory([{ id: SERVER, displayName: "Alpha", services: {} }]);
  return createApp({
    logger: createLogger({ level: "debug" }, { write: (line: string) => lines.push(line) }),
    routers: [],
    sessionGuard: guard,
    protectedRouters: [createServersRouter(directory, access), ...createAlertsRouters(service)],
  });
}

const path = (endpoint: { path: (...args: string[]) => string }, ...rest: string[]) => endpoint.path(SERVER, ...rest);

describe("rules", () => {
  it("lists them (the response goes through its schema)", async () => {
    const res = await request(build(stubService())).get(path(endpoints.alerts.rules.list));
    expect(res.status).toBe(200);
    expect(res.body.rules).toHaveLength(4);
  });

  it("create answers 201 with the rule, and passes the parsed body (defaults filled) and the actor to the service", async () => {
    const service = stubService();
    const res = await request(build(service)).post(path(endpoints.alerts.rules.create)).send({ kind: "production_below_target", params: { item: "Desc_X_C", targetPerMinute: 5 } });
    expect(res.status).toBe(201);
    expect(res.body.rule.kind).toBe("production_below_target");
    expect(service.calls.createRule![0]).toEqual([
      SERVER,
      "owner",
      { kind: "production_below_target", params: { item: "Desc_X_C", targetPerMinute: 5, windowMinutes: 10 }, severity: "warning", enabled: true, forSeconds: 600, clearSeconds: 300, repeatSeconds: 3600 },
    ]);
  });

  it("refuses an invalid create body with a FIXED message and never calls the service", async () => {
    const service = stubService();
    const app = build(service);
    for (const body of [{}, { kind: 5 }, { kind: "production_below_target", params: { item: "Desc_X_C" } }, { ...alertCreateRuleRequest, extra: 1 }, []]) {
      const res = await request(app).post(path(endpoints.alerts.rules.create)).send(body as object);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error).toMatchObject({ code: "bad_request", message: "The request body is not valid" });
    }
    expect(service.calls.createRule).toBeUndefined();
  });

  it("creating any other kind (a preset's or an unknown one) is 422 rule_kind_not_creatable and does not echo the kind", async () => {
    const service = stubService();
    const app = build(service);
    for (const kind of ["power_outage", "stopped_machines", "fuse_trip", "server_unreachable", "nonsense_kind", ""]) {
      const res = await request(app).post(path(endpoints.alerts.rules.create)).send({ kind, params: {} });
      expect(res.status, kind).toBe(422);
      expect(res.body.error.code).toBe("rule_kind_not_creatable");
      expect(JSON.stringify(res.body)).not.toContain("nonsense");
    }
    expect(service.calls.createRule).toBeUndefined();
  });

  it("update passes the rule id and the parsed body; an empty or unknown-field body is a 400", async () => {
    const service = stubService();
    const app = build(service);
    expect((await request(app).patch(path(endpoints.alerts.rules.update, RULE)).send(alertUpdateRuleRequest)).status).toBe(200);
    expect(service.calls.updateRule![0]).toEqual([SERVER, "owner", RULE, alertUpdateRuleRequest]);
    for (const body of [{}, { kind: "x" }, { severity: "loud" }, { repeatSeconds: 5 }]) {
      expect((await request(app).patch(path(endpoints.alerts.rules.update, RULE)).send(body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it("maps the domain failures to their statuses and stable codes", async () => {
    const cases: [ApiFailure, number, string][] = [
      [new ApiFailure("rule_not_found", "m"), 404, "rule_not_found"],
      [new ApiFailure("rule_item_immutable", "m"), 422, "rule_item_immutable"],
      [new ApiFailure("preset_disable_only", "m"), 409, "preset_disable_only"],
    ];
    for (const [failure, status, code] of cases) {
      const app = build(stubService({ updateRule: async () => Promise.reject(failure), deleteRule: async () => Promise.reject(failure) }));
      for (const res of [await request(app).patch(path(endpoints.alerts.rules.update, RULE)).send({ enabled: false }), await request(app).delete(path(endpoints.alerts.rules.remove, RULE))]) {
        expect(res.status).toBe(status);
        expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe(code);
      }
    }
  });

  it("delete answers { deleted: true }", async () => {
    const res = await request(build(stubService())).delete(path(endpoints.alerts.rules.remove, RULE));
    expect(res.body).toEqual({ deleted: true });
  });
});

describe("the Discord destination and the webhook URL secret", () => {
  const SECRET_URL = alertPutDiscordRequest.webhookUrl;
  const TOKEN = "EXAMPLE_TOKEN_NOT_REAL_aB3d";

  it("PUT takes the URL only in the body and answers with the summary (last 4 only)", async () => {
    const service = stubService();
    const res = await request(build(service)).put(path(endpoints.alerts.destinations.putDiscord)).send(alertPutDiscordRequest);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ discord: alertDestinationsConfigured.discord });
    expect(service.calls.putDiscord![0]).toEqual([SERVER, "owner", SECRET_URL]);
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
  });

  it("a refused URL answers webhook_invalid 422 with the stable reason, and the URL is in no body and no log line", async () => {
    const lines: string[] = [];
    const service = stubService({ putDiscord: async () => Promise.reject(new ApiFailure("webhook_invalid", "That is not a valid Discord webhook URL", "host_not_allowed")) });
    const res = await request(build(service, lines)).put(path(endpoints.alerts.destinations.putDiscord)).send({ webhookUrl: `https://evil.example/api/webhooks/123456789012345678/${TOKEN}` });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: "webhook_invalid", message: "That is not a valid Discord webhook URL", reason: "host_not_allowed" });
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
    expect(lines.join("\n")).not.toContain(TOKEN);
  });

  it("a reason that is not a plain code is dropped rather than echoed", async () => {
    const service = stubService({ putDiscord: async () => Promise.reject(new ApiFailure("webhook_invalid", "m", `https://evil.example/${TOKEN}`)) });
    const res = await request(build(service)).put(path(endpoints.alerts.destinations.putDiscord)).send(alertPutDiscordRequest);
    expect(res.status).toBe(422);
    expect(res.body.error).not.toHaveProperty("reason");
  });

  it("the URL is never logged or returned on ANY path: a bad body, an unknown field, a service crash, an outage, a rate limit", async () => {
    const secretBodies: object[] = [
      { webhookUrl: SECRET_URL, extra: SECRET_URL }, // an unknown field: a strict-schema failure
      { webhookUrl: `${SECRET_URL}${"x".repeat(400)}` }, // too long
      { webhookUrl: 12345 },
    ];
    const failures: (() => Promise<never>)[] = [
      () => Promise.reject(new Error("boom")),
      () => Promise.reject(new ServiceUnavailableError()),
      () => Promise.reject(new RateLimitedError(30, "slow down")),
    ];
    for (const body of secretBodies) {
      const lines: string[] = [];
      const res = await request(build(stubService(), lines)).put(path(endpoints.alerts.destinations.putDiscord)).send(body);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain(TOKEN);
      expect(lines.join("\n")).not.toContain(TOKEN);
    }
    for (const fail of failures) {
      const lines: string[] = [];
      const res = await request(build(stubService({ putDiscord: fail }), lines)).put(path(endpoints.alerts.destinations.putDiscord)).send(alertPutDiscordRequest);
      expect(res.status).toBeGreaterThanOrEqual(429);
      expect(JSON.stringify(res.body)).not.toContain(TOKEN);
      expect(lines.join("\n")).not.toContain(TOKEN);
    }
  });

  it("a JSON syntax error in the body never echoes the body", async () => {
    const lines: string[] = [];
    const res = await request(build(stubService(), lines))
      .put(path(endpoints.alerts.destinations.putDiscord))
      .set("Content-Type", "application/json")
      .send(`{"webhookUrl": "${SECRET_URL}" oops`);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
    expect(lines.join("\n")).not.toContain(TOKEN);
  });

  it("GET reads the destination; PATCH takes only enabled; DELETE answers deleted", async () => {
    const service = stubService();
    const app = build(service);
    expect((await request(app).get(path(endpoints.alerts.destinations.get))).body).toEqual(alertDestinationsConfigured);
    expect((await request(app).patch(path(endpoints.alerts.destinations.patchDiscord)).send(alertPatchDiscordRequest)).status).toBe(200);
    expect(service.calls.patchDiscord![0]).toEqual([SERVER, "owner", false]);
    expect((await request(app).patch(path(endpoints.alerts.destinations.patchDiscord)).send({ enabled: true, webhookUrl: SECRET_URL })).status).toBe(400);
    expect((await request(app).delete(path(endpoints.alerts.destinations.removeDiscord))).body).toEqual({ deleted: true });
  });

  it("test: 200 with the result; delivery_off is 409, no destination 404, the per-user limit 429 with Retry-After", async () => {
    const app = build(stubService());
    expect((await request(app).post(path(endpoints.alerts.destinations.testDiscord))).body).toEqual({ ok: true });
    const off = build(stubService({ testDiscord: async () => Promise.reject(new ApiFailure("delivery_off", "m")) }));
    expect((await request(off).post(path(endpoints.alerts.destinations.testDiscord))).status).toBe(409);
    const none = build(stubService({ testDiscord: async () => Promise.reject(new ApiFailure("destination_not_configured", "m")) }));
    expect((await request(none).post(path(endpoints.alerts.destinations.testDiscord))).status).toBe(404);
    const limited = build(stubService({ testDiscord: async () => Promise.reject(new RateLimitedError(42)) }));
    const res = await request(limited).post(path(endpoints.alerts.destinations.testDiscord));
    expect([res.status, res.headers["retry-after"], res.body.error.code]).toEqual([429, "42", "rate_limited"]);
  });
});

describe("the alert log, status and mute", () => {
  it("events: passes limit (default 50) and before, and pages with nextBefore", async () => {
    const service = stubService();
    const app = build(service);
    await request(app).get(path(endpoints.alerts.events));
    await request(app).get(`${path(endpoints.alerts.events)}?limit=100&before=412`);
    expect(service.calls.listEvents!.map((call) => call[1])).toEqual([{ limit: 50 }, { limit: 100, before: "412" }]);
    const last = build(stubService({ listEvents: async () => alertEventsLastPage }));
    expect((await request(last).get(path(endpoints.alerts.events))).body.nextBefore).toBeNull();
  });

  it("events: a bad query is a 400 (limit 0 or 101, a cursor that could overflow a bigint, a leading zero)", async () => {
    const service = stubService();
    const app = build(service);
    for (const query of ["limit=0", "limit=101", "limit=abc", "before=abc", "before=0", "before=012", `before=${"9".repeat(19)}`, "before=9223372036854775807", "limit=1&limit=2"]) {
      const res = await request(app).get(`${path(endpoints.alerts.events)}?${query}`);
      expect(res.status, query).toBe(400);
      expect(res.body.error.message).toBe("The query is not valid");
    }
    expect(service.calls.listEvents).toBeUndefined();
  });

  it("status is a plain member-readable GET", async () => {
    const res = await request(build(stubService())).get(path(endpoints.alerts.status)).set("x-test-user", "viewer");
    expect(res.body).toEqual(alertStatusQuiet);
  });

  it("mute: PUT takes one time and answers it; a refused time is 422 mute_invalid; DELETE clears", async () => {
    const service = stubService();
    const app = build(service);
    expect((await request(app).put(path(endpoints.alerts.mute.set)).send(alertSetMuteRequest)).body).toEqual(alertMuteSetResponse);
    expect(service.calls.setMute![0]).toEqual([SERVER, "owner", alertSetMuteRequest.until]);
    for (const body of [{}, { until: "tomorrow" }, { until: alertSetMuteRequest.until, extra: 1 }]) {
      expect((await request(app).put(path(endpoints.alerts.mute.set)).send(body)).status).toBe(400);
    }
    const bad = build(stubService({ setMute: async () => Promise.reject(new ApiFailure("mute_invalid", "m")) }));
    expect((await request(bad).put(path(endpoints.alerts.mute.set)).send(alertSetMuteRequest)).status).toBe(422);
    expect((await request(app).delete(path(endpoints.alerts.mute.clear))).body).toEqual(alertMuteClearedResponse);
  });
});

describe("authorization on the real routes", () => {
  it("a viewer can read but every write is 403, and the service is never called", async () => {
    const service = stubService();
    const app = build(service);
    const viewer = (r: request.Test) => r.set("x-test-user", "viewer");
    expect((await viewer(request(app).get(path(endpoints.alerts.rules.list)))).status).toBe(200);
    expect((await viewer(request(app).get(path(endpoints.alerts.events)))).status).toBe(200);
    for (const res of [
      await viewer(request(app).post(path(endpoints.alerts.rules.create)).send(alertCreateRuleRequest)),
      await viewer(request(app).patch(path(endpoints.alerts.rules.update, RULE)).send(alertUpdateRuleRequest)),
      await viewer(request(app).delete(path(endpoints.alerts.rules.remove, RULE))),
      await viewer(request(app).put(path(endpoints.alerts.destinations.putDiscord)).send(alertPutDiscordRequest)),
      await viewer(request(app).post(path(endpoints.alerts.destinations.testDiscord))),
      await viewer(request(app).put(path(endpoints.alerts.mute.set)).send(alertSetMuteRequest)),
    ]) {
      expect(res.status).toBe(403);
    }
    // Only the two reads reached the service; not one write did.
    expect(Object.keys(service.calls).sort()).toEqual(["listEvents", "listRules"]);
  });

  it("the remaining writes (PATCH and DELETE destination, DELETE mute) are 403 for a viewer, also with a trailing slash", async () => {
    const service = stubService();
    const app = build(service);
    const viewer = (r: request.Test) => r.set("x-test-user", "viewer");
    for (const suffix of ["", "/"]) {
      expect((await viewer(request(app).patch(path(endpoints.alerts.destinations.patchDiscord) + suffix).send(alertPatchDiscordRequest))).status).toBe(403);
      expect((await viewer(request(app).delete(path(endpoints.alerts.destinations.removeDiscord) + suffix))).status).toBe(403);
      expect((await viewer(request(app).delete(path(endpoints.alerts.mute.clear) + suffix))).status).toBe(403);
    }
    expect(service.calls).toEqual({});
  });

  it("a non-member is 404 on writes too (not 403), for every method, and the service is never called", async () => {
    const service = stubService();
    const app = build(service);
    const stranger = (r: request.Test) => r.set("x-test-user", "stranger");
    for (const res of [
      await stranger(request(app).delete(path(endpoints.alerts.rules.remove, RULE))),
      await stranger(request(app).put(path(endpoints.alerts.destinations.putDiscord)).send(alertPutDiscordRequest)),
      await stranger(request(app).post(path(endpoints.alerts.destinations.testDiscord))),
      await stranger(request(app).get(path(endpoints.alerts.status)).set("x-test-user", "stranger")),
      await stranger(request(app).head(path(endpoints.alerts.status))),
    ]) {
      expect(res.status).toBe(404);
    }
    expect(service.calls).toEqual({});
  });

  it("an encoded or oddly cased server id never reaches the service as another id", async () => {
    const service = stubService();
    const app = build(service);
    for (const id of ["ALPHA", "alpha%2F..", "alpha%00", "%E0%A4%A"]) {
      const res = await request(app).get(`/api/servers/${id}/alerts/status`);
      expect([400, 404], id).toContain(res.status);
    }
    expect(service.calls).toEqual({});
  });

  it("every write passes the signed-in user's id to the service as the actor", async () => {
    const service = stubService();
    const app = build(service);
    await request(app).post(path(endpoints.alerts.rules.create)).send(alertCreateRuleRequest);
    await request(app).patch(path(endpoints.alerts.rules.update, RULE)).send(alertUpdateRuleRequest);
    await request(app).delete(path(endpoints.alerts.rules.remove, RULE));
    await request(app).put(path(endpoints.alerts.destinations.putDiscord)).send(alertPutDiscordRequest);
    await request(app).patch(path(endpoints.alerts.destinations.patchDiscord)).send(alertPatchDiscordRequest);
    await request(app).delete(path(endpoints.alerts.destinations.removeDiscord));
    await request(app).post(path(endpoints.alerts.destinations.testDiscord));
    await request(app).put(path(endpoints.alerts.mute.set)).send(alertSetMuteRequest);
    await request(app).delete(path(endpoints.alerts.mute.clear));
    const names = ["createRule", "updateRule", "deleteRule", "putDiscord", "patchDiscord", "removeDiscord", "testDiscord", "setMute", "clearMute"];
    for (const name of names) expect(service.calls[name]?.[0]?.slice(0, 2), name).toEqual([SERVER, "owner"]);
  });

  it("a non-member gets the same 404 as an unknown server, so a server's existence is not revealed", async () => {
    const app = build(stubService());
    const outsider = await request(app).get(path(endpoints.alerts.rules.list)).set("x-test-user", "stranger");
    const missing = await request(app).get(endpoints.alerts.rules.list.path("no-such-server")).set("x-test-user", "stranger");
    expect([outsider.status, missing.status]).toEqual([404, 404]);
    expect(outsider.body.error.code).toBe("server_not_found");
  });
});
