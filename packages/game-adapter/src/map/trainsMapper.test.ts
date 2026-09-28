import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { mapLiveSample } from "@satisfactory-dash/shared/fixtures";
import { RawFrmTrainSchema } from "../rawSchemas.js";
import { mapTrain, mapTrains } from "./trainsMapper.js";

// docs-vault/raw-sources/captured-responses/frm-getTrains-2026-09-27-full.json.
const CAPTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../docs-vault/raw-sources/captured-responses/frm-getTrains-2026-09-27-full.json",
);

function readCaptureArray(filePath: string): unknown {
  const text = readFileSync(filePath, "utf8");
  const jsonLine = text.split("\n").find((line) => line.startsWith("["));
  if (jsonLine === undefined) throw new Error(`no JSON array line found in ${filePath}`);
  return JSON.parse(jsonLine);
}

const baseTrain = { ID: "x", Name: "n", Status: "Self-Driving", location: { x: 0, y: 0, z: 0 } };

describe("mapTrains (ADR-0038 M3, #353)", () => {
  it("projects the real capture into exactly what packages/shared/fixtures/map.ts's mapLiveSample.trains claims", () => {
    const raw = z.array(RawFrmTrainSchema).parse(readCaptureArray(CAPTURE_PATH));
    const { data, dropped } = mapTrains(raw);
    expect(data).toEqual(mapLiveSample.trains);
    expect(dropped).toBe(0);
  });

  it("passes FRM's Status field through as-is", () => {
    expect(mapTrain({ ...baseTrain, Status: "Manual" })?.status).toBe("Manual");
  });

  it("rounds location x/y (centimetres) to the nearest whole metre", () => {
    const train = mapTrain({ ...baseTrain, location: { x: 149, y: -151, z: 0 } });
    expect([train?.x, train?.y]).toEqual([1, -2]);
  });

  it("drops a train whose coordinate isn't finite or falls outside +-1,000,000 m, rather than rejecting the whole read", () => {
    expect(mapTrain({ ...baseTrain, location: { x: NaN, y: 0, z: 0 } })).toBeUndefined();
    expect(mapTrain({ ...baseTrain, location: { x: 100_000_100, y: 0, z: 0 } })).toBeUndefined(); // 1,000,001 m
    const { data, dropped } = mapTrains([
      { ...baseTrain, ID: "keep" },
      { ...baseTrain, ID: "bad", location: { x: NaN, y: 0, z: 0 } },
    ]);
    expect(data.map((t) => t.id)).toEqual(["keep"]);
    expect(dropped).toBe(1);
  });

  it("maps an empty array to an empty array without throwing, and reports 0 dropped", () => {
    expect(mapTrains([])).toEqual({ data: [], dropped: 0 });
  });
});
