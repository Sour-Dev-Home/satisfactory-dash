import { describe, expect, it } from "vitest";
import {
  bottlenecksBeltLevel,
  bottlenecksEmpty,
  bottlenecksItemLevelOldFrm,
  bottlenecksUnknownKind,
} from "@satisfactory-dash/shared/fixtures";
import { cappedByLine, detailLine, sectionNotes } from "./bottlenecks";

const [belt, lift] = bottlenecksBeltLevel.data.findings;
const cap = belt.rootCause.cappedBy;

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
