import { describe, it, expect } from "vitest";
import { SatisfactoryServerAdapter } from "./satisfactoryServerAdapter.js";
import { ProductionService } from "../telemetry/services/productionService.js";
import { capturedBackedUpAssembler, capturedFuelRefinery } from "./__fixtures__/capturedFixtures.js";

// ADR-0027 amendment 2: FRM's ManuSpeed (configured speed in percent, frm-getFactory.md:54; the committed
// 2026-09-22 running capture has six machines at 100 and one at 160) becomes the optional `clockSpeedPercent`.

function adapterFor(...raw: unknown[]) {
  return new SatisfactoryServerAdapter({ call: async () => undefined as never }, { get: async () => raw as never });
}

describe("clock speed mapping (FRM ManuSpeed)", () => {
  it("maps ManuSpeed to clockSpeedPercent, unchanged (100 = default clock, above 100 = overclocked)", async () => {
    const [normal, half, over] = await adapterFor(
      { ...capturedBackedUpAssembler, ManuSpeed: 100 },
      { ...capturedBackedUpAssembler, ManuSpeed: 50 },
      { ...capturedBackedUpAssembler, ManuSpeed: 160 },
    ).getFactoryBuildings();
    expect(normal?.clockSpeedPercent).toBe(100);
    expect(half?.clockSpeedPercent).toBe(50);
    expect(over?.clockSpeedPercent).toBe(160);
  });

  it("keeps a fractional speed as sent", async () => {
    const [building] = await adapterFor({ ...capturedBackedUpAssembler, ManuSpeed: 133.333 }).getFactoryBuildings();
    expect(building?.clockSpeedPercent).toBe(133.333);
  });

  it("omits it when FRM sends none (an older FRM, or a building type without a speed)", async () => {
    const withoutSpeed: Record<string, unknown> = { ...capturedFuelRefinery };
    delete withoutSpeed.ManuSpeed;
    const [building] = await adapterFor(withoutSpeed).getFactoryBuildings();
    expect(building).not.toHaveProperty("clockSpeedPercent");
  });

  it("omits a clock of 0 or less (not a meaningful setting; the architect's call), but keeps any positive one, mods included", async () => {
    const [zero, negative, tiny, huge] = await adapterFor(
      { ...capturedBackedUpAssembler, ManuSpeed: 0 },
      { ...capturedBackedUpAssembler, ManuSpeed: -5 },
      { ...capturedBackedUpAssembler, ManuSpeed: 0.01 },
      { ...capturedBackedUpAssembler, ManuSpeed: 1000 },
    ).getFactoryBuildings();
    expect(zero).not.toHaveProperty("clockSpeedPercent");
    expect(negative).not.toHaveProperty("clockSpeedPercent");
    expect(tiny?.clockSpeedPercent).toBe(0.01);
    expect(huge?.clockSpeedPercent).toBe(1000); // no upper bound
  });

  it.each([
    ["null", null],
    ["a string", "160"],
    ["an object", { value: 160 }],
    ["NaN", Number.NaN],
    ["Infinity (JSON 1e999)", JSON.parse("1e999") as number],
    ["-Infinity", -Infinity],
  ])("omits it, and still maps the building, when ManuSpeed is %s", async (_name, value) => {
    const [building] = await adapterFor({ ...capturedBackedUpAssembler, ManuSpeed: value }).getFactoryBuildings();
    expect(building).not.toHaveProperty("clockSpeedPercent");
    expect(building?.id).toBe(capturedBackedUpAssembler.ID);
  });

  it("does not disturb the other buildings of the same response", async () => {
    const buildings = await adapterFor(
      { ...capturedBackedUpAssembler, ManuSpeed: "bad" },
      { ...capturedFuelRefinery, ManuSpeed: 160 },
    ).getFactoryBuildings();
    expect(buildings).toHaveLength(2);
    expect(buildings[0]).not.toHaveProperty("clockSpeedPercent");
    expect(buildings[1]?.clockSpeedPercent).toBe(160);
  });
});

describe("the factory overview carries clockSpeedPercent", () => {
  it("passes it to the response when known and leaves it out when not", async () => {
    const service = new ProductionService(
      adapterFor({ ...capturedBackedUpAssembler, ManuSpeed: 160 }, { ...capturedFuelRefinery, ManuSpeed: undefined }),
      () => null,
    );
    const { buildings } = await service.getFactoryOverview();
    expect(buildings[0]?.clockSpeedPercent).toBe(160);
    expect(buildings[1]).not.toHaveProperty("clockSpeedPercent");
  });
});
