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
    const { data, dropped } = mapRailSegments(raw.slice(0, 1));
    expect(data).toEqual(railsSample.data);
    expect(dropped).toBe(0);
  });

  it("the mapped output passes the M1 contract schema (RailsLayerDataSchema)", () => {
    const raw = z.array(RawFrmTrainRailSchema).parse(readCaptureArray(CAPTURE_PATH));
    const { data } = mapRailSegments(raw);
    expect(RailsLayerDataSchema.safeParse(data).success).toBe(true);
  });

  it("drops z, rotation, Connected0/Connected1 and Length: the mapped segment has only id and points", () => {
    const raw = z.array(RawFrmTrainRailSchema).parse(readCaptureArray(CAPTURE_PATH));
    const [mapped] = mapRailSegments(raw.slice(0, 1)).data;
    expect(Object.keys(mapped!).sort()).toEqual(["id", "points"]);
  });

  it("rounds game units (centimetres) to the nearest whole metre, not truncating", () => {
    const segment = mapRailSegment({ ID: "x", SplineData: [{ x: 149, y: -149 }, { x: 150, y: -151 }] });
    // 149/100 = 1.49 -> 1; -149/100 = -1.49 -> -1 (Math.round rounds toward +Infinity at .5, matching Math.round's
    // documented behaviour, not "round half away from zero").
    expect(segment?.points).toEqual([[1, -1], [2, -2]]);
  });

  it("collapses consecutive duplicate points after rounding (the game's spline is finer than a whole metre)", () => {
    const segment = mapRailSegment({ ID: "x", SplineData: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 45, y: 0 }, { x: 200, y: 0 }] });
    // 0, 40 and 45 all round to 0m; only the transition to 200 (2m) is a new point.
    expect(segment?.points).toEqual([[0, 0], [2, 0]]);
  });

  it("does NOT collapse non-consecutive duplicates (a rail that returns to a point it already visited)", () => {
    const segment = mapRailSegment({
      ID: "x",
      SplineData: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }],
    });
    expect(segment?.points).toEqual([[0, 0], [1, 0], [0, 0]]);
  });

  it("a segment that collapses to fewer than 2 points is dropped, not sent as a degenerate 1-point line", () => {
    const oneAfterDedupe = mapRailSegment({ ID: "x", SplineData: [{ x: 0, y: 0 }, { x: 40, y: 0 }] }); // both round to 0m
    expect(oneAfterDedupe).toBeUndefined();
    const { data, dropped } = mapRailSegments([{ ID: "x", SplineData: [{ x: 0, y: 0 }, { x: 40, y: 0 }] }]);
    expect(data).toEqual([]);
    expect(dropped).toBe(1);
  });

  it("a single valid point plus a bad (non-finite/out-of-bounds) one still collapses below 2 points and is dropped", () => {
    const segment = mapRailSegment({ ID: "x", SplineData: [{ x: 0, y: 0 }, { x: Infinity, y: 0 }] });
    expect(segment).toBeUndefined();
  });

  it("drops only the bad point, not the whole segment, when enough good points remain", () => {
    const segment = mapRailSegment({
      ID: "x",
      SplineData: [{ x: 0, y: 0 }, { x: NaN, y: 0 }, { x: 200_000_100, y: 0 }, { x: 300, y: 0 }],
    });
    // NaN and a point past +-1,000,000 m (200_000_100 cm = 2,000,001 m) are both dropped; 0 and 3 m survive.
    expect(segment?.points).toEqual([[0, 0], [3, 0]]);
  });

  it("keeps every point exactly at the +-1,000,000 m boundary (inclusive, not exclusive)", () => {
    const boundaryCm = 1_000_000 * 100;
    const segment = mapRailSegment({ ID: "x", SplineData: [{ x: -boundaryCm, y: 0 }, { x: boundaryCm, y: 0 }] });
    expect(segment?.points).toEqual([[-1_000_000, 0], [1_000_000, 0]]);
  });

  it("maps an empty array to an empty array without throwing, and reports 0 dropped", () => {
    expect(mapRailSegments([])).toEqual({ data: [], dropped: 0 });
  });

  it("does not deduplicate or validate uniqueness of rail IDs (not this layer's job)", () => {
    const raw = [
      { ID: "same", SplineData: [{ x: 0, y: 0 }, { x: 100, y: 100 }] },
      { ID: "same", SplineData: [{ x: 200, y: 200 }, { x: 300, y: 300 }] },
    ];
    expect(mapRailSegments(raw).data).toHaveLength(2);
  });

  it("dedup treats a bad point as invisible: two equal-value points separated only by a dropped bad point still collapse (fresh-eyes: filter-then-dedup happens in one pass, not two separate passes)", () => {
    const segment = mapRailSegment({
      ID: "x",
      SplineData: [{ x: 0, y: 0 }, { x: Infinity, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }],
    });
    // If bad-point filtering and dedup were two independent passes over the ORIGINAL sequence, the
    // two [0,0] points are not textually adjacent (Infinity sits between them) and would NOT be
    // treated as consecutive duplicates. The actual implementation instead filters and dedups in a
    // single pass, comparing each new point against the last point actually PUSHED — so the bad
    // point in between is invisible to the dedup check, and the two [0,0]s collapse to one.
    expect(segment?.points).toEqual([[0, 0], [1, 0]]);
  });

  it("a bad point between two genuinely DIFFERENT values does not cause a false collapse", () => {
    const segment = mapRailSegment({
      ID: "x",
      SplineData: [{ x: 0, y: 0 }, { x: NaN, y: 0 }, { x: 200, y: 0 }],
    });
    // 0cm -> 0m, 200cm -> 2m: distinct values, so no collapse regardless of the NaN between them.
    expect(segment?.points).toEqual([[0, 0], [2, 0]]);
  });

  it("maps a large batch (65 segments x 127 points, the full live capture's documented upper bound) without throwing", () => {
    // Each point exactly 100 cm (1 m) apart, so it rounds to a genuinely new whole metre every
    // time — nothing here collapses under the consecutive-duplicate dedup being tested above.
    const many = Array.from({ length: 65 }, (_, seg) => ({
      ID: `rail-${seg}`,
      SplineData: Array.from({ length: 127 }, (_, p) => ({ x: seg * 100_000 + p * 100, y: -(seg * 100_000 + p * 100) })),
    }));
    const { data, dropped } = mapRailSegments(many);
    expect(data).toHaveLength(65);
    expect(dropped).toBe(0);
    expect(data[64]!.points).toHaveLength(127);
    expect(data[64]!.points[126]).toEqual([64126, -64126]); // (64*100_000 + 126*100) / 100 = 64126
  });
});
