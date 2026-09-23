import { describe, it, expect } from "vitest";
import request from "supertest";
import { createPowerRouter } from "./power.js";
import { createApp } from "../app.js";
import { createLogger } from "../logger.js";
import { UpstreamError } from "../adapters/index.js";
import type { PowerService } from "../services/powerService.js";

function buildApp(service: Pick<PowerService, "getPowerOverview">) {
  return createApp({ logger: createLogger(), routers: [createPowerRouter(service as PowerService)] });
}

describe("GET /api/power", () => {
  it("returns the service's overview on success", async () => {
    const service = { getPowerOverview: async () => ({ circuits: [], hasOutage: false }) };
    const res = await request(buildApp(service)).get("/api/power");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ circuits: [], hasOutage: false });
  });

  it("returns 503 upstream_unreachable when the game server can't be reached", async () => {
    const service = {
      getPowerOverview: async () => {
        throw new UpstreamError("server unreachable", { failureKind: "unreachable" });
      },
    };
    const res = await request(buildApp(service)).get("/api/power");
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ code: "upstream_unreachable" });
  });

  it("round-trips a populated overview through JSON, including at_risk circuits not tripping hasOutage", async () => {
    const overview = {
      circuits: [
        {
          circuitGroupId: 0,
          powerProduction: 90,
          powerConsumed: 100,
          powerCapacity: 100,
          fuseTriggered: false,
          batteryPercent: 5,
          batteryDifferential: -10,
          status: "at_risk" as const,
        },
      ],
      hasOutage: false,
    };
    const service = { getPowerOverview: async () => overview };
    const res = await request(buildApp(service)).get("/api/power");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(overview);
  });
});
