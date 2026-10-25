import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TRAIN_ROUTES_MAX_ITEM_CLASSES,
  TRAIN_ROUTES_MAX_ITEMS,
  TRAIN_ROUTES_MAX_PLATFORMS,
  TRAIN_ROUTES_MAX_STOPS,
  TrainRoutesLayerDataSchema,
} from "@satisfactory-dash/shared";
import { mapTrainRoutes } from "./trainRoutesMapper.js";

// docs-vault/raw-sources/captured-responses: the 2026-10-21 trimmed captures (pure JSON) and the 2026-09-27 full ones
// (a preamble, then the JSON on one line).
const CAPTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../docs-vault/raw-sources/captured-responses");

function readCapture(name: string): unknown[] {
  const text = readFileSync(path.join(CAPTURES, name), "utf8");
  const jsonLine = text.split("\n").find((line) => line.startsWith("[") && line.length > 1);
  return JSON.parse(jsonLine ?? text) as unknown[];
}

const stationsCapture = () => readCapture("frm-getTrainStation-2026-10-21-trimmed.json");
const trainsCapture = () => readCapture("frm-getTrains-2026-10-21-trimmed.json");

describe("mapTrainRoutes on the 2026-10-21 captures (ADR-0055 PR 5)", () => {
  it("projects the stations (trailing space kept, loading modes mapped, items per platform) and the train", () => {
    const { data, dropped } = mapTrainRoutes({ stations: stationsCapture(), trains: trainsCapture() });
    expect(dropped).toBe(0);
    expect(data).toEqual([
      {
        recordType: "station",
        id: "Build_TrainStation_C_2146503764",
        name: "Computer-Dropoff",
        platforms: [
          { id: "Build_TrainDockingStation_C_2146497249", mode: "unload", items: ["Desc_Silica_C"] },
          { id: "Build_TrainDockingStation_C_2146498514", mode: "unload", items: ["Desc_QuartzCrystal_C"] },
        ],
      },
      {
        recordType: "station",
        id: "Build_TrainStation_C_2147412474",
        name: "Silica/Crstal Out ",
        platforms: [
          { id: "Build_TrainDockingStation_C_2147407665", mode: "load", items: ["Desc_Silica_C"] },
          { id: "Build_TrainDockingStation_C_2147408936", mode: "load", items: ["Desc_QuartzCrystal_C"] },
        ],
      },
      {
        recordType: "train",
        id: "BP_Train_C_2146471703",
        name: "Silica/Crystal - Computer Dropoff",
        stops: ["Silica/Crstal Out ", "Computer-Dropoff"],
        items: ["Desc_QuartzCrystal_C", "Desc_Silica_C"],
      },
    ]);
  });

  it("every train stop equals a station name exactly, trailing space included", () => {
    const { data } = mapTrainRoutes({ stations: stationsCapture(), trains: trainsCapture() });
    const names = new Set(data.flatMap((r) => (r.recordType === "station" ? [r.name] : [])));
    for (const r of data) if (r.recordType === "train") for (const stop of r.stops) expect(names.has(stop)).toBe(true);
  });

  it("the output satisfies the contract's layer schema", () => {
    expect(TrainRoutesLayerDataSchema.safeParse(mapTrainRoutes({ stations: stationsCapture(), trains: trainsCapture() }).data).success).toBe(true);
  });

  it("maps the full 2026-09-27 captures (with locations and extra fields) to the same layer", () => {
    const full = mapTrainRoutes({ stations: readCapture("frm-getTrainStation-2026-09-27-full.json"), trains: readCapture("frm-getTrains-2026-09-27-full.json") });
    expect(full).toEqual(mapTrainRoutes({ stations: stationsCapture(), trains: trainsCapture() }));
  });

  it("is order- and amount-independent (the hash is stable between reads)", () => {
    const first = mapTrainRoutes({ stations: stationsCapture(), trains: trainsCapture() });
    const stations = stationsCapture().reverse();
    const changed = JSON.parse(JSON.stringify(stations).replaceAll('"Amount":9600', '"Amount":1')) as unknown[];
    expect(mapTrainRoutes({ stations: changed, trains: trainsCapture() })).toEqual(first);
  });
});

describe("mapTrainRoutes leniency", () => {
  const station = (extra: object = {}) => ({ ID: "s1", Name: "A", CargoInventory: [], ...extra });
  const train = (extra: object = {}) => ({ ID: "t1", Name: "T", TimeTable: [], Vehicles: [], ...extra });
  const one = (s: unknown[], t: unknown[] = []) => mapTrainRoutes({ stations: s, trains: t });

  it("an empty read is an empty layer", () => {
    expect(one([], [])).toEqual({ data: [], dropped: 0 });
  });

  it("missing optional fields conform: no platforms, no stops, no cargo", () => {
    const { data, dropped } = one([{ ID: "s1", Name: "A" }], [{ ID: "t1", Name: "T" }]);
    expect(dropped).toBe(0);
    expect(data).toEqual([
      { recordType: "station", id: "s1", name: "A", platforms: [] },
      { recordType: "train", id: "t1", name: "T", stops: [], items: [] },
    ]);
  });

  it("drops (and counts) a record with no id or no name, or not an object", () => {
    const { data, dropped } = one([{ Name: "A" }, { ID: "", Name: "A" }, null, "x", station({ ID: "ok" })], [{ ID: "t" }, 5, train()]);
    expect(data.map((r) => r.id)).toEqual(["ok", "t1"]);
    expect(dropped).toBe(6);
  });

  it("drops a record whose id or name is over the contract length, keeps one at the limit", () => {
    const { data, dropped } = one([station({ Name: "n".repeat(201) }), station({ ID: "b", Name: "n".repeat(200) })]);
    expect(data.map((r) => r.id)).toEqual(["b"]);
    expect(dropped).toBe(1);
  });

  it("an empty station name is kept (the contract allows it)", () => {
    expect(one([station({ Name: "" })]).data[0]).toMatchObject({ name: "" });
  });

  it("loading modes: Loading, Unloading, an unknown one passes through lowercased, a missing one is empty", () => {
    const p = (id: string, mode?: string) => ({ ID: id, ...(mode === undefined ? {} : { LoadingMode: mode }), Inventory: [] });
    const { data } = one([station({ CargoInventory: [p("a", "Loading"), p("b", "Unloading"), p("c", "Teleporting"), p("d")] })]);
    const platforms = (data[0] as { platforms: { id: string; mode: string }[] }).platforms;
    expect(platforms.map((x) => [x.id, x.mode])).toEqual([["a", "load"], ["b", "unload"], ["c", "teleporting"], ["d", ""]]);
  });

  it("a platform without an id is trimmed from its station; a malformed platform does not drop the station", () => {
    const { data, dropped } = one([station({ CargoInventory: [{ Inventory: [] }, "junk", null, { ID: "p", LoadingMode: "Loading", Inventory: [] }] })]);
    expect(dropped).toBe(0);
    expect((data[0] as { platforms: unknown[] }).platforms).toEqual([{ id: "p", mode: "load", items: [] }]);
  });

  it("a non-array CargoInventory, Inventory, TimeTable or Vehicles conforms to empty", () => {
    const { data, dropped } = one([station({ CargoInventory: "x" }), station({ ID: "s2", CargoInventory: [{ ID: "p", Inventory: 3 }] })], [train({ TimeTable: 1, Vehicles: {} })]);
    expect(dropped).toBe(0);
    expect(data).toEqual([
      { recordType: "station", id: "s1", name: "A", platforms: [] },
      { recordType: "station", id: "s2", name: "A", platforms: [{ id: "p", mode: "", items: [] }] },
      { recordType: "train", id: "t1", name: "T", stops: [], items: [] },
    ]);
  });

  it("inventory entries without a usable ClassName are skipped; duplicates collapse; items are sorted", () => {
    const inv = [{ ClassName: "B" }, {}, { ClassName: 5 }, { ClassName: "" }, { ClassName: "A" }, { ClassName: "B" }, null, { ClassName: "x".repeat(201) }];
    const { data } = one([station({ CargoInventory: [{ ID: "p", Inventory: inv }] })], [train({ Vehicles: [{ Inventory: inv }, { Inventory: [{ ClassName: "C" }] }, null] })]);
    expect((data[0] as { platforms: { items: string[] }[] }).platforms[0]!.items).toEqual(["A", "B"]);
    expect(data[1]).toMatchObject({ items: ["A", "B", "C"] });
  });

  it("timetable: stops keep their order, repeats and trailing spaces; a stop without a name is skipped; a repeated stop stays", () => {
    const { data } = one([], [train({ TimeTable: [{ StationName: "A " }, {}, { StationName: "B" }, null, { StationName: "A " }, { StationName: "x".repeat(201) }] })]);
    expect(data[0]).toMatchObject({ stops: ["A ", "B", "A "] });
  });

  it("two stations with the same name stay two records; two trains on one timetable stay two records", () => {
    const { data } = one([station({ ID: "s1" }), station({ ID: "s2" })], [train({ ID: "t1" }), train({ ID: "t2" })]);
    expect(data.map((r) => r.id)).toEqual(["s1", "s2", "t1", "t2"]);
  });

  it("caps platforms, item classes, stops and records at the contract's limits", () => {
    const classes = Array.from({ length: TRAIN_ROUTES_MAX_ITEM_CLASSES + 5 }, (_, i) => ({ ClassName: `C${String(i).padStart(3, "0")}` }));
    const platforms = Array.from({ length: TRAIN_ROUTES_MAX_PLATFORMS + 5 }, (_, i) => ({ ID: `p${String(i).padStart(3, "0")}`, Inventory: classes }));
    const stops = Array.from({ length: TRAIN_ROUTES_MAX_STOPS + 5 }, () => ({ StationName: "A" }));
    const { data } = one([station({ CargoInventory: platforms })], [train({ TimeTable: stops, Vehicles: [{ Inventory: classes }] })]);
    const s = data[0] as { platforms: { items: string[] }[] };
    expect(s.platforms).toHaveLength(TRAIN_ROUTES_MAX_PLATFORMS);
    expect(s.platforms[0]!.items).toHaveLength(TRAIN_ROUTES_MAX_ITEM_CLASSES);
    expect(data[1]).toMatchObject({ stops: expect.any(Array) });
    expect((data[1] as { stops: string[]; items: string[] }).stops).toHaveLength(TRAIN_ROUTES_MAX_STOPS);
    expect((data[1] as { items: string[] }).items).toHaveLength(TRAIN_ROUTES_MAX_ITEM_CLASSES);
    expect(TrainRoutesLayerDataSchema.safeParse(data).success).toBe(true);

    const many = Array.from({ length: TRAIN_ROUTES_MAX_ITEMS + 3 }, (_, i) => station({ ID: `s${String(i).padStart(5, "0")}` }));
    const capped = one(many);
    expect(capped.data).toHaveLength(TRAIN_ROUTES_MAX_ITEMS);
    expect(capped.dropped).toBe(3);
  });

  it("stations come before trains whatever the id order", () => {
    const { data } = one([station({ ID: "z" })], [train({ ID: "a" })]);
    expect(data.map((r) => r.recordType)).toEqual(["station", "train"]);
  });
});
