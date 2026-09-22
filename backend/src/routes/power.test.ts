import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { createPowerRouter } from "./power.js";
import type { PowerService } from "../services/powerService.js";

function buildApp(service: Pick<PowerService, "getPowerOverview">) {
  const app = express();
  app.use("/api", createPowerRouter(service as PowerService));
  return app;
}

describe("GET /api/power", () => {
  it("returns the service's overview on success", async () => {
    const service = { getPowerOverview: async () => ({ circuits: [], hasOutage: false }) };
    const res = await request(buildApp(service)).get("/api/power");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ circuits: [], hasOutage: false });
  });

  it("returns 503 with an error body when the service throws", async () => {
    const service = {
      getPowerOverview: async () => {
        throw new Error("server unreachable");
      },
    };
    const res = await request(buildApp(service)).get("/api/power");
    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty("error");
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
