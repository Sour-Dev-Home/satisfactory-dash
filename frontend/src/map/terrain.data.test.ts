import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { GRID_BASE_MAP } from "./projection";
import { terrainToken } from "./terrain";
import terrain from "./terrain/terrain.json";

const FILE = join(import.meta.dirname, "terrain", "terrain.json");
const CSS = readFileSync(join(import.meta.dirname, "..", "index.css"), "utf8");

describe("the traced terrain (ADR-0023 amendment)", () => {
  it("covers the grid base map's world, so the two line up", () => {
    expect(terrain.boundsM).toEqual(GRID_BASE_MAP.worldBoundsM);
  });

  it("holds only closed rings of whole-metre points inside the world", () => {
    const { minX, maxX, minY, maxY } = terrain.boundsM;
    const all = [...terrain.land, ...terrain.classes.flatMap((c) => c.rings)];
    expect(terrain.land.length).toBeGreaterThan(0);
    for (const ring of all) {
      expect(ring.length % 2).toBe(0);
      expect(ring.length).toBeGreaterThanOrEqual(6);
      for (let i = 0; i < ring.length; i += 2) {
        expect(Number.isInteger(ring[i]) && Number.isInteger(ring[i + 1])).toBe(true);
        expect(ring[i] >= Math.floor(minX) && ring[i] <= Math.ceil(maxX) && ring[i + 1] >= minY && ring[i + 1] <= maxY).toBe(true);
      }
    }
  });

  it("has a colour token for every traced class", () => {
    for (const c of terrain.classes) expect(CSS, c.id).toContain(`${terrainToken(c.id)}:`);
  });

  it("stays a light download: under 120 kB gzipped (its own chunk, loaded with the Map page only)", () => {
    expect(gzipSync(readFileSync(FILE)).length).toBeLessThan(120 * 1024);
  });
});
