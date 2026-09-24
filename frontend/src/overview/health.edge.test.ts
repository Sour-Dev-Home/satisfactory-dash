import { describe, expect, it } from "vitest";
import { factoryMixed, powerAtRisk, powerOk, powerOutage } from "@satisfactory-dash/shared/fixtures";
import type { FactoryResponse, PowerResponse } from "@satisfactory-dash/shared";
import { factoryHealth, overallHealth, powerHealth, type SectionHealth } from "./health";

// Fresh-eyes pass (test-hunter) over the Overview aggregation: boundaries, plurals, and how
// the banner reads when sections disagree.

function factoryWith(total: number, backedUp: number): FactoryResponse {
  const building = factoryMixed.data.buildings[0];
  return {
    ...factoryMixed,
    stale: false,
    data: {
      ...factoryMixed.data,
      buildings: Array.from({ length: total }, (_, i) => ({ ...building, isBackedUp: i < backedUp })),
      backedUpCount: backedUp,
    },
  };
}

const section = (health: SectionHealth["health"]): SectionHealth => ({ health, summary: "" });

describe("factoryHealth edges", () => {
  it("is ok at exactly a quarter backed up, degraded just above it", () => {
    expect(factoryHealth(factoryWith(4, 1)).health).toBe("ok");
    expect(factoryHealth(factoryWith(8, 2)).health).toBe("ok");
    expect(factoryHealth(factoryWith(7, 2)).health).toBe("degraded");
  });

  it("uses the singular when the only machine is backed up", () => {
    expect(factoryHealth(factoryWith(1, 1)).summary).toBe("1 of 1 machine backed up");
  });
});

describe("powerHealth edges", () => {
  it("uses the singular for one circuit at risk and one tripped fuse", () => {
    const one = (p: PowerResponse, status: "at_risk" | "outage"): PowerResponse => ({
      ...p,
      stale: false,
      data: { ...p.data, circuits: [{ ...p.data.circuits.find((c) => c.status === status)! }] },
    });
    expect(powerHealth(one(powerAtRisk, "at_risk")).summary).toBe("1 circuit is at risk");
    expect(powerHealth(one(powerOutage, "outage")).summary).toBe("1 circuit has a tripped fuse");
  });

  it("still reports an outage the backend flagged with no outage circuit in the list", () => {
    const flagged: PowerResponse = { ...powerOk, data: { ...powerOk.data, hasOutage: true } };
    expect(powerHealth(flagged)).toEqual({ health: "outage", summary: "Outage reported" });
  });
});

describe("overallHealth when sections disagree", () => {
  it("is ok with no sections", () => {
    expect(overallHealth([]).health).toBe("ok");
  });

  it("ranks a failed section above a degraded one and below an outage", () => {
    expect(overallHealth([section("degraded"), "error"]).health).toBe("unavailable");
    expect(overallHealth(["error", section("outage")]).health).toBe("outage");
  });

  it("shows a known warning while another section is still loading", () => {
    expect(overallHealth([section("degraded"), "pending"])).toEqual({
      health: "degraded",
      headline: "Running with warnings",
    });
    expect(overallHealth(["pending", "error"]).health).toBe("unavailable");
  });

  // The doc comment says loading sections "only hold back an all clear". A paused game isn't
  // an all clear, yet it's held back to "Checking…" while degraded is not.
  it("shows a paused game while another section is still loading", () => {
    expect(overallHealth([section("paused"), "pending"])).toEqual({ health: "paused", headline: "Game paused" });
  });
});
