/**
 * The Planner's building icons (ADR-0053, same licence boundary as #571): the game's own UI textures, 64x64 WebP in
 * public/game-assets/buildings/ (see that folder's NOTICE.md). Keyed by FRM's building `ClassName`; a class that is not
 * here gets a generic glyph for its kind (`glyphKindOf`), never a bare box.
 */
const ICON_DIR = "/game-assets/buildings";

/** FRM `ClassName` to file slug. A Map: class names come from the game server. */
const SLUG_BY_CLASS = new Map<string, string>([
  ["Build_ConstructorMk1_C", "constructor"],
  ["Build_SmelterMk1_C", "smelter"],
  ["Build_FoundryMk1_C", "foundry"],
  ["Build_AssemblerMk1_C", "assembler"],
  ["Build_ManufacturerMk1_C", "manufacturer"],
  ["Build_Packager_C", "packager"],
  ["Build_OilRefinery_C", "refinery"],
  ["Build_Blender_C", "blender"],
  ["Build_HadronCollider_C", "particle-accelerator"],
  ["Build_Converter_C", "converter"],
  ["Build_QuantumEncoder_C", "quantum-encoder"],
  ["Build_MinerMk1_C", "miner-mk1"],
  ["Build_MinerMk2_C", "miner-mk2"],
  ["Build_MinerMk3_C", "miner-mk3"],
  ["Build_OilPump_C", "oil-extractor"],
  ["Build_WaterPump_C", "water-extractor"],
  ["Build_StorageContainerMk1_C", "storage-container"],
  ["Build_StorageContainerMk2_C", "storage-container-mk2"],
  ["Build_CentralStorage_C", "dimensional-depot"],
  ["Build_StoragePlayer_C", "personal-storage"],
  ["Build_PipeStorageTank_C", "fluid-buffer"],
  ["Build_TrainStation_C", "train-station"],
  ["Build_TrainDockingStation_C", "freight-platform"],
  ["Build_DroneStation_C", "drone-port"],
  ["Build_TruckStation_C", "truck-station"],
  ["Build_GeneratorCoal_C", "coal-generator"],
  ["Build_GeneratorFuel_C", "fuel-generator"],
  ["Build_GeneratorBiomass_Automated_C", "biomass-generator"],
  ["Build_GeneratorNuclear_C", "nuclear-power-plant"],
  ["Build_GeneratorGeoThermal_C", "geothermal-generator"],
  ["Build_ResourceSink_C", "resource-sink"],
  ["Build_SpaceElevator_C", "space-elevator"],
  ["Build_PipelinePump_C", "pipeline-pump"],
  ["Build_GeneratorBiomass_C", "biomass-generator"],
  ["Build_TrainDockingStationLiquid_C", "fluid-freight-platform"],
  ["Build_IndustrialTank_C", "industrial-fluid-buffer"],
  ["Build_FrackingSmasher_C", "resource-well-pressurizer"],
  ["Build_FrackingExtractor_C", "resource-well-extractor"],
  ["Build_AlienPowerBuilding_C", "alien-power-augmenter"],
  ["Build_PowerStorageMk1_C", "power-storage"],
]);

/** The icon URL for a building class, or undefined when the class has none. */
export function buildingIconUrl(className: string): string | undefined {
  const slug = SLUG_BY_CLASS.get(className);
  return slug === undefined ? undefined : `${ICON_DIR}/${slug}.webp`;
}

/** The kinds of generic glyph a card wears when its building class has no icon (drawn by `BuildingGlyph`). */
export const GLYPH_KINDS = ["machines", "storage", "extractor", "station", "power", "consumer", "stale", "unknown"] as const;
export type GlyphKind = (typeof GLYPH_KINDS)[number];

/** A node's role overrides its kind where it says more (a storage that is the Sink is a consumer, a power one is power). */
const GLYPH_BY_ROLE = new Map<string, GlyphKind>([
  ["power", "power"],
  ["sink", "consumer"],
  ["depot", "storage"],
  ["buffer", "storage"],
  ["storage", "storage"],
  ["export", "station"],
]);
const GLYPH_BY_KIND = new Map<string, GlyphKind>([
  ["machines", "machines"],
  ["extractor", "extractor"],
  ["storage", "storage"],
  ["station", "station"],
  ["consumer", "consumer"],
]);

/**
 * The glyph for a node with no icon of its class. Both inputs are game-server strings, so the tables are Maps; anything
 * else is "unknown". A node built from stale conveyor data (#728 cause 11) wears the clock, not the question mark.
 */
export function glyphKindOf(node: { kind: string; role?: string | undefined; stale?: true | undefined }): GlyphKind {
  if (node.stale === true) return "stale";
  return (node.role === undefined ? undefined : GLYPH_BY_ROLE.get(node.role)) ?? GLYPH_BY_KIND.get(node.kind) ?? "unknown";
}

/** Every class the table maps, for the test that checks each is a real class. */
export const BUILDING_ICON_CLASSES: readonly string[] = [...SLUG_BY_CLASS.keys()];

/** Every slug the table can return, for the test that checks each file exists. */
export const BUILDING_ICON_SLUGS: readonly string[] = [...new Set(SLUG_BY_CLASS.values())];
