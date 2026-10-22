import { describe, expect, it } from "vitest";
import {
  bottlenecksBeltLevel,
  bottlenecksEmpty,
  bottlenecksItemLevelOldFrm,
  bottlenecksUnknownKind,
} from "@satisfactory-dash/shared/fixtures";
import { cappedByLine, detailLine, fixLine, isSmallGap, machineLabel, sectionNotes } from "./bottlenecks";

const [belt, lift] = bottlenecksBeltLevel.data.findings;
const cap = belt.rootCause.cappedBy!;

describe("machineLabel, fixLine and isSmallGap (#592)", () => {
  it("names a machine by class, recipe and place, leaving out what is missing", () => {
    expect(machineLabel({ buildingName: "Constructor", recipe: "Iron Plate", at: { x: 120, y: -40 } })).toBe("Constructor, Iron Plate, near (120, −40)");
    expect(machineLabel({ buildingName: "Constructor", recipe: null })).toBe("Constructor");
    expect(machineLabel({ buildingName: "Constructor" })).toBe("Constructor");
  });

  it("says how many more producers, at what rate each", () => {
    expect(fixLine({ producerName: "Smelter", recipe: "Iron Ingot", perMachinePerMinute: 30, machines: 3, unit: "items/min" })).toBe(
      "About 3 more Smelter (Iron Ingot), 30 items/min each, at full speed.",
    );
    expect(fixLine({ producerName: "Water Extractor", recipe: null, perMachinePerMinute: 120, machines: 1, unit: "m3/min" })).toBe(
      "About 1 more Water Extractor, 120 m³/min each, at full speed.",
    );
  });

  it("flags a deficit under 2% of demand, and only a deficit", () => {
    const deficit = (supply: number, demand: number) => ({ ...belt, rootCause: { kind: "deficit", supplyMaxPerMinute: supply, demandMaxPerMinute: demand } });
    expect(isSmallGap(deficit(2426, 2453))).toBe(true);
    expect(isSmallGap(deficit(90, 100))).toBe(false);
    expect(isSmallGap(belt)).toBe(false);
  });
});

describe("cappedByLine", () => {
  it("names the tier, the rate in items/min and the position", () => {
    expect(cappedByLine(cap)).toBe("Conveyor Belt Mk.1 · 60 items/min · near (−554, −1278)");
  });

  it("reads a pipe in m³/min, never rescaled", () => {
    expect(cappedByLine({ ...cap, kind: "pipe", tier: "Pipeline Mk.1", capacityPerMinute: 300.04 })).toContain("300 m³/min");
  });
});

describe("detailLine", () => {
  it("is the cap for a logistics finding", () => {
    expect(detailLine(lift)).toContain("Conveyor Lift Mk.1");
  });

  it("is null without a cap, and for a step kind this build does not know", () => {
    expect(detailLine(bottlenecksItemLevelOldFrm.data.findings[1])).toBeNull();
    expect(detailLine(bottlenecksUnknownKind.data.findings[0])).toBeNull();
    expect(detailLine({ ...belt, rootCause: { ...belt.rootCause, kind: "somethingNew" } })).toBeNull();
  });
});

describe("sectionNotes", () => {
  it("shows the backend's notes as they are", () => {
    expect(sectionNotes(bottlenecksBeltLevel.data)).toEqual(["Connections refresh every 10 minutes."]);
    expect(sectionNotes(bottlenecksUnknownKind.data)).toContain("A note a newer backend adds.");
  });

  it("adds the update-FRM note for an older FRM and the refresh note for a belt-level run when the backend left them out", () => {
    expect(sectionNotes({ ...bottlenecksItemLevelOldFrm.data, notes: [] })[0]).toMatch(/Update FRM to 1\.5\.4/);
    expect(sectionNotes({ ...bottlenecksEmpty.data, notes: [], connectionsRefreshMinutes: 1 })).toEqual([
      "Connections refresh every 1 minute.",
    ]);
  });

  it("gives tooLarge its own note, not the FRM one", () => {
    const notes = sectionNotes({ ...bottlenecksItemLevelOldFrm.data, beltData: "tooLarge", notes: [] });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/too large/);
    expect(notes[0]).not.toMatch(/FRM/);
  });
});

describe("sectionNotes against a backend that disagrees with its own mode", () => {
  const note = (code: string, text: string) => ({ code, text });

  it("never shows the FRM note for tooLarge, nor the too-large note for an older FRM, even when the backend sent it", () => {
    const tooLarge = sectionNotes({
      ...bottlenecksEmpty.data,
      beltData: "tooLarge",
      notes: [note("updateFrm", "Update FRM to 1.5.4.")],
    });
    expect(tooLarge.join(" ")).not.toMatch(/FRM/);
    const old = sectionNotes({
      ...bottlenecksEmpty.data,
      beltData: "unsupported",
      notes: [note("beltDataTooLarge", "Too large to read.")],
    });
    expect(old.join(" ")).not.toMatch(/too large/i);
    expect(old.join(" ")).toMatch(/Update FRM/);
  });

  it("shows a repeated sentence once", () => {
    const notes = sectionNotes({
      ...bottlenecksEmpty.data,
      notes: [note("a", "Same."), note("b", "Same."), note("connectionsRefresh", "Refresh.")],
    });
    expect(notes).toEqual(["Same.", "Refresh."]);
  });
});

describe("helpers: edge cases (fresh eyes, #592)", () => {
  it("machineLabel leaves out empty parts and shows a negative zero as 0", () => {
    expect(machineLabel({ buildingName: "Constructor", recipe: "" })).toBe("Constructor");
    expect(machineLabel({ buildingName: "", recipe: null, at: { x: -0, y: -5 } })).toBe("near (0, −5)");
  });
  it("fixLine reads for one machine, no recipe and a fluid", () => {
    expect(fixLine({ producerName: "Refinery", recipe: null, perMachinePerMinute: 30, machines: 1, unit: "m3/min" })).toMatch(
      /^About 1 more Refinery, .*m.*each, at full speed\.$/,
    );
  });
  it("isSmallGap: only a deficit with a positive demand, strictly under 2%", () => {
    const f = (kind: string, supply?: number, demand?: number) =>
      ({ ...belt, rootCause: { kind, supplyMaxPerMinute: supply, demandMaxPerMinute: demand } }) as typeof belt;
    expect(isSmallGap(f("deficit", 99, 100))).toBe(true);
    expect(isSmallGap(f("deficit", 98, 100))).toBe(false);
    expect(isSmallGap(f("deficit", 0, 0))).toBe(false);
    expect(isSmallGap(f("deficit", undefined, 100))).toBe(false);
    expect(isSmallGap(f("surplus", 99, 100))).toBe(false);
  });
});
