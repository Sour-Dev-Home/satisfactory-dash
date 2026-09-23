import { describe, it, expect } from "vitest";
import request from "supertest";
import {
  ApiErrorResponseSchema,
  FactoryResponseSchema,
  PowerResponseSchema,
  ServerListResponseSchema,
  StatusResponseSchema,
  endpoints,
} from "@satisfactory-dash/shared";
import { factoryMixed, powerOutage, statusRunning, statusSlow } from "@satisfactory-dash/shared/fixtures";
import type { z } from "zod";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import { UpstreamError } from "../../../platform/errors.js";
import { InMemoryServerDirectory, createServersRouter } from "../../servers/index.js";
import type { TelemetryServices as ServerServices } from "../telemetryServices.js";
import { createStatusRouter } from "./status.js";
import { createFactoryRouter } from "./factory.js";
import { createPowerRouter } from "./power.js";

// Stub services return the shared contract fixtures' data, so the backend is tested
// against the same example responses the frontend's mock server uses (ADR-0002).
function stubServices(overrides: Partial<ServerServices> = {}): ServerServices {
  return {
    status: { getStatus: async () => statusRunning.data },
    production: { getFactoryOverview: async () => factoryMixed.data },
    power: { getPowerOverview: async () => powerOutage.data },
    ...overrides,
  };
}

function buildApp(services: ServerServices = stubServices()) {
  const directory = new InMemoryServerDirectory([
    { id: "default", displayName: "Home base", services: { telemetry: services } },
  ]);
  return createApp({
    logger: createLogger(),
    routers: [
      createServersRouter(directory),
      createStatusRouter(directory),
      createFactoryRouter(directory),
      createPowerRouter(directory),
    ],
  });
}

const failing = (err: unknown) => async () => {
  throw err;
};

// One row per server-scoped data endpoint.
const dataEndpoints: [string, { path: (id: string) => string }, z.ZodType, unknown, (s: ServerServices, fn: () => Promise<never>) => ServerServices][] = [
  ["status", endpoints.status, StatusResponseSchema, statusRunning.data, (s, fn) => ({ ...s, status: { getStatus: fn } })],
  ["factory", endpoints.factory, FactoryResponseSchema, factoryMixed.data, (s, fn) => ({ ...s, production: { getFactoryOverview: fn } })],
  ["power", endpoints.power, PowerResponseSchema, powerOutage.data, (s, fn) => ({ ...s, power: { getPowerOverview: fn } })],
];

describe("GET /api/servers", () => {
  it("lists the configured server by id and display name only", async () => {
    const res = await request(buildApp()).get(endpoints.servers.path());
    expect(res.status).toBe(200);
    expect(ServerListResponseSchema.parse(res.body)).toEqual(res.body);
    expect(res.body).toEqual({ servers: [{ id: "default", displayName: "Home base" }] });
  });
});

describe.each(dataEndpoints)("GET /api/servers/:serverId/%s", (_name, endpoint, schema, data, withService) => {
  it("returns the snapshot envelope around the service's data, and it matches the contract", async () => {
    const before = Date.now();
    const res = await request(buildApp()).get(endpoint.path("default"));
    expect(res.status).toBe(200);
    expect(schema.parse(res.body)).toEqual(res.body);
    expect(res.body).toMatchObject({ serverId: "default", stale: false, data });
    expect(Date.parse(res.body.observedAt)).toBeGreaterThanOrEqual(before - 1000);
  });

  it("answers an unknown server id with 404 server_not_found", async () => {
    const res = await request(buildApp()).get(endpoint.path("other"));
    expect(res.status).toBe(404);
    expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("server_not_found");
  });

  it.each(["Default", "a_b", "x".repeat(33)])("answers a malformed server id %s with 400 bad_request", async (id) => {
    const res = await request(buildApp()).get(endpoint.path(id));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("bad_request");
  });

  it("returns 503 upstream_unreachable when the game server can't be reached", async () => {
    const services = withService(stubServices(), failing(new UpstreamError("down", { failureKind: "unreachable" })));
    const res = await request(buildApp(services)).get(endpoint.path("default"));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("upstream_unreachable");
  });

  // ADR-0002: responses are validated on the way out and the PARSED body is sent, so
  // a field a service adds by accident is stripped rather than leaked.
  it("strips a field the contract doesn't know about", async () => {
    const leaky = async () => ({ ...(data as object), internalHost: "10.0.0.5:8080" }) as never;
    const res = await request(buildApp(withService(stubServices(), leaky))).get(endpoint.path("default"));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("10.0.0.5");
  });

  it("answers a contract-violating service result with 500 internal (our own bug), not bad data", async () => {
    const broken = async () => ({ nonsense: true }) as never;
    const res = await request(buildApp(withService(stubServices(), broken))).get(endpoint.path("default"));
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("internal");
  });
});

describe("contract details worth pinning", () => {
  it("passes a slow tick health through as 200, not an error", async () => {
    const services = stubServices({ status: { getStatus: async () => statusSlow.data } });
    const res = await request(buildApp(services)).get(endpoints.status.path("default"));
    expect(res.status).toBe(200);
    expect(res.body.data.tickHealth).toBe("slow");
  });

  it("round-trips a null recipe and isBackedUp through the factory route", async () => {
    const res = await request(buildApp()).get(endpoints.factory.path("default"));
    const unconfigured = res.body.data.buildings.find((b: { recipe: unknown }) => b.recipe === null);
    expect(unconfigured).toMatchObject({ recipe: null, production: [], isBackedUp: false });
    expect(res.body.data.backedUpCount).toBe(factoryMixed.data.backedUpCount);
  });

  it("sets hasOutage from the tripped circuit and keeps both circuits", async () => {
    const res = await request(buildApp()).get(endpoints.power.path("default"));
    expect(res.body.data.hasOutage).toBe(true);
    expect(res.body.data.circuits.map((c: { status: string }) => c.status)).toEqual(["ok", "outage"]);
  });

  // ADR-0001: the unscoped routes are gone in one step (ADR-0007: no deployed
  // consumer yet), and now fall through to the not_found catch-all.
  it.each(["/api/status", "/api/factory", "/api/power"])("no longer serves the unscoped %s", async (path) => {
    const res = await request(buildApp()).get(path);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });
});
