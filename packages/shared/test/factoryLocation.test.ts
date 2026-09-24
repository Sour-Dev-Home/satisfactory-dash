import { describe, expect, it } from "vitest";
import * as fixtures from "../fixtures/index";
import { FactoryBuildingSchema } from "../src/index";

const building = fixtures.factoryMixed.data.buildings[0];
const parse = (patch: object) => FactoryBuildingSchema.safeParse({ ...building, ...patch });

describe("factory building location and circuitGroupId (ADR-0023)", () => {
  it("factoryMixed carries real captured coordinates in metres", () => {
    for (const b of fixtures.factoryMixed.data.buildings) {
      expect(b.location).toBeDefined();
      expect(b.circuitGroupId).toBe(0);
    }
  });

  it("parses without either field (an older backend)", () => {
    const { location: _l, circuitGroupId: _c, ...old } = building;
    expect(FactoryBuildingSchema.safeParse(old).success).toBe(true);
  });

  it("accepts -1 (unconnected) and a negative world coordinate", () => {
    expect(parse({ circuitGroupId: -1 }).success).toBe(true);
    expect(parse({ location: { xM: -1957, yM: -1056, zM: 0, rotationDeg: 0 } }).success).toBe(true);
  });

  it("keeps rotation in [0, 360)", () => {
    const at = (rotationDeg: number) => parse({ location: { xM: 0, yM: 0, zM: 0, rotationDeg } }).success;
    expect(at(0)).toBe(true);
    expect(at(359.9)).toBe(true);
    expect(at(360)).toBe(false);
    expect(at(-90)).toBe(false);
  });

  it("rejects a fractional circuitGroupId and a partial location", () => {
    expect(parse({ circuitGroupId: 1.5 }).success).toBe(false);
    expect(parse({ location: { xM: 1, yM: 2 } }).success).toBe(false);
  });
});
