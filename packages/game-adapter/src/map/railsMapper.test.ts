import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { RailsLayerDataSchema } from "@satisfactory-dash/shared";
import { railsSample } from "@satisfactory-dash/shared/fixtures";
import { RawFrmTrainRailSchema } from "../rawSchemas.js";
import { mapRailSegment, mapRailSegments } from "./railsMapper.js";

// docs-vault/raw-sources/captured-responses/frm-getTrainRails-2026-09-27-trimmed.json: a header
// block, then the JSON array on its own line, per #334's capture format.
const CAPTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../docs-vault/raw-sources/captured-responses/frm-getTrainRails-2026-09-27-trimmed.json",
);

function readCaptureArray(filePath: string): unknown {
  const text = readFileSync(filePath, "utf8");
  const jsonLine = text.split("\n").find((line) => line.startsWith("["));
  if (jsonLine === undefined) throw new Error(`no JSON array line found in ${filePath}`);
  return JSON.parse(jsonLine);
}

describe("mapRailSegments (ADR-0038 M2)", () => {
  it("projects the real capture into exactly what packages/shared/fixtures/map.ts's railsSample claims", () => {
    const raw = z.array(RawFrmTrainRailSchema).parse(readCaptureArray(CAPTURE_PATH));
    // The fixture samples only the first (shortest) segment of the capture's two trimmed items.
    const mapped = mapRailSegments(raw.slice(0, 1));
    expect(mapped).toEqual(railsSample.data);
  });

  it("the mapped output passes the M1 contract schema (RailsLayerDataSchema)", () => {
    const raw = z.array(RawFrmTrainRailSchema).parse(readCaptureArray(CAPTURE_PATH));
    const mapped = mapRailSegments(raw);
    expect(RailsLayerDataSchema.safeParse(mapped).success).toBe(true);
  });

  it("drops z, rotation, Connected0/Connected1 and Length: the mapped segment has only id and points", () => {
    const raw = z.array(RawFrmTrainRailSchema).parse(readCaptureArray(CAPTURE_PATH));
    const [mapped] = mapRailSegments(raw.slice(0, 1));
    expect(Object.keys(mapped).sort()).toEqual(["id", "points"]);
  });

  it("rounds game units (centimetres) to the nearest whole metre, not truncating", () => {
    const segment = mapRailSegment({ ID: "x", SplineData: [{ x: 149, y: -149 }, { x: 150, y: -151 }] });
    // 149/100 = 1.49 -> 1; -149/100 = -1.49 -> -1 (Math.round rounds toward +Infinity at .5, matching Math.round's
    // documented behaviour, not "round half away from zero").
    expect(segment.points).toEqual([[1, -1], [2, -2]]);
  });

  it("a single-point spline maps to a single-point polyline (the M1 min(2) floor is enforced downstream, not here)", () => {
    const segment = mapRailSegment({ ID: "x", SplineData: [{ x: 0, y: 0 }] });
    expect(segment.points).toEqual([[0, 0]]);
    expect(RailsLayerDataSchema.safeParse([segment]).success).toBe(false); // caught by the M1 schema, as documented
  });
});
