import { describe, expect, it, vi } from "vitest";
import { totalPowerProductionMW } from "./totalPowerProduction.js";
import { SatisfactoryServerAdapter } from "./satisfactoryServerAdapter.js";
import { powerCircuitFixture } from "../fixtures/rawFixtures.js";

describe("totalPowerProductionMW", () => {
  it("uses consumption when base production reads below it (test-server case 0 / 4 -> 4)", () => {
    expect(totalPowerProductionMW(0, 4)).toBe(4);
  });

  it("keeps base production when it exceeds consumption (3633 / 1314 -> 3633)", () => {
    expect(totalPowerProductionMW(3633, 1314)).toBe(3633);
  });

  it("returns the shared value when equal", () => {
    expect(totalPowerProductionMW(50, 50)).toBe(50);
  });

  it.each([
    [NaN, 4, 4],
    [Infinity, 4, 4],
    [-5, 4, 4],
    [10, NaN, 10],
    [10, -3, 10],
    [NaN, NaN, 0],
    [-1, -1, 0],
  ])("guards garbage inputs (%s, %s -> %s)", (base, consumed, expected) => {
    expect(totalPowerProductionMW(base, consumed)).toBe(expected);
  });
});

describe("getPowerCircuits total production", () => {
  it("derives powerProduction from base production and consumption", async () => {
    const raw = { ...powerCircuitFixture, PowerProduction: 0, PowerConsumed: 4 };
    const adapter = new SatisfactoryServerAdapter(
      { call: vi.fn() } as never,
      { get: vi.fn().mockResolvedValue([raw]) } as never,
    );
    const [circuit] = await adapter.getPowerCircuits();
    expect(circuit?.powerProduction).toBe(4);
  });
});
