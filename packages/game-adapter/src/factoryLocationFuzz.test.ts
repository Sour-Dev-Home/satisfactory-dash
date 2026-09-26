import { describe, it, expect } from "vitest";
import { BuildingLocationSchema } from "@satisfactory-dash/shared";
import { SatisfactoryServerAdapter } from "./satisfactoryServerAdapter.js";
import { capturedBackedUpAssembler } from "../fixtures/capturedFixtures.js";

const rotations = [
  359.99999999999994, 360 - Number.EPSILON, -Number.MIN_VALUE, -1e-300, -1e-14, -3e-14, -5.6e-14, -2.8e-14,
  -1e-17, 1e300, -1e300, 1.7e308, -1.7e308, 720.0000000000001, -359.99999999999994, 5e-324,
];
const coords = [1.7e308, -1.7e308, 5e-324, -0, 0];

describe("location values always satisfy the shared BuildingLocationSchema", () => {
  it("rotation and coordinate edge cases", async () => {
    // A seeded generator (mulberry32) so a failure reproduces.
    let seed = 0x5eed;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const raw = [...rotations, ...Array.from({ length: 2000 }, () => (random() - 0.5) * 10 ** (random() * 20))].flatMap(
      (rotation) => coords.map((c) => ({ ...capturedBackedUpAssembler, location: { x: c, y: c, z: c, rotation } })),
    );
    const adapter = new SatisfactoryServerAdapter({ call: async () => undefined as never }, { get: async () => raw as never });
    const out = await adapter.getFactoryBuildings();
    expect(out.length).toBe(raw.length);
    for (const b of out) {
      const r = BuildingLocationSchema.safeParse(b.location);
      expect(r.success, JSON.stringify([b.location, r.error?.issues])).toBe(true);
    }
  });
});
