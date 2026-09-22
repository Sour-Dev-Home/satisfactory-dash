import { describe, it, expect } from "vitest";
import { PowerService, classifyPowerCircuit } from "./powerService.js";
import type { PowerAdapterLike } from "./powerService.js";
import type { PowerCircuit } from "../adapters/domain.js";

function circuit(overrides: Partial<PowerCircuit> = {}): PowerCircuit {
  return {
    circuitGroupId: 0,
    powerProduction: 100,
    powerConsumed: 50,
    powerCapacity: 100,
    maxPowerConsumed: 100,
    fuseTriggered: false,
    batteryPercent: 50,
    batteryDifferential: 0,
    batteryCapacity: 100,
    ...overrides,
  };
}

describe("classifyPowerCircuit", () => {
  it("is outage when the fuse has tripped", () => {
    expect(classifyPowerCircuit(circuit({ fuseTriggered: true }))).toBe("outage");
  });

  it("is outage when consumption exceeds capacity, even without a tripped fuse", () => {
    expect(classifyPowerCircuit(circuit({ powerConsumed: 150, powerCapacity: 100 }))).toBe("outage");
  });

  it("is at_risk when batteries are draining and below the threshold", () => {
    expect(classifyPowerCircuit(circuit({ batteryDifferential: -5, batteryPercent: 10 }))).toBe("at_risk");
  });

  it("is ok when batteries are draining but still above the threshold", () => {
    expect(classifyPowerCircuit(circuit({ batteryDifferential: -5, batteryPercent: 50 }))).toBe("ok");
  });

  it("is ok when battery percent is low but batteries are charging, not draining", () => {
    expect(classifyPowerCircuit(circuit({ batteryDifferential: 5, batteryPercent: 5 }))).toBe("ok");
  });

  it("is ok at the exact threshold boundary (strictly less-than, not less-than-or-equal)", () => {
    expect(classifyPowerCircuit(circuit({ batteryDifferential: -1, batteryPercent: 20 }))).toBe("ok");
  });

  it("is ok for a plain steady-state circuit", () => {
    expect(classifyPowerCircuit(circuit())).toBe("ok");
  });

  // frm-getPower.md's own example response has PowerCapacity: 0, PowerConsumed: 0
  // together (a circuit with no generators connected yet) — confirming `powerConsumed
  // > powerCapacity` (strict) rather than `>=` is the right boundary, since an
  // idle/empty circuit at 0/0 must not read as an outage.
  it("is ok when consumption exactly equals capacity (strictly greater-than, not greater-or-equal)", () => {
    expect(classifyPowerCircuit(circuit({ powerConsumed: 100, powerCapacity: 100 }))).toBe("ok");
  });

  it("outage takes precedence over at_risk when both conditions are true", () => {
    const c = circuit({ fuseTriggered: true, batteryDifferential: -10, batteryPercent: 1 });
    expect(classifyPowerCircuit(c)).toBe("outage");
  });

  it("is ok, not outage, for an idle circuit with zero capacity and zero consumption (matches frm-getPower.md's example response)", () => {
    expect(classifyPowerCircuit(circuit({ powerConsumed: 0, powerCapacity: 0, powerProduction: 0 }))).toBe("ok");
  });
});

describe("PowerService", () => {
  it("maps circuits and flags hasOutage when any circuit is in outage", async () => {
    const adapter: PowerAdapterLike = {
      getPowerCircuits: async () => [circuit({ circuitGroupId: 0 }), circuit({ circuitGroupId: 1, fuseTriggered: true })],
    };
    const service = new PowerService(adapter);
    const overview = await service.getPowerOverview();
    expect(overview.hasOutage).toBe(true);
    expect(overview.circuits.map((c) => [c.circuitGroupId, c.status])).toEqual([
      [0, "ok"],
      [1, "outage"],
    ]);
  });

  it("does not flag hasOutage when no circuit is in outage", async () => {
    const adapter: PowerAdapterLike = { getPowerCircuits: async () => [circuit()] };
    const service = new PowerService(adapter);
    await expect(service.getPowerOverview()).resolves.toMatchObject({ hasOutage: false });
  });

  // hasOutage is defined (services/powerService.ts) as `.some(status === "outage")` —
  // an all-at_risk fleet of circuits (batteries draining, none tripped/over-capacity
  // yet) must NOT set hasOutage, even though every circuit is degraded. Confirms the
  // route/UI can't conflate "at risk" with "outage" via this flag.
  it("does not flag hasOutage when every circuit is at_risk but none is an outage", async () => {
    const adapter: PowerAdapterLike = {
      getPowerCircuits: async () => [
        circuit({ circuitGroupId: 0, batteryDifferential: -1, batteryPercent: 5 }),
        circuit({ circuitGroupId: 1, batteryDifferential: -1, batteryPercent: 5 }),
      ],
    };
    const service = new PowerService(adapter);
    const overview = await service.getPowerOverview();
    expect(overview.hasOutage).toBe(false);
    expect(overview.circuits.every((c) => c.status === "at_risk")).toBe(true);
  });

  it("returns an empty overview for zero circuits", async () => {
    const adapter: PowerAdapterLike = { getPowerCircuits: async () => [] };
    const service = new PowerService(adapter);
    await expect(service.getPowerOverview()).resolves.toEqual({ circuits: [], hasOutage: false });
  });
});
