import { describe, expect, it } from "vitest";
import type { z } from "zod";
import * as fixtures from "../fixtures/index";
import {
  ApiErrorResponseSchema,
  FactoryResponseSchema,
  HealthResponseSchema,
  PowerResponseSchema,
  ServerListResponseSchema,
  StatusResponseSchema,
  endpoints,
} from "../src/index";

// Every fixture is matched to its schema by name prefix, so a fixture added later can't
// be skipped by forgetting to list it here: an unmatched export fails the first test.
const schemaByPrefix: [string, z.ZodType][] = [
  ["power", PowerResponseSchema],
  ["status", StatusResponseSchema],
  ["factory", FactoryResponseSchema],
  ["servers", ServerListResponseSchema],
  ["error", ApiErrorResponseSchema],
  ["health", HealthResponseSchema],
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

describe("endpoints", () => {
  it("builds server-scoped paths and URL-encodes the server id", () => {
    expect(endpoints.power.path("default")).toBe("/api/servers/default/power");
    expect(endpoints.status.path("a b")).toBe("/api/servers/a%20b/status");
    expect(endpoints.health.path()).toBe("/api/health");
  });

  it("keeps each route pattern consistent with its path builder", () => {
    for (const [name, endpoint] of Object.entries(endpoints)) {
      expect(endpoint.path("default"), name).toBe(endpoint.route.replace(":serverId", "default"));
    }
  });
});
