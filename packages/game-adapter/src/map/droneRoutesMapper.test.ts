import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DRONE_ROUTES_MAX_ITEMS, DroneRoutesLayerDataSchema, TRAIN_ROUTES_MAX_ITEM_CLASSES } from "@satisfactory-dash/shared";
import { mapDroneRoutes } from "./droneRoutesMapper.js";

// docs-vault/raw-sources/captured-responses: a preamble, a `---` line, then the JSON.
const CAPTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../docs-vault/raw-sources/captured-responses");

function readCapture(name: string): unknown[] {
  const text = readFileSync(path.join(CAPTURES, name), "utf8").replace(/\r\n/g, "\n");
  return JSON.parse(text.slice(text.indexOf("\n---\n") + 5)) as unknown[];
}

/** The two paired ports of frm-getDroneStation-2026-10-25-paired-battery-cargo-trimmed.json (PR #659), with the fields the
 *  mapper reads, values unchanged. */
const pairedCapture = () => [
  {
    ID: "Build_DroneStation_C_2146556398",
    Name: "FUEL 5",
    location: { x: -220400, y: 50300, z: 24800.009765625, rotation: 270, pitch: 0 },
    InputInventory: [{ Name: "Battery", ClassName: "Desc_Battery_C", Amount: 3, MaxAmount: 200 }],
    OutputInventory: [],
    FuelInventory: [{ Name: "Battery", ClassName: "Desc_Battery_C", Amount: 68, MaxAmount: 200 }],
    PairedStation: "TestLand1",
    AvgOutRate: 6.524730205535889,
  },
  {
    ID: "Build_DroneStation_C_2147451055",
    Name: "TestLand1",
    location: { x: -214600, y: 51000, z: 24800.01171875, rotation: 270, pitch: 0 },
    InputInventory: [],
    OutputInventory: [],
    FuelInventory: [{ Name: "Battery", ClassName: "Desc_Battery_C", Amount: 190, MaxAmount: 200 }],
    PairedStation: "FUEL 5",
    AvgTotalIncRate: 6.524730205535889,
  },
];

const port = (over: Record<string, unknown> = {}) => ({
  ID: "p1",
  Name: "Port",
  location: { x: 0, y: 0, z: 0 },
  InputInventory: [],
  OutputInventory: [],
  FuelInventory: [],
  PairedStation: "None",
  ...over,
});

describe("mapDroneRoutes on the 2026-10-25 captures (ADR-0055 PR 12a)", () => {
  it("projects the unpaired capture: every port unpaired, fuel kept apart from cargo, positions in whole metres", () => {
    const raw = readCapture("frm-getDroneStation-2026-10-25-unpaired-trimmed.json");
    const { data, dropped } = mapDroneRoutes(raw);
    expect(dropped).toBe(0);
    expect(data).toHaveLength(raw.length);
    expect(DroneRoutesLayerDataSchema.safeParse(data).success).toBe(true);
    for (const p of data) {
      expect(p.paired).toBeNull();
      expect(p.input).toEqual([]);
      expect(p.fuel).toEqual(["Desc_Battery_C"]);
    }
    expect(data.find((p) => p.name === "FUEL 1")).toMatchObject({ x: -2204, y: 599 });
  });

  it("projects the paired capture: each port names the other, the battery cargo is input, and no rate is carried", () => {
    const { data, dropped } = mapDroneRoutes(pairedCapture());
    expect(dropped).toBe(0);
    expect(data).toEqual([
      { id: "Build_DroneStation_C_2146556398", name: "FUEL 5", paired: "TestLand1", input: ["Desc_Battery_C"], output: [], fuel: ["Desc_Battery_C"], x: -2204, y: 503 },
      { id: "Build_DroneStation_C_2147451055", name: "TestLand1", paired: "FUEL 5", input: [], output: [], fuel: ["Desc_Battery_C"], x: -2146, y: 510 },
    ]);
  });

  it("is the same for the same game state: ports by id, classes sorted, amounts ignored", () => {
    const [a, b] = pairedCapture();
    const once = mapDroneRoutes([a, b]).data;
    const shuffled = mapDroneRoutes([
      { ...b },
      { ...a, InputInventory: [{ ClassName: "Desc_Battery_C", Amount: 99 }], AvgOutRate: 1 },
    ]).data;
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(once));
    const twins = [port({ ID: "a", Name: "2" }), port({ ID: "a", Name: "1" })];
    expect(JSON.stringify(mapDroneRoutes(twins).data)).toBe(JSON.stringify(mapDroneRoutes([...twins].reverse()).data));
    const classes = mapDroneRoutes([port({ InputInventory: [{ ClassName: "Desc_B_C" }, { ClassName: "Desc_A_C" }, { ClassName: "Desc_B_C" }] })]).data[0]!;
    expect(classes.input).toEqual(["Desc_A_C", "Desc_B_C"]);
  });
});

describe("mapDroneRoutes edges", () => {
  it("reads FRM's exact 'None' as unpaired; any other name is kept as the game wrote it", () => {
    const paired = (value: unknown) => mapDroneRoutes([port({ PairedStation: value })]).data[0]!.paired;
    expect(paired("None")).toBeNull();
    expect(paired(undefined)).toBeNull();
    expect(paired("")).toBeNull();
    expect(paired(5)).toBeNull();
    expect(paired("n".repeat(201))).toBeNull();
    expect(paired("none")).toBe("none");
    expect(paired("Hub ")).toBe("Hub ");
  });

  it("drops and counts a port without an id, name or position, or past the contract's bounds; keeps the rest", () => {
    const junk = [null, 5, {}, port({ ID: "" }), port({ Name: undefined }), port({ location: undefined }), port({ ID: "i".repeat(201) }), port({ Name: "n".repeat(201) }), port({ location: { x: 2e8, y: 0, z: 0 } })];
    const { data, dropped } = mapDroneRoutes([...junk, port({ ID: "ok" })]);
    expect(dropped).toBe(junk.length);
    expect(data.map((p) => p.id)).toEqual(["ok"]);
  });

  it("trims a bad inventory entry, not the port", () => {
    const { data, dropped } = mapDroneRoutes([port({ InputInventory: [null, { ClassName: "" }, { Amount: 1 }, { ClassName: "Desc_Ok_C" }], OutputInventory: "nope", FuelInventory: undefined })]);
    expect(dropped).toBe(0);
    expect(data[0]).toMatchObject({ input: ["Desc_Ok_C"], output: [], fuel: [] });
  });

  it("caps item classes per list and ports per layer, counting the cut ports", () => {
    const many = Array.from({ length: TRAIN_ROUTES_MAX_ITEM_CLASSES + 5 }, (_, i) => ({ ClassName: `Desc_${String(i).padStart(3, "0")}_C` }));
    expect(mapDroneRoutes([port({ InputInventory: many })]).data[0]!.input).toHaveLength(TRAIN_ROUTES_MAX_ITEM_CLASSES);
    const ports = Array.from({ length: DRONE_ROUTES_MAX_ITEMS + 3 }, (_, i) => port({ ID: `p${String(i).padStart(5, "0")}` }));
    const { data, dropped } = mapDroneRoutes(ports);
    expect(data).toHaveLength(DRONE_ROUTES_MAX_ITEMS);
    expect(dropped).toBe(3);
    expect(data.at(-1)!.id).toBe(`p${String(DRONE_ROUTES_MAX_ITEMS - 1).padStart(5, "0")}`);
  });
});
