import { describe, it, expect } from "vitest";
import request from "supertest";
import { FactoryResponseSchema, ProductionRateSchema, endpoints } from "@satisfactory-dash/shared";
import { factoryMixed, factoryUnknownItem } from "@satisfactory-dash/shared/fixtures";
import { createApp } from "../../../app.js";
import { createLogger } from "../../../platform/logger.js";
import { InMemoryServerDirectory } from "../../servers/index.js";
import { SatisfactoryServerAdapter } from "../../gameserver/index.js";
import {
  capturedBackedUpAssembler,
  capturedFuelRefinery,
  capturedTrippedGridRefinery,
  capturedUnassignedAssembler,
} from "../../gameserver/__fixtures__/capturedFixtures.js";
import { ProductionService } from "../services/productionService.js";
import { createFactoryRouter } from "./factory.js";

function appWith(production: { getFactoryOverview: () => Promise<any> }) {
  const directory = new InMemoryServerDirectory([
    {
      id: "default",
      displayName: "Home",
      services: { telemetry: { status: {} as never, production, power: {} as never, powerHistory: {} as never, players: {} as never } },
    },
  ]);
  return createApp({ logger: createLogger(), routers: [createFactoryRouter(directory)] });
}

describe("factory response carries unit (ADR-0015)", () => {
  it("real captured FRM data via adapter + ProductionService + Express: units come from the catalog and it validates", async () => {
    const adapter = new SatisfactoryServerAdapter(
      { call: async () => undefined as never },
      {
        get: async () =>
          [capturedBackedUpAssembler, capturedFuelRefinery, capturedTrippedGridRefinery, capturedUnassignedAssembler] as never,
      },
    );
    const res = await request(appWith(new ProductionService(adapter))).get(endpoints.factory.path("default"));
    expect(res.status).toBe(200);
    expect(FactoryResponseSchema.parse(res.body)).toEqual(res.body);
    const rates = res.body.data.buildings.flatMap((b: any) => b.production);
    expect(rates.length).toBeGreaterThan(0);
    for (const rate of rates) {
      // The backend always sends the field, even though the contract makes it optional.
      expect(Object.keys(rate).sort()).toEqual(Object.keys(ProductionRateSchema.shape).sort());
    }
    // The captured refinery: Fuel is a liquid (m3/min), Polymer Resin a solid (items/min).
    const unitOf = (className: string) => rates.find((r: any) => r.className === className)?.unit;
    expect(unitOf("Desc_LiquidFuel_C")).toBe("m3/min");
    expect(unitOf("Desc_PolymerResin_C")).toBe("items/min");
    expect(unitOf("Desc_IronPlateReinforced_C")).toBe("items/min");
  });

  it("real units and unknown-item fixtures survive the HTTP round trip unchanged", async () => {
    for (const fx of [factoryMixed, factoryUnknownItem]) {
      const res = await request(appWith({ getFactoryOverview: async () => fx.data })).get(endpoints.factory.path("default"));
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(fx.data);
    }
  });

  it("a rate with an invalid unit is rejected by the route, not passed through", async () => {
    const bad = structuredClone(factoryMixed.data) as any;
    const b = bad.buildings.find((x: any) => x.production.length > 0);
    b.production[0].unit = "L/min";
    const res = await request(appWith({ getFactoryOverview: async () => bad })).get(endpoints.factory.path("default"));
    expect(res.status).toBeGreaterThanOrEqual(500);
  });

  // The contract keeps `unit` optional (deploy skew, ADR-0007), so the route accepts a
  // rate without it; the real ProductionService always sends it (first test above).
  it("a rate missing unit entirely is accepted (optional in the contract)", async () => {
    const old = structuredClone(factoryMixed.data) as any;
    const b = old.buildings.find((x: any) => x.production.length > 0);
    delete b.production[0].unit;
    const res = await request(appWith({ getFactoryOverview: async () => old })).get(endpoints.factory.path("default"));
    expect(res.status).toBe(200);
    expect(res.body.data.buildings.find((x: any) => x.production.length > 0).production[0]).not.toHaveProperty("unit");
  });
});
