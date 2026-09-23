import { describe, it, expect } from "vitest";
import request from "supertest";
import { createFactoryRouter } from "./factory.js";
import { createApp } from "../app.js";
import { createLogger } from "../logger.js";
import { UpstreamError } from "../adapters/index.js";
import type { ProductionService } from "../services/productionService.js";

function buildApp(service: Pick<ProductionService, "getFactoryOverview">) {
  return createApp({ logger: createLogger(), routers: [createFactoryRouter(service as ProductionService)] });
}

describe("GET /api/factory", () => {
  it("returns the service's overview on success", async () => {
    const service = { getFactoryOverview: async () => ({ buildings: [], backedUpCount: 0 }) };
    const res = await request(buildApp(service)).get("/api/factory");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ buildings: [], backedUpCount: 0 });
  });

  it("returns 503 upstream_unreachable when the game server can't be reached", async () => {
    const service = {
      getFactoryOverview: async () => {
        throw new UpstreamError("server unreachable", { failureKind: "unreachable" });
      },
    };
    const res = await request(buildApp(service)).get("/api/factory");
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ code: "upstream_unreachable" });
  });

  it("round-trips a populated overview through JSON, including a null recipe and isBackedUp", async () => {
    const overview = {
      buildings: [
        {
          id: "b1",
          name: "Constructor",
          className: "Build_ConstructorMk1_C",
          recipe: null,
          isProducing: false,
          isPaused: true,
          isBackedUp: false,
          production: [{ name: "Concrete", className: "Desc_Cement_C", currentPerMinute: 0, maxPerMinute: 1.65, percent: 0 }],
        },
      ],
      backedUpCount: 0,
    };
    const service = { getFactoryOverview: async () => overview };
    const res = await request(buildApp(service)).get("/api/factory");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(overview);
    expect(res.body.buildings[0].recipe).toBeNull();
  });
});
