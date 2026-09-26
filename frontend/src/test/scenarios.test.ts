import { ApiErrorResponseSchema, endpoints } from "@satisfactory-dash/shared";
import { describe, expect, it } from "vitest";
import { isScenario, matchRoute, responsesFor, ROUTES, SCENARIOS, type RouteKey, type ScenarioName } from "./scenarios";

describe("matchRoute", () => {
  it("maps every endpoint's own client path and method to its key", () => {
    for (const key of Object.keys(ROUTES) as RouteKey[]) {
      const route = ROUTES[key];
      // A second id for the routes that take one (a command); the others ignore it.
      const path = route.path as (serverId: string, id: string) => string;
      expect(matchRoute(route.method, path("default", "c1")), key).toBe(key);
    }
  });

  it("accepts a lowercase method", () => {
    expect(matchRoute("get", "/api/health")).toBe("health");
    expect(matchRoute("put", "/api/servers/default/settings/auto-pause")).toBe("setAutoPause");
  });

  it("keeps settings and settings/auto-pause apart, by path and by method", () => {
    expect(matchRoute("GET", "/api/servers/default/settings")).toBe("settings");
    expect(matchRoute("PUT", "/api/servers/default/settings/auto-pause")).toBe("setAutoPause");
    expect(matchRoute("GET", "/api/servers/default/settings/auto-pause")).toBeUndefined();
    expect(matchRoute("PUT", "/api/servers/default/settings")).toBeUndefined();
  });

  it("matches an encoded server id as one segment", () => {
    const path = endpoints.status.path("a/b c");
    expect(path).toBe("/api/servers/a%2Fb%20c/status");
    expect(matchRoute("GET", path)).toBe("status");
  });

  it("rejects wrong methods, unknown paths, extra segments and a missing id", () => {
    expect(matchRoute("POST", "/api/health")).toBeUndefined();
    expect(matchRoute("GET", "/api/auth/login")).toBeUndefined();
    expect(matchRoute("GET", "/api/not-a-real-route")).toBeUndefined();
    expect(matchRoute("GET", "/api/servers/a/b/status")).toBeUndefined();
    expect(matchRoute("GET", "/api/servers//status")).toBeUndefined();
    expect(matchRoute("GET", "/prefix/api/health")).toBeUndefined();
  });
});

describe("scenarios", () => {
  it("only treats own scenario names as scenarios", () => {
    expect(isScenario("outage")).toBe(true);
    for (const name of ["", "toString", "__proto__", "constructor", "Outage"]) {
      expect(isScenario(name), name).toBe(false);
    }
  });

  it("answers every route in every scenario", () => {
    for (const name of Object.keys(SCENARIOS) as ScenarioName[]) {
      expect(Object.keys(responsesFor(name)).sort(), name).toEqual(Object.keys(ROUTES).sort());
    }
  });

  // The mocks must look like the real backend: a success body passes the route's schema and
  // an error body is a valid envelope. Only the deliberate drift and non-JSON cases don't.
  it("serves bodies that match the shared contract", () => {
    const deliberate = new Set(["contract-drift:status"]);
    for (const name of Object.keys(SCENARIOS) as ScenarioName[]) {
      const responses = responsesFor(name);
      for (const key of Object.keys(responses) as RouteKey[]) {
        const response = responses[key];
        if (response.delay === "never" || response.text !== undefined) continue;
        const label = `${name}:${key}`;
        const schema = response.status < 400 ? ROUTES[key].response : ApiErrorResponseSchema;
        expect(schema.safeParse(response.body).success, label).toBe(!deliberate.has(label));
      }
    }
  });
});
