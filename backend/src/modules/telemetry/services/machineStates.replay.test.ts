import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SatisfactoryServerAdapter } from "../../gameserver/index.js";
import { classifyBuilding } from "./classifyBuilding.js";
import { isBackedUp } from "./productionService.js";

const CAPTURES = new URL("../../../../../docs-vault/raw-sources/captured-responses/", import.meta.url);
const GOLDEN = new URL("./__golden__/machineStates.golden.json", import.meta.url);

/** The captures start with a few lines of provenance, then `---`, then the JSON array. */
function loadCapture(name: string): unknown {
  const text = readFileSync(new URL(name, CAPTURES), "utf8");
  return JSON.parse(text.slice(text.search(/^\[/m)));
}

/** building id -> state (or "none" when the classifier declines), through the real adapter mapping. */
async function replay(name: string): Promise<Record<string, string>> {
  const adapter = new SatisfactoryServerAdapter(
    { call: async () => Promise.reject(new Error("vanilla is not used")) },
    { get: async <T>() => loadCapture(name) as T },
  );
  const result: Record<string, string> = {};
  for (const building of await adapter.getFactoryBuildings()) {
    result[building.id] = classifyBuilding(building, isBackedUp(building))?.state ?? "none";
  }
  return result;
}

// ADR-0027 PR 2: the captured 2026-09-22 snapshots (10 buildings) through the real adapter and the
// classifier. The golden file is the expected outcome, checked in; a change to a rule or the
// threshold must show up here as a reviewed diff. Two snapshots is thin evidence: the thresholds
// are provisional (see classifyBuilding.ts) and a capture session should tune them.
describe("machine states replayed over the captured factory snapshots", () => {
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, Record<string, string>>;

  it("classifies the 01-running snapshot as the golden file says", async () => {
    expect(await replay("frm-getFactory-2026-09-22-01-running-trimmed.json")).toEqual(golden["01-running"]);
  });

  it("classifies the CJ tripped-fuse / no-recipe snapshot as the golden file says", async () => {
    expect(await replay("frm-getFactory-2026-09-22-CJ-norecipe-fuse-trimmed.json")).toEqual(golden["CJ-norecipe-fuse"]);
  });

  it("agrees with what the captures document (the findings in their headers)", async () => {
    const running = await replay("frm-getFactory-2026-09-22-01-running-trimmed.json");
    // B1: a full output slot with IsProducing false is backed up, not "idle" or "producing".
    expect(running["Build_AssemblerMk1_C_2147069774"]).toBe("backedUp");
    // -1 = not connected to power.
    expect(running["Build_ConstructorMk1_C_2147160359"]).toBe("unpowered");
    // B2: an unconfigured machine (recipe "Unassigned") is idle.
    expect(running["Build_AssemblerMk1_C_2145959128"]).toBe("idle");
    const cj = await replay("frm-getFactory-2026-09-22-CJ-norecipe-fuse-trimmed.json");
    // B3: a machine on the tripped grid is unpowered even though it has no recipe either.
    expect(cj["Build_OilRefinery_C_2147458064"]).toBe("unpowered");
  });
});
