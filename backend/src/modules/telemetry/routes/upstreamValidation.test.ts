import { describe, it, expect } from "vitest";
import request from "supertest";
import { ApiErrorResponseSchema, endpoints } from "@satisfactory-dash/shared";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import { SatisfactoryServerAdapter } from "../../gameserver/index.js";
import {
  factoryBuildingFixture,
  powerCircuitFixture,
  queryServerStateFixture,
  healthCheckFixture,
} from "@satisfactory-dash/game-adapter/fixtures";
import { InMemoryServerDirectory } from "../../servers/index.js";
import { createTelemetryRouters, createTelemetryServices } from "../index.js";

/**
 * Architect rule (PR 1 review): every range the public contract asserts is enforced in
 * the adapter, so out-of-range upstream data is a 502 upstream_invalid_response -- never
 * a 500, which would mean our own bug. One test per data endpoint, through the real
 * adapter, service and route, with only the two HTTP clients stubbed.
 */
function appWithUpstream({ vanilla, frm }: { vanilla?: (fn: string) => unknown; frm?: (endpoint: string) => unknown }) {
  const adapter = new SatisfactoryServerAdapter(
    { call: async (fn: string) => vanilla?.(fn) as never },
    { get: async (endpoint: string) => frm?.(endpoint) as never },
  );
  const directory = new InMemoryServerDirectory([
    {
      id: "default",
      displayName: "Test server",
      services: { telemetry: createTelemetryServices(adapter) },
    },
  ]);
  return createApp({
    logger: createLogger(),
    routers: createTelemetryRouters(directory),
  });
}

async function expectInvalidUpstream(app: ReturnType<typeof appWithUpstream>, path: string) {
  const res = await request(app).get(path);
  expect(res.status).toBe(502);
  expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("upstream_invalid_response");
}

describe("out-of-range upstream data is a 502, not a 500", () => {
  it("status: a negative player count", async () => {
    const badState = {
      ...queryServerStateFixture,
      serverGameState: { ...queryServerStateFixture.serverGameState, numConnectedPlayers: -3 },
    };
    const app = appWithUpstream({ vanilla: (fn) => (fn === "HealthCheck" ? healthCheckFixture : badState) });
    await expectInvalidUpstream(app, endpoints.status.path("default"));
  });

  it("factory: a negative production rate", async () => {
    const bad = {
      ...factoryBuildingFixture,
      production: [{ ...factoryBuildingFixture.production![0], MaxProd: -10 }],
    };
    await expectInvalidUpstream(appWithUpstream({ frm: () => [bad] }), endpoints.factory.path("default"));
  });

  it("power: a negative battery capacity", async () => {
    const bad = { ...powerCircuitFixture, BatteryCapacity: -100 };
    await expectInvalidUpstream(appWithUpstream({ frm: () => [bad] }), endpoints.power.path("default"));
  });

  it("valid upstream data still returns 200 through the same pipeline", async () => {
    const app = appWithUpstream({ frm: () => [powerCircuitFixture] });
    const res = await request(app).get(endpoints.power.path("default"));
    expect(res.status).toBe(200);
  });
});
