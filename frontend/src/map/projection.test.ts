import { describe, expect, it } from "vitest";
import { GRID_BASE_MAP, mapBounds, project, unproject } from "./projection";

describe("project (ADR-0023 decision 3)", () => {
  it("puts a building at xM -1957, yM -1056 north-west of the origin", () => {
    // The ADR's verification case: negative x is west, negative y is north (+y is south).
    const [lat, lng] = project(GRID_BASE_MAP, -1957, -1056);
    expect(lat).toBeGreaterThan(0); // north
    expect(lng).toBeLessThan(0); // west
    expect([lat, lng]).toEqual([1056, -1957]);
  });

  it("maps east to +lng and south to -lat", () => {
    expect(project(GRID_BASE_MAP, 100, 200)).toEqual([-200, 100]);
  });

  it("keeps +y as north on a y-up base map", () => {
    expect(project({ ...GRID_BASE_MAP, yAxis: "up" }, 100, 200)).toEqual([200, 100]);
  });

  it("round-trips through unproject", () => {
    for (const yAxis of ["down", "up"] as const) {
      const config = { ...GRID_BASE_MAP, yAxis };
      expect(unproject(config, project(config, -1957, 3120.5))).toEqual({ xM: -1957, yM: 3120.5 });
    }
  });

  it("bounds the 7,500 m square as south-west, north-east", () => {
    const [[south, west], [north, east]] = mapBounds(GRID_BASE_MAP);
    expect([south, west, north, east]).toEqual([-3750, -3246.99, 3750, 4253.02]);
    expect(north - south).toBe(7500);
    expect(east - west).toBeCloseTo(7500, 1);
  });
});
