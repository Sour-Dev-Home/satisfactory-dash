/**
 * The Planner's item icons (ADR-0060 Decision 6, same licence boundary as the building icons): the game's own item
 * textures from the owner's FModel export, as 32, 64 and 128 px WebP in public/game-assets/items/ (see
 * game-assets/NOTICE.md; `scripts/dev/build-item-icons.mjs` rebuilds them). Bubbles use 32 or 64; 128 is for the
 * detail card only. A class that is not here gets `itemIconText`, never a blank bubble.
 *
 * Which texture belongs to which class is the game's own data: `mPersistentBigIcon` in the install's
 * CommunityResources/Docs/en-US.json (game 1.2.4.0, the file the backend's item-form catalog is built from). The
 * texture names often differ from the class (`Desc_IronPlate_C` wears `IconDesc_IronPlates`), so no rule derives one
 * from the other. The slug is the texture name in kebab case, without `IconDesc_` and the size suffix.
 */
const ICON_DIR = "/game-assets/items";

/** The sizes every slug has a file for. */
export const ITEM_ICON_SIZES = [32, 64, 128] as const;
export type ItemIconSize = (typeof ITEM_ICON_SIZES)[number];

/** FRM item `ClassName` to file slug. A Map: class names come from the game server. */
const SLUG_BY_CLASS = new Map<string, string>([
  ["BP_EquipmentDescriptorHazmatSuit_C", "hazmat-suit"], // Hazmat Suit
  ["Desc_AlienDNACapsule_C", "alien-dna"], // Alien DNA Capsule
  ["Desc_AlienPowerFuel_C", "alien-power-matrix"], // Alien Power Matrix
  ["Desc_AlienProtein_C", "alien-protein"], // Alien Protein
  ["Desc_AluminaSolution_C", "liquid-alumina-pipe"], // Alumina Solution
  ["Desc_AluminumCasing_C", "aluminium-casing"], // Aluminum Casing
  ["Desc_AluminumIngot_C", "aluminium-ingot"], // Aluminum Ingot
  ["Desc_AluminumPlate_C", "aluminium-sheet"], // Alclad Aluminum Sheet
  ["Desc_AluminumPlateReinforced_C", "heatsink"], // Heat Sink
  ["Desc_AluminumScrap_C", "aluminium-scrap"], // Aluminum Scrap
  ["Desc_Battery_C", "battery"], // Battery
  ["Desc_Biofuel_C", "solid-biofuel"], // Solid Biofuel
  ["Desc_Cable_C", "cables"], // Cable
  ["Desc_Cement_C", "concrete"], // Concrete
  ["Desc_CircuitBoard_C", "circuit-board"], // Circuit Board
  ["Desc_CircuitBoardHighSpeed_C", "ai-limiter"], // AI Limiter
  ["Desc_Coal_C", "coal-ore"], // Coal
  ["Desc_CompactedCoal_C", "compacted-coal"], // Compacted Coal
  ["Desc_Computer_C", "computer"], // Computer
  ["Desc_ComputerSuper_C", "quantum-computer"], // Supercomputer
  ["Desc_CoolingSystem_C", "cooling-system"], // Cooling System
  ["Desc_CopperDust_C", "copper-dust"], // Copper Powder
  ["Desc_CopperIngot_C", "copper-ingot"], // Copper Ingot
  ["Desc_CopperSheet_C", "copper-sheet"], // Copper Sheet
  ["Desc_Crystal_C", "power-slug-green"], // Blue Power Slug
  ["Desc_Crystal_mk2_C", "power-slug-yellow"], // Yellow Power Slug
  ["Desc_Crystal_mk3_C", "power-slug-purple"], // Purple Power Slug
  ["Desc_CrystalOscillator_C", "crystal-oscillator"], // Crystal Oscillator
  ["Desc_CrystalShard_C", "power-shard"], // Power Shard
  ["Desc_DarkEnergy_C", "dark-energy"], // Dark Matter Residue
  ["Desc_DarkMatter_C", "time-crystal"], // Dark Matter Crystal
  ["Desc_Diamond_C", "diamonds"], // Diamonds
  ["Desc_DissolvedSilica_C", "dissolved-silica"], // Dissolved Silica
  ["Desc_ElectromagneticControlRod_C", "electromagnetic-control-rod"], // Electromagnetic Control Rod
  ["Desc_Fabric_C", "fabric"], // Fabric
  ["Desc_FicsiteIngot_C", "ficsite-ingot"], // Ficsite Ingot
  ["Desc_FicsiteMesh_C", "ficsite-mesh"], // Ficsite Trigon
  ["Desc_Ficsonium_C", "ficsonium-cell"], // Ficsonium
  ["Desc_FicsoniumFuelRod_C", "ficsonium-fuel-rod"], // Ficsonium Fuel Rod
  ["Desc_Filter_C", "gas-mask-filter"], // Gas Filter
  ["Desc_FluidCanister_C", "empty-cannister"], // Empty Canister
  ["Desc_Fuel_C", "fuel"], // Packaged Fuel
  ["Desc_GasTank_C", "pressure-tank"], // Empty Fluid Tank
  ["Desc_GenericBiomass_C", "biomass-final"], // Biomass
  ["Desc_GoldIngot_C", "caterium-ingot"], // Caterium Ingot
  ["Desc_Gunpowder_C", "gunpowder"], // Black Powder
  ["Desc_GunpowderMK2_C", "gunpowder-mk2"], // Smokeless Powder
  ["Desc_HatcherParts_C", "hatcher-part"], // Hatcher Remains
  ["Desc_HazmatFilter_C", "hazmat-filter"], // Iodine-Infused Filter
  ["Desc_HeavyOilResidue_C", "liquid-heavy-oil-residue-pipe"], // Heavy Oil Residue
  ["Desc_HighSpeedConnector_C", "high-speed-connector"], // High-Speed Connector
  ["Desc_HighSpeedWire_C", "quickwire"], // Quickwire
  ["Desc_HogParts_C", "hog-part"], // Hog Remains
  ["Desc_IonizedFuel_C", "ionized-fuel"], // Ionized Fuel
  ["Desc_IronIngot_C", "iron-ingot"], // Iron Ingot
  ["Desc_IronPlate_C", "iron-plates"], // Iron Plate
  ["Desc_IronPlateReinforced_C", "reinforced-iron-plates"], // Reinforced Iron Plate
  ["Desc_IronRod_C", "iron-rods"], // Iron Rod
  ["Desc_IronScrew_C", "iron-screws"], // Screws
  ["Desc_Leaves_C", "leaves"], // Leaves
  ["Desc_LiquidBiofuel_C", "liquid-biofuel-pipe"], // Liquid Biofuel
  ["Desc_LiquidFuel_C", "liquid-fuel-pipe"], // Fuel
  ["Desc_LiquidOil_C", "liquid-oil-pipe"], // Crude Oil
  ["Desc_LiquidTurboFuel_C", "liquid-turbo-fuel-pipe"], // Turbofuel
  ["Desc_ModularFrame_C", "modular-frame"], // Modular Frame
  ["Desc_ModularFrameFused_C", "fused-modular-frame"], // Fused Modular Frame
  ["Desc_ModularFrameHeavy_C", "modular-frame-heavy"], // Heavy Modular Frame
  ["Desc_ModularFrameLightweight_C", "radio-control-unit"], // Radio Control Unit
  ["Desc_Motor_C", "engine"], // Motor
  ["Desc_MotorLightweight_C", "turbo-motor"], // Turbo Motor
  ["Desc_Mycelia_C", "mycelia"], // Mycelia
  ["Desc_NitricAcid_C", "nitric-acid"], // Nitric Acid
  ["Desc_NitrogenGas_C", "nitrogen-gas"], // Nitrogen Gas
  ["Desc_NobeliskCluster_C", "cluster"], // Cluster Nobelisk
  ["Desc_NobeliskExplosive_C", "explosive"], // Nobelisk
  ["Desc_NobeliskGas_C", "gas"], // Gas Nobelisk
  ["Desc_NobeliskNuke_C", "nuke"], // Nuke Nobelisk
  ["Desc_NobeliskShockwave_C", "shock"], // Pulse Nobelisk
  ["Desc_NonFissibleUranium_C", "non-fissile-uranium"], // Non-Fissile Uranium
  ["Desc_NuclearFuelRod_C", "nuclear-fuel-rod"], // Uranium Fuel Rod
  ["Desc_NuclearWaste_C", "nuclear-waste"], // Uranium Waste
  ["Desc_OreBauxite_C", "bauxite"], // Bauxite
  ["Desc_OreCopper_C", "copper-new"], // Copper Ore
  ["Desc_OreGold_C", "caterium-ore"], // Caterium Ore
  ["Desc_OreIron_C", "iron-new"], // Iron Ore
  ["Desc_OreUranium_C", "uranium-ore"], // Uranium
  ["Desc_PackagedAlumina_C", "packaged-alumina-solution"], // Packaged Alumina Solution
  ["Desc_PackagedBiofuel_C", "liquid-biofuel"], // Packaged Liquid Biofuel
  ["Desc_PackagedIonizedFuel_C", "ionized-rocket-fuel"], // Packaged Ionized Fuel
  ["Desc_PackagedNitricAcid_C", "packaged-nitric-acid"], // Packaged Nitric Acid
  ["Desc_PackagedNitrogenGas_C", "packaged-nitrogen"], // Packaged Nitrogen Gas
  ["Desc_PackagedOil_C", "oil"], // Packaged Oil
  ["Desc_PackagedOilResidue_C", "oil-residue"], // Packaged Heavy Oil Residue
  ["Desc_PackagedRocketFuel_C", "packaged-rocket-fuel"], // Packaged Rocket Fuel
  ["Desc_PackagedSulfuricAcid_C", "pckaged-sulphuric-acid"], // Packaged Sulfuric Acid (the texture's own spelling)
  ["Desc_PackagedWater_C", "packaged-water"], // Packaged Water
  ["Desc_PetroleumCoke_C", "petroleum-coke"], // Petroleum Coke
  ["Desc_Plastic_C", "plastic"], // Plastic
  ["Desc_PlutoniumCell_C", "encased-plutonium-cell"], // Encased Plutonium Cell
  ["Desc_PlutoniumFuelRod_C", "plutonium-fuel-rod"], // Plutonium Fuel Rod
  ["Desc_PlutoniumPellet_C", "plutonium-pellet"], // Plutonium Pellet
  ["Desc_PlutoniumWaste_C", "plutonium-waste"], // Plutonium Waste
  ["Desc_PolymerResin_C", "polymer-resin"], // Polymer Resin
  ["Desc_PressureConversionCube_C", "conversion-cube"], // Pressure Conversion Cube
  ["Desc_QuantumEnergy_C", "quantum-energy"], // Excited Photonic Matter
  ["Desc_QuantumOscillator_C", "super-position-oscillator"], // Superposition Oscillator
  ["Desc_QuartzCrystal_C", "quartz-resource"], // Quartz Crystal
  ["Desc_RawQuartz_C", "quartz-crystal"], // Raw Quartz
  ["Desc_RocketFuel_C", "rocket-fuel-pipe"], // Rocket Fuel
  ["Desc_Rotor_C", "rotor"], // Rotor
  ["Desc_Rubber_C", "rubber"], // Rubber
  ["Desc_SAM_C", "same-ore"], // SAM
  ["Desc_SAMFluctuator_C", "sam-fluctuator"], // SAM Fluctuator
  ["Desc_SAMIngot_C", "reanimated-sam"], // Reanimated SAM
  ["Desc_Silica_C", "silica"], // Silica
  ["Desc_SingularityCell_C", "singularity-cell"], // Singularity Cell
  ["Desc_SpaceElevatorPart_1_C", "spelevator-part-1"], // Smart Plating
  ["Desc_SpaceElevatorPart_10_C", "biochemical-sculptor"], // Biochemical Sculptor
  ["Desc_SpaceElevatorPart_11_C", "ballistic-warp-drive"], // Ballistic Warp Drive
  ["Desc_SpaceElevatorPart_12_C", "ai-expension"], // AI Expansion Server
  ["Desc_SpaceElevatorPart_2_C", "spelevator-part-2"], // Versatile Framework
  ["Desc_SpaceElevatorPart_3_C", "spelevator-part-3"], // Automated Wiring
  ["Desc_SpaceElevatorPart_4_C", "spelevator-part-4"], // Modular Engine
  ["Desc_SpaceElevatorPart_5_C", "spelevator-part-5"], // Adaptive Control Unit
  ["Desc_SpaceElevatorPart_6_C", "magnetic-field-generator"], // Magnetic Field Generator
  ["Desc_SpaceElevatorPart_7_C", "assembly-director-system"], // Assembly Director System
  ["Desc_SpaceElevatorPart_8_C", "thermal-propulsion-rocket"], // Thermal Propulsion Rocket
  ["Desc_SpaceElevatorPart_9_C", "nuclear-pasta"], // Nuclear Pasta
  ["Desc_SpitterParts_C", "spitter-part"], // Spitter Remains
  ["Desc_Stator_C", "stator"], // Stator
  ["Desc_SteelIngot_C", "steel-ingot"], // Steel Ingot
  ["Desc_SteelPipe_C", "steel-pipe"], // Steel Pipe
  ["Desc_SteelPlate_C", "steel-beam"], // Steel Beam
  ["Desc_SteelPlateReinforced_C", "encased-steel-beam"], // Encased Industrial Beam
  ["Desc_StingerParts_C", "stinger-part"], // Stinger Remains
  ["Desc_Stone_C", "stone"], // Limestone
  ["Desc_Sulfur_C", "sulfur"], // Sulfur
  ["Desc_SulfuricAcid_C", "liquid-sulfuric-acid-pipe"], // Sulfuric Acid
  ["Desc_TemporalProcessor_C", "temporal-processor"], // Neural-Quantum Processor
  ["Desc_TimeCrystal_C", "exotic-matter"], // Time Crystal
  ["Desc_TurboFuel_C", "turbo-fuel"], // Packaged Turbofuel
  ["Desc_UraniumCell_C", "nuclear-cell"], // Encased Uranium Cell
  ["Desc_Water_C", "liquid-water-pipe"], // Water
  ["Desc_Wire_C", "wire"], // Wire
  ["Desc_Wood_C", "wood"], // Wood
]);

/** The icon URL for an item class at a size, or undefined when the class has none. */
export function itemIconUrl(className: string, size: ItemIconSize): string | undefined {
  const slug = SLUG_BY_CLASS.get(className);
  return slug === undefined ? undefined : `${ICON_DIR}/${slug}-${size}.webp`;
}

/** The first letter or digit of a word, or undefined when it has none. */
function initialOf(word: string): string | undefined {
  return /[\p{L}\p{N}]/u.exec(word)?.[0];
}

/**
 * What a bubble shows when its item has no icon: the initials of the item name's first two words, or "?" when there
 * is no usable name (an unknown item). Never blank. The name comes from the game server and is only ever drawn as text.
 */
export function itemIconText(itemName: string | undefined): string {
  const initials = (itemName ?? "")
    .split(/\s+/)
    .map(initialOf)
    .filter((c): c is string => c !== undefined)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return initials === "" ? "?" : initials;
}

/** Every class the table maps, for the test that checks each is a real item class. */
export const ITEM_ICON_CLASSES: readonly string[] = [...SLUG_BY_CLASS.keys()];

/** Every slug the table can return, for the test and the build script that check each file exists. */
export const ITEM_ICON_SLUGS: readonly string[] = [...new Set(SLUG_BY_CLASS.values())];
