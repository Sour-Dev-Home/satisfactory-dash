import { describe, expect, it } from "vitest";
import type { z } from "zod";
import * as fixtures from "../fixtures/index";
import {
  ApiErrorResponseSchema,
  FactoryResponseSchema,
  HealthResponseSchema,
  KnownErrorCode,
  LoginRequestSchema,
  ReadinessResponseSchema,
  PowerHistoryResponseSchema,
  PowerResponseSchema,
  SessionResponseSchema,
  SetAutoPauseRequestSchema,
  SettingsResponseSchema,
  ServerListResponseSchema,
  ServerPlayersResponseSchema,
  StatusResponseSchema,
  endpoints,
} from "../src/index";
import type { PowerCircuitStatus } from "../src/index";

// Every fixture is matched to its schema by name prefix, so a fixture added later can't
// be skipped by forgetting to list it here: an unmatched export fails the first test.
const schemaByPrefix: [string, z.ZodType][] = [
  // "powerHistory" must come before "power": the first matching prefix wins.
  ["powerHistory", PowerHistoryResponseSchema],
  ["power", PowerResponseSchema],
  ["status", StatusResponseSchema],
  ["factory", FactoryResponseSchema],
  ["servers", ServerListResponseSchema],
  ["error", ApiErrorResponseSchema],
  ["health", HealthResponseSchema],
  ["readiness", ReadinessResponseSchema],
  ["loginRequest", LoginRequestSchema],
  ["session", SessionResponseSchema],
  ["settings", SettingsResponseSchema],
  ["setAutoPauseRequest", SetAutoPauseRequestSchema],
  ["players", ServerPlayersResponseSchema],
];

function schemaFor(name: string): z.ZodType | undefined {
  return schemaByPrefix.find(([prefix]) => name.startsWith(prefix))?.[1];
}

const cases = Object.entries(fixtures).map(([name, fixture]) => [name, fixture] as const);

describe("fixtures", () => {
  it("every exported fixture has a schema", () => {
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.filter(([name]) => !schemaFor(name)).map(([name]) => name)).toEqual([]);
  });

  // The drift tripwire (ADR-0002). toEqual also fails if parsing strips a key the
  // fixture has but the schema doesn't know about.
  it.each(cases)("%s parses and round-trips unchanged", (name, fixture) => {
    const schema = schemaFor(name);
    expect(schema?.parse(fixture)).toEqual(fixture);
  });
});

describe("scenario fixtures show what their names say", () => {
  it("statusNoGame is a server with no save loaded", () => {
    expect(fixtures.statusNoGame.data.isGameRunning).toBe(false);
  });

  it("powerDischarging has a draining battery, ok at 20 % or more and at_risk below it", () => {
    const [ok, low] = fixtures.powerDischarging.data.circuits;
    for (const circuit of [ok, low]) {
      expect(circuit.batteryCapacityMWh).toBeGreaterThan(0);
      expect(circuit.batteryDifferentialMW).toBeLessThan(0);
    }
    expect([ok.batteryPercent >= 20, ok.status]).toEqual([true, "ok"]);
    expect([low.batteryPercent < 20, low.status]).toEqual([true, "at_risk"]);
    expect(fixtures.powerDischarging.data.hasOutage).toBe(false);
  });

  it("exports the circuit status type (compile-time check)", () => {
    const status: PowerCircuitStatus = fixtures.powerOk.data.circuits[0].status;
    expect(["ok", "at_risk", "outage"]).toContain(status);
  });
});

describe("ProductionRate.unit (ADR-0015)", () => {
  const rateOf = (className: string) =>
    fixtures.factoryMixed.data.buildings.flatMap((b) => b.production).find((p) => p.className === className);

  it("the fixtures carry real units: fluids m3/min, solids items/min", () => {
    expect(rateOf("Desc_LiquidFuel_C")?.unit).toBe("m3/min");
    expect(rateOf("Desc_Stator_C")?.unit).toBe("items/min");
    expect(rateOf("Desc_PolymerResin_C")?.unit).toBe("items/min");
  });

  it("factoryUnknownItem shows the null case", () => {
    expect(fixtures.factoryUnknownItem.data.buildings[0].production[0].unit).toBeNull();
  });

  const withUnit = (unit: unknown) => {
    const building = { ...fixtures.factoryUnknownItem.data.buildings[0] };
    building.production = [{ ...building.production[0], unit }] as never;
    return FactoryResponseSchema.safeParse({
      ...fixtures.factoryUnknownItem,
      data: { ...fixtures.factoryUnknownItem.data, buildings: [building] },
    });
  };

  it("accepts the two units and null", () => {
    for (const unit of ["items/min", "m3/min", null]) {
      expect(withUnit(unit).success, String(unit)).toBe(true);
    }
  });

  it("rejects any other unit", () => {
    for (const unit of ["kg/min", "m³/min", "", 0]) {
      expect(withUnit(unit).success, String(unit)).toBe(false);
    }
  });

  // Deploy skew (ADR-0007): the frontend deploys on every merge, a backend is updated by
  // hand, so a response from a backend that predates the field must still parse.
  it("accepts a missing unit (an older backend), and factoryOldBackend has none", () => {
    expect(withUnit(undefined).success).toBe(true);
    const rate = fixtures.factoryOldBackend.data.buildings[0].production[0];
    expect("unit" in rate).toBe(false);
  });
});

describe("schemas reject what the contract rules out", () => {
  it("rejects a server id that isn't lowercase alphanumeric/dash", () => {
    for (const serverId of ["Default", "a/b", "", "x".repeat(33), "host:7777"]) {
      expect(PowerResponseSchema.safeParse({ ...fixtures.powerOk, serverId }).success).toBe(false);
    }
  });

  it("rejects an observedAt that isn't an ISO-8601 datetime", () => {
    expect(PowerResponseSchema.safeParse({ ...fixtures.powerOk, observedAt: "yesterday" }).success).toBe(false);
  });

  it("rejects an unknown power circuit status", () => {
    const circuit = { ...fixtures.powerOk.data.circuits[0], status: "fine" };
    const body = { ...fixtures.powerOk, data: { ...fixtures.powerOk.data, circuits: [circuit] } };
    expect(PowerResponseSchema.safeParse(body).success).toBe(false);
  });

  it("rejects a negative battery capacity", () => {
    const circuit = { ...fixtures.powerOk.data.circuits[0], batteryCapacityMWh: -1 };
    const body = { ...fixtures.powerOk, data: { ...fixtures.powerOk.data, circuits: [circuit] } };
    expect(PowerResponseSchema.safeParse(body).success).toBe(false);
  });

  it("rejects the old status field names (the renames are real, not aliases)", () => {
    const { tickHealth: _tickHealth, gamePaused: _gamePaused, ...rest } = fixtures.statusRunning.data;
    const legacyShaped = { ...fixtures.statusRunning, data: { ...rest, healthy: true, isPaused: false } };
    expect(StatusResponseSchema.safeParse(legacyShaped).success).toBe(false);
  });
});

describe("schemas accept what the contract allows", () => {
  it("accepts a production percent slightly above 100 (float noise in live data)", () => {
    const building = fixtures.factoryMixed.data.buildings[0];
    const noisy = { ...building, production: [{ ...building.production[0], percent: 100.0000079 }] };
    const body = { ...fixtures.factoryMixed, data: { buildings: [noisy], backedUpCount: 1 } };
    expect(FactoryResponseSchema.safeParse(body).success).toBe(true);
  });

  it("strips unknown keys when parsing, so an internal field can't leak through a parsed response", () => {
    const withExtra = { ...fixtures.serversSingle, internalHost: "10.0.0.5:7777" };
    expect(ServerListResponseSchema.parse(withExtra)).toEqual(fixtures.serversSingle);
  });
});

// ADR-0025 PR 4: additive contract pieces. Each one must leave an older peer's messages valid.
describe("ADR-0025 additive contract", () => {
  it("adds the forbidden and service_unavailable error codes without removing any", () => {
    for (const code of ["forbidden", "service_unavailable"]) {
      expect(KnownErrorCode.options).toContain(code);
    }
    expect(KnownErrorCode.options).toContain("unauthorized");
    expect(KnownErrorCode.options).toContain("server_not_found");
  });

  it("an error body with the new codes parses, and so does one with a code from the future", () => {
    expect(ApiErrorResponseSchema.safeParse(fixtures.errorForbidden).success).toBe(true);
    expect(ApiErrorResponseSchema.safeParse(fixtures.errorServiceUnavailable).success).toBe(true);
    expect(ApiErrorResponseSchema.safeParse(fixtures.errorUnknownCode).success).toBe(true);
  });

  it("readiness is exactly ok or unavailable, and nothing else can be smuggled in", () => {
    expect(ReadinessResponseSchema.safeParse({ status: "ok" }).success).toBe(true);
    expect(ReadinessResponseSchema.safeParse({ status: "unavailable" }).success).toBe(true);
    expect(ReadinessResponseSchema.safeParse({ status: "degraded" }).success).toBe(false);
    expect(ReadinessResponseSchema.safeParse({}).success).toBe(false);
    expect(ReadinessResponseSchema.parse({ status: "unavailable", dependency: "postgres://u:p@h/d" })).toEqual({ status: "unavailable" });
  });

  it("a session with email and authMethods parses, and an older one without them still does", () => {
    expect(SessionResponseSchema.parse(fixtures.sessionAuthenticatedWithAccount)).toEqual(fixtures.sessionAuthenticatedWithAccount);
    expect(SessionResponseSchema.safeParse(fixtures.sessionAuthenticated).success).toBe(true);
    expect(SessionResponseSchema.safeParse(fixtures.sessionAnonymous).success).toBe(true);
  });

  it("tolerates an auth method added later (a plain string array, not an enum)", () => {
    const future = { authenticated: true, user: { name: "Ann", authMethods: ["google", "passkey"] } };
    expect(SessionResponseSchema.safeParse(future).success).toBe(true);
    expect(SessionResponseSchema.safeParse({ authenticated: true, user: { name: "Ann", authMethods: "google" } }).success).toBe(false);
    expect(SessionResponseSchema.safeParse({ authenticated: true, user: { name: "Ann", email: 5 } }).success).toBe(false);
  });

  it("declares the readiness and sign-out-everywhere endpoints with the right methods and paths", () => {
    expect(endpoints.healthReady).toMatchObject({ method: "GET", route: "/api/health/ready" });
    expect(endpoints.healthReady.path()).toBe("/api/health/ready");
    expect(endpoints.auth.logoutAll).toMatchObject({ method: "POST", route: "/api/auth/logout-all" });
    expect("request" in endpoints.auth.logoutAll).toBe(false);
  });
});

describe("auth and settings schemas", () => {
  it("rejects an authenticated session without a user", () => {
    expect(SessionResponseSchema.safeParse({ authenticated: true }).success).toBe(false);
  });

  it("never passes a token through a session response, even if one is added by mistake", () => {
    const leaky = { ...fixtures.sessionAuthenticated, token: "secret-session-token" };
    expect(SessionResponseSchema.parse(leaky)).toEqual(fixtures.sessionAuthenticated);
  });

  it("rejects an empty or oversized login field", () => {
    for (const body of [
      { username: "", password: "x" },
      { username: "operator", password: "" },
      { username: "operator" },
      { username: "operator", password: "x".repeat(1025) },
      { username: "x".repeat(129), password: "x" },
    ]) {
      expect(LoginRequestSchema.safeParse(body).success, JSON.stringify(body).slice(0, 60)).toBe(false);
    }
  });

  it("requires a real boolean to toggle auto-pause (no string or number coercion)", () => {
    for (const enabled of ["true", 1, null]) {
      expect(SetAutoPauseRequestSchema.safeParse({ enabled }).success).toBe(false);
    }
  });
});

type Endpoint = { method: string; route: string; path: (serverId: string) => string };

// Flattens the nested groups (auth, settings) into "group.name" entries.
function flatEndpoints(): [string, Endpoint][] {
  return Object.entries(endpoints).flatMap(([name, value]): [string, Endpoint][] =>
    "route" in value
      ? [[name, value as Endpoint]]
      : Object.entries(value).map(([inner, endpoint]): [string, Endpoint] => [`${name}.${inner}`, endpoint as Endpoint]),
  );
}

describe("endpoints", () => {
  it("builds server-scoped paths and URL-encodes the server id", () => {
    expect(endpoints.power.path("default")).toBe("/api/servers/default/power");
    expect(endpoints.powerHistory.path("default")).toBe("/api/servers/default/power/history");
    expect(endpoints.powerHistory.path("a b")).toBe("/api/servers/a%20b/power/history");
    expect(endpoints.status.path("a b")).toBe("/api/servers/a%20b/status");
    expect(endpoints.health.path()).toBe("/api/health");
    expect(endpoints.settings.setAutoPause.path("default")).toBe("/api/servers/default/settings/auto-pause");
  });

  it("keeps each route pattern consistent with its path builder", () => {
    const all = flatEndpoints();
    expect(all.length).toBe(22);
    for (const [name, endpoint] of all) {
      expect(endpoint.path("default"), name).toBe(endpoint.route.replace(":serverId", "default"));
    }
  });

  it("gives every endpoint that takes a body a request schema, and no GET a body", () => {
    for (const [name, endpoint] of flatEndpoints()) {
      const hasRequest = "request" in endpoint;
      if (endpoint.method === "GET") {
        expect(hasRequest, name).toBe(false);
      }
    }
    expect("request" in endpoints.auth.login).toBe(true);
    expect("request" in endpoints.settings.setAutoPause).toBe(true);
  });
});

// ADR-0022: the power history contract.
describe("power history (ADR-0022)", () => {
  const { powerHistoryNormal, powerHistoryPaused, powerHistoryEmpty, powerHistoryFuseTrip } = fixtures;
  const allHistories = [powerHistoryNormal, powerHistoryPaused, powerHistoryEmpty, powerHistoryFuseTrip];

  it("uses the powerHistory schema, not the live power schema, for its fixtures", () => {
    expect(schemaFor("powerHistoryNormal")).toBe(PowerHistoryResponseSchema);
    expect(schemaFor("powerOk")).toBe(PowerResponseSchema);
    // A history fixture must not satisfy the live power schema by accident.
    expect(PowerResponseSchema.safeParse(powerHistoryNormal).success).toBe(false);
  });

  it("every series is in ascending time order, spaced by the interval, inside the window", () => {
    for (const history of allHistories) {
      const { windowSeconds, intervalSeconds, series } = history.data;
      for (const { points } of series) {
        expect(points.length).toBeLessThanOrEqual(windowSeconds / intervalSeconds);
        for (let i = 1; i < points.length; i++) {
          expect(points[i].t - points[i - 1].t).toBe(intervalSeconds * 1000);
        }
        expect(points.at(-1)!.t - points[0].t).toBeLessThanOrEqual(windowSeconds * 1000);
      }
    }
  });

  it("powerHistoryNormal is one full window of one circuit with no paused stretch", () => {
    expect(powerHistoryNormal.data.series).toHaveLength(1);
    expect(powerHistoryNormal.data.series[0].points).toHaveLength(60);
    expect(powerHistoryNormal.data.pausedRanges).toEqual([]);
  });

  it("powerHistoryPaused freezes the readings inside its paused range and nowhere else", () => {
    const [{ points }] = powerHistoryPaused.data.series;
    const [{ fromT, toT }] = powerHistoryPaused.data.pausedRanges;
    expect(fromT).toBeLessThanOrEqual(toT);
    const inside = points.filter((p) => p.t >= fromT && p.t <= toT);
    expect(inside.length).toBeGreaterThan(1);
    expect(new Set(inside.map((p) => p.productionMW)).size).toBe(1);
    const outside = points.filter((p) => p.t < fromT || p.t > toT);
    expect(new Set(outside.map((p) => p.productionMW)).size).toBeGreaterThan(1);
  });

  it("powerHistoryEmpty has no series and no paused ranges (right after start or a reset)", () => {
    expect(powerHistoryEmpty.data.series).toEqual([]);
    expect(powerHistoryEmpty.data.pausedRanges).toEqual([]);
  });

  it("powerHistoryFuseTrip trips one circuit mid-window: 0 readings from then on, the other circuit unaffected", () => {
    const [main, side] = powerHistoryFuseTrip.data.series;
    expect(main.points.every((p) => !p.fuseTriggered && p.productionMW > 0)).toBe(true);
    const tripIndex = side.points.findIndex((p) => p.fuseTriggered);
    expect(tripIndex).toBeGreaterThan(0);
    expect(tripIndex).toBeLessThan(side.points.length - 1);
    for (const [i, p] of side.points.entries()) {
      if (i < tripIndex) {
        expect([p.fuseTriggered, p.productionMW > 0]).toEqual([false, true]);
      } else {
        expect([p.fuseTriggered, p.productionMW, p.consumptionMW, p.capacityMW]).toEqual([true, 0, 0, 0]);
      }
    }
  });

  it("rejects malformed history: bad times, missing fields, non-positive window or interval", () => {
    const parse = (data: unknown) => PowerHistoryResponseSchema.safeParse({ ...powerHistoryNormal, data }).success;
    const good = JSON.parse(JSON.stringify(powerHistoryNormal.data)) as typeof powerHistoryNormal.data;
    expect(parse(good)).toBe(true);
    expect(parse({ ...good, windowSeconds: 0 })).toBe(false);
    expect(parse({ ...good, intervalSeconds: -5 })).toBe(false);
    expect(parse({ ...good, windowSeconds: 300.5 })).toBe(false);
    expect(parse({ ...good, pausedRanges: undefined })).toBe(false);
    expect(parse({ ...good, series: undefined })).toBe(false);
    const withPoint = (point: object) => ({ ...good, series: [{ circuitGroupId: 0, points: [point] }] });
    const point = good.series[0].points[0];
    expect(parse(withPoint(point))).toBe(true);
    expect(parse(withPoint({ ...point, t: -1 }))).toBe(false);
    expect(parse(withPoint({ ...point, t: 1.5 }))).toBe(false);
    expect(parse(withPoint({ ...point, t: "2026-09-22T22:42:39Z" }))).toBe(false);
    expect(parse(withPoint({ ...point, fuseTriggered: "no" }))).toBe(false);
    expect(parse(withPoint({ ...point, batteryPercent: -1 }))).toBe(false);
    const { productionMW: _dropped, ...missing } = point;
    expect(parse(withPoint(missing))).toBe(false);
    expect(parse({ ...good, pausedRanges: [{ fromT: 1 }] })).toBe(false);
    expect(parse({ ...good, series: [{ points: [point] }] })).toBe(false);
  });

  it("wraps the data in the shared snapshot envelope (ADR-0004)", () => {
    expect(PowerHistoryResponseSchema.safeParse({ ...powerHistoryNormal, stale: undefined }).success).toBe(false);
    expect(PowerHistoryResponseSchema.safeParse({ ...powerHistoryNormal, observedAt: "yesterday" }).success).toBe(false);
    expect(PowerHistoryResponseSchema.safeParse({ ...powerHistoryNormal, serverId: "Bad Id" }).success).toBe(false);
  });
});

// ADR-0029: the players fixtures are what the frontend's mock server serves, so their shape is pinned.
describe("players fixtures (ADR-0029)", () => {
  it("has three online and one offline player, all with obviously fake names, in the available fixture", () => {
    const { players } = fixtures.playersAvailable;
    expect(players.filter((p) => p.online).map((p) => p.name)).toEqual(["Pioneer-Alpha", "Pioneer-Bravo", "Pioneer-Charlie"]);
    expect(players.filter((p) => !p.online).map((p) => p.name)).toEqual(["Pioneer-Delta"]);
  });

  it("tells unavailable (no FRM) apart from empty (FRM, nobody yet)", () => {
    expect(fixtures.playersUnavailable).toEqual({ available: false, players: [] });
    expect(fixtures.playersEmpty).toEqual({ available: true, players: [] });
  });
});
