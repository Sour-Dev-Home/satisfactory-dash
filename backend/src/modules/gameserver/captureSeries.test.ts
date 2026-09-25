import { describe, it, expect } from "vitest";
import { buildSample, formatSeries, seriesFileName, trimFactoryBuilding } from "./captureSeries.js";

describe("capture series helpers (dev-only capture script)", () => {
  it("keeps only the fields state tuning reads and drops location, box, colours and features", () => {
    const trimmed = trimFactoryBuilding({
      ID: "b1",
      Name: "Assembler",
      ClassName: "Build_AssemblerMk1_C",
      Recipe: "Stator",
      IsProducing: true,
      IsPaused: false,
      PowerInfo: { CircuitGroupID: 0, FuseTriggered: false },
      production: [{ ProdPercent: 50 }],
      location: { x: 1, y: 2, z: 3 },
      BoundingBox: { min: {} },
      ColorSlot: { PrimaryColor: "FA954900" },
      features: { properties: {} },
      SomeSecretHostField: "http://192.168.1.10:8080",
    });
    expect(Object.keys(trimmed).sort()).toEqual(["ClassName", "ID", "IsPaused", "IsProducing", "Name", "PowerInfo", "Recipe", "production"]);
  });

  it("returns an empty object for anything that is not an object", () => {
    for (const value of [null, undefined, "x", 3, []]) {
      expect(Object.keys(trimFactoryBuilding(value))).toEqual([]);
    }
  });

  it("records a failed poll as null instead of dropping the sample", () => {
    const at = new Date("2026-09-25T10:15:00.000Z");
    expect(buildSample(at, new Error("down"), null)).toEqual({ at: "2026-09-25T10:15:00.000Z", factory: null, power: null });
    expect(buildSample(at, [{ ID: "b1", location: {} }], [{ CircuitGroupID: 0 }])).toEqual({
      at: "2026-09-25T10:15:00.000Z",
      factory: [{ ID: "b1" }],
      power: [{ CircuitGroupID: 0 }],
    });
  });

  it("names the file after the start time, filesystem-safe", () => {
    expect(seriesFileName(new Date("2026-09-25T10:15:30.123Z"))).toBe("frm-factory-series-20260925T101530Z.json");
  });

  it("formats provenance lines, a --- line, then parseable JSON; nothing else can appear in it", () => {
    const start = new Date("2026-09-25T10:15:00.000Z");
    const text = formatSeries({ start, intervalSeconds: 30, samples: [buildSample(start, [], [])] });
    const [header, body] = text.split("\n---\n");
    expect(header).toContain("Captured: 2026-09-25T10:15:00.000Z, 1 samples about 30 s apart");
    expect(JSON.parse(body!)).toEqual([{ at: "2026-09-25T10:15:00.000Z", factory: [], power: [] }]);
    expect(text).not.toMatch(/https?:\/\/|token|authorization/i);
  });
});
