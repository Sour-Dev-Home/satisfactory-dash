import { describe, it, expect } from "vitest";
import request from "supertest";
import { ApiErrorResponseSchema } from "@satisfactory-dash/shared";
import { createApp } from "../app.js";
import { createLogger } from "../logger.js";
import { SatisfactoryServerAdapter } from "../adapters/index.js";
import {
  factoryBuildingFixture,
  powerCircuitFixture,
  queryServerStateFixture,
  healthCheckFixture,
} from "../adapters/__fixtures__/rawFixtures.js";
import { ServerStatusService } from "../services/serverStatusService.js";
import { ProductionService } from "../services/productionService.js";
import { PowerService } from "../services/powerService.js";
import { createStatusRouter } from "./status.js";
import { createFactoryRouter } from "./factory.js";
import { createPowerRouter } from "./power.js";

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
  return createApp({
    logger: createLogger(),
    routers: [
      createStatusRouter(new ServerStatusService(adapter)),
      createFactoryRouter(new ProductionService(adapter)),
      createPowerRouter(new PowerService(adapter)),
    ],
  });
}

async function expectInvalidUpstream(app: ReturnType<typeof appWithUpstream>, path: string) {
  const res = await request(app).get(path);
  expect(res.status).toBe(502);
  expect(ApiErrorResponseSchema.parse(res.body).error.code).toBe("upstream_invalid_response");
}

describe("out-of-range upstream data is a 502, not a 500", () => {
  it("/api/status: a negative player count", async () => {
    const badState = {
      ...queryServerStateFixture,
      serverGameState: { ...queryServerStateFixture.serverGameState, numConnectedPlayers: -3 },
    };
    const app = appWithUpstream({ vanilla: (fn) => (fn === "HealthCheck" ? healthCheckFixture : badState) });
    await expectInvalidUpstream(app, "/api/status");
  });

  it("/api/factory: a negative production rate", async () => {
    const bad = {
      ...factoryBuildingFixture,
      production: [{ ...factoryBuildingFixture.production![0], MaxProd: -10 }],
    };
    await expectInvalidUpstream(appWithUpstream({ frm: () => [bad] }), "/api/factory");
  });

  it("/api/power: a negative battery capacity", async () => {
    const bad = { ...powerCircuitFixture, BatteryCapacity: -100 };
    await expectInvalidUpstream(appWithUpstream({ frm: () => [bad] }), "/api/power");
  });

  it("valid upstream data still returns 200 through the same pipeline", async () => {
    const app = appWithUpstream({ frm: () => [powerCircuitFixture] });
    const res = await request(app).get("/api/power");
    expect(res.status).toBe(200);
  });
});
