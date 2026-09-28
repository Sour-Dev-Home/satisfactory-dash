import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { mapLiveSample } from "@satisfactory-dash/shared/fixtures";
import { RawFrmTrainStationSchema } from "../rawSchemas.js";
import { mapTrainStation, mapTrainStations } from "./stationsMapper.js";

// docs-vault/raw-sources/captured-responses/frm-getTrainStation-2026-09-27-full.json.
const CAPTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../docs-vault/raw-sources/captured-responses/frm-getTrainStation-2026-09-27-full.json",
);

function readCaptureArray(filePath: string): unknown {
  const text = readFileSync(filePath, "utf8");
  const jsonLine = text.split("\n").find((line) => line.startsWith("["));
  if (jsonLine === undefined) throw new Error(`no JSON array line found in ${filePath}`);
  return JSON.parse(jsonLine);
}

const baseStation = { ID: "x", Name: "n", location: { x: 0, y: 0, z: 0 } };

describe("mapTrainStations (ADR-0038 M3, #353)", () => {
  it("projects the real capture into exactly what packages/shared/fixtures/map.ts's mapLiveSample.stations claims", () => {
    const raw = z.array(RawFrmTrainStationSchema).parse(readCaptureArray(CAPTURE_PATH));
    const { data, dropped } = mapTrainStations(raw);
    expect(data).toEqual(mapLiveSample.stations);
    expect(dropped).toBe(0);
  });

  it("rounds location x/y (centimetres) to the nearest whole metre", () => {
    const station = mapTrainStation({ ...baseStation, location: { x: 149, y: -151, z: 0 } });
    expect([station?.x, station?.y]).toEqual([1, -2]);
  });

  it("drops a station whose coordinate isn't finite or falls outside +-1,000,000 m, rather than rejecting the whole read", () => {
    expect(mapTrainStation({ ...baseStation, location: { x: Infinity, y: 0, z: 0 } })).toBeUndefined();
    const { data, dropped } = mapTrainStations([
      { ...baseStation, ID: "keep" },
      { ...baseStation, ID: "bad", location: { x: Infinity, y: 0, z: 0 } },
    ]);
    expect(data.map((s) => s.id)).toEqual(["keep"]);
    expect(dropped).toBe(1);
  });

  it("maps an empty array to an empty array without throwing, and reports 0 dropped", () => {
    expect(mapTrainStations([])).toEqual({ data: [], dropped: 0 });
  });
});
