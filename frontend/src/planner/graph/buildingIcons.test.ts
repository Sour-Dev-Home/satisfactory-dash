import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILDING_ICON_CLASSES, BUILDING_ICON_SLUGS, buildingIconUrl } from "./buildingIcons";

/** Building classes read from the owner's FRM (getFactory, getExtractor, getStorageInv, getGenerators, getTrainStation, getSpaceElevator, getPump) and the captured responses in docs-vault/raw-sources. */
const SEEN = [
  "Build_AssemblerMk1_C", "Build_CentralStorage_C", "Build_ConstructorMk1_C", "Build_FoundryMk1_C",
  "Build_GeneratorBiomass_Automated_C", "Build_GeneratorCoal_C", "Build_GeneratorFuel_C", "Build_HadronCollider_C",
  "Build_ManufacturerMk1_C", "Build_MinerMk1_C", "Build_MinerMk2_C", "Build_OilPump_C", "Build_OilRefinery_C",
  "Build_Packager_C", "Build_PipeStorageTank_C", "Build_PipelinePump_C", "Build_ResourceSink_C", "Build_SmelterMk1_C",
  "Build_SpaceElevator_C", "Build_StorageContainerMk1_C", "Build_StorageContainerMk2_C", "Build_StoragePlayer_C",
  "Build_TrainDockingStation_C", "Build_TrainStation_C", "Build_WaterPump_C",
];
/** Classes not on the owner's server yet (nothing built, or an empty capture); named by the game's own blueprint names. */
const NOT_YET_SEEN = [
  "Build_Blender_C", "Build_Converter_C", "Build_DroneStation_C", "Build_GeneratorGeoThermal_C", "Build_GeneratorNuclear_C",
  "Build_MinerMk3_C", "Build_QuantumEncoder_C", "Build_TruckStation_C",
  // The blueprint assets in the SML project's Content folder (docs-vault/raw-sources/factorygame-building-blueprints-2026-10-26.md).
  "Build_GeneratorBiomass_C", "Build_TrainDockingStationLiquid_C", "Build_IndustrialTank_C", "Build_FrackingSmasher_C",
  "Build_FrackingExtractor_C", "Build_AlienPowerBuilding_C", "Build_PowerStorageMk1_C",
];

const DIR = join(import.meta.dirname, "..", "..", "..", "public", "game-assets", "buildings");

describe("buildingIconUrl", () => {
  it("maps FRM's class names to their icon", () => {
    expect(buildingIconUrl("Build_ConstructorMk1_C")).toBe("/game-assets/buildings/constructor.webp");
    expect(buildingIconUrl("Build_ResourceSink_C")).toBe("/game-assets/buildings/resource-sink.webp");
  });

  it("has no icon for an unknown class, including names that are Object.prototype keys", () => {
    expect(buildingIconUrl("Build_SomethingNew_C")).toBeUndefined();
    expect(buildingIconUrl("constructor")).toBeUndefined();
    expect(buildingIconUrl("__proto__")).toBeUndefined();
  });

  it("maps only real class names", () => {
    const real = new Set([...SEEN, ...NOT_YET_SEEN]);
    for (const c of BUILDING_ICON_CLASSES) expect(real.has(c), c).toBe(true);
  });

  it("covers every class the owner's server has shown", () => {
    for (const c of SEEN) expect(buildingIconUrl(c), c).toBeDefined();
  });

  it("has a file in public/ for every slug, and no file without a slug", () => {
    for (const slug of BUILDING_ICON_SLUGS) expect(existsSync(join(DIR, `${slug}.webp`)), slug).toBe(true);
    const files = readdirSync(DIR).filter((f) => f.endsWith(".webp"));
    expect(files.sort()).toEqual(BUILDING_ICON_SLUGS.map((s) => `${s}.webp`).sort());
  });
});
