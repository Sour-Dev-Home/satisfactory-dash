# FactoryGame: building blueprints and their UI icons (2026-10-26)

Source: the `Content/FactoryGame/Buildable/Factory/` folder of the SML modding project (the same project as
`factorygame-drone-truck-classes-2026-10-25.md`), and the owner's FModel export of the game's `Buildable/Factory/`
textures. Read for the Planner's building icons (ADR-0053). Names and relative paths only.

A blueprint asset `Build_X.uasset` is the class `Build_X_C`, the `ClassName` FRM reports.

| Blueprint asset (under `Buildable/Factory/`) | Class | UI icon texture (under `Buildable/Factory/`) |
|---|---|---|
| `GeneratorBiomass/Build_GeneratorBiomass.uasset` | `Build_GeneratorBiomass_C` | `GeneratorBiomass/UI/IconDesc_BiomassGenerator_256` (shared with `Build_GeneratorBiomass_Automated`) |
| `Train/Station/Build_TrainDockingStationLiquid.uasset` | `Build_TrainDockingStationLiquid_C` | `Train/Station/UI/IconDesc_TrainDockingFluid_256` |
| `IndustrialFluidContainer/Build_IndustrialTank.uasset` | `Build_IndustrialTank_C` | `StorageTank/UI/FluidStorageIndustrial_256` |
| `FrackingSmasher/Build_FrackingSmasher.uasset` | `Build_FrackingSmasher_C` | `FrackingSmasher/UI/IconDesc_Smasher_256` |
| `FrackingExtractor/Build_FrackingExtractor.uasset` | `Build_FrackingExtractor_C` | `FrackingExtractor/UI/IconDesc_Extractor_256` |
| `AlienPower/Build_AlienPowerBuilding.uasset` | `Build_AlienPowerBuilding_C` | `AlienPower/UI/IconDesc_AlienPowerAugmenter_256` |
| `PowerStorage/Build_PowerStorageMk1.uasset` | `Build_PowerStorageMk1_C` | `PowerStorage/UI/IconDesc_PowerStorage_256` |

None of these classes has been seen on the owner's server yet; FRM reporting them under these names is
[NEEDS VERIFICATION] until a capture shows one.
