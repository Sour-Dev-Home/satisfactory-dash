import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { FactoryBuilding } from "../domain.js";
import { classifyBuilding } from "./classifyBuilding.js";
import { isBackedUp } from "../factoryStates.js";

/**
 * ADR-0066 build PR 7: the domain-shaped buildings, keyed by snapshot. Each list is what the game adapter
 * (packages/game-adapter, removed in that PR) mapped the matching capture to, committed as its output, unchanged:
 *   - "01-running": docs-vault/raw-sources/captured-responses/frm-getFactory-2026-09-22-01-running-trimmed.json
 *   - "CJ-norecipe-fuse": docs-vault/raw-sources/captured-responses/frm-getFactory-2026-09-22-CJ-norecipe-fuse-trimmed.json
 */
const BUILDINGS = new URL("./__fixtures__/machineStates.buildings.json", import.meta.url);
const GOLDEN = new URL("./__golden__/machineStates.golden.json", import.meta.url);

const snapshots = JSON.parse(readFileSync(BUILDINGS, "utf8")) as Record<string, FactoryBuilding[]>;

/** building id -> state (or "none" when the classifier declines). */
function replay(name: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const building of snapshots[name]!) {
    result[building.id] = classifyBuilding(building, isBackedUp(building))?.state ?? "none";
  }
  return result;
}

// ADR-0027 PR 2: the captured 2026-09-22 snapshots (10 buildings) through the classifier. The golden file is the
// expected outcome, checked in; a change to a rule or the threshold must show up here as a reviewed diff. Two
// snapshots is thin evidence: the thresholds are provisional (see classifyBuilding.ts) and a capture session should
// tune them.
describe("machine states replayed over the captured factory snapshots", () => {
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, Record<string, string>>;

  it("classifies the 01-running snapshot as the golden file says", () => {
    expect(replay("01-running")).toEqual(golden["01-running"]);
  });

  it("classifies the CJ tripped-fuse / no-recipe snapshot as the golden file says", () => {
    expect(replay("CJ-norecipe-fuse")).toEqual(golden["CJ-norecipe-fuse"]);
  });

  it("agrees with what the captures document (the findings in their headers)", () => {
    const running = replay("01-running");
    // B1: a full output slot with IsProducing false is backed up, not "idle" or "producing".
    expect(running["Build_AssemblerMk1_C_2147069774"]).toBe("backedUp");
    // -1 = not connected to power.
    expect(running["Build_ConstructorMk1_C_2147160359"]).toBe("unpowered");
    // B2: an unconfigured machine (recipe "Unassigned") is idle.
    expect(running["Build_AssemblerMk1_C_2145959128"]).toBe("idle");
    const cj = replay("CJ-norecipe-fuse");
    // ADR-0027 amendment 2: 9.4 percent of the set rate with a non-full output is underfed (it was "producing"
    // under the old 5 percent rule). The 160 percent-clock stator (24.7 percent, output full) stays backedUp.
    expect(running["Build_AssemblerMk1_C_2147397136"]).toBe("underfed");
    expect(running["Build_AssemblerMk1_C_2147356083"]).toBe("backedUp");
    // B3: a machine on the tripped grid is unpowered even though it has no recipe either.
    expect(cj["Build_OilRefinery_C_2147458064"]).toBe("unpowered");
  });
});
