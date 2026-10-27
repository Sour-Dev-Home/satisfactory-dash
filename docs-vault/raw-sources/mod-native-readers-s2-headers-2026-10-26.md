# Sprint S2 header survey: native readers R2a factory machines, R2b production rates, R3 trains and train routes, R4 className follow-up (ADR-0058)

Paths relative to Source/FactoryGame/Public unless noted. Pinned (harness/toolchain.json): engine 5.6.1, SML 3.12.0.
Headers: the game's own, shipped with the SML 3.12.0 starter project (Source/FactoryGame/Public);
UE = the engine's Engine/Source/Runtime (engine 5.6.1-CSS).
FRM source was not opened. No web search was done. Sources used: the game and SML headers above, UE headers, ADR-0058, the S1 survey (format),
our contract (`packages/shared/src/agent.ts`, `factory.ts`, `map.ts`), our bridge adapters (`FrmFactory.cpp`, `FrmMapLive.cpp`, `GameReader.cpp`),
and our recorded FRM outputs (frm-getFactory-2026-09-22-01-running-trimmed.json, frm-getFactory-2026-10-25-id-stability.md, frm-getTrains-*, frm-getTrainStation-*,
frm-getResourceNode-2026-09-27-trimmed.json, frm-getFactory.md, frm-train-gate-2026-10-21.md), used only as a black box (which fields exist, their values).
Every line below cites a header I opened; comments are paraphrased, no bodies. Status: found = declaration read; derived = computed from found declarations;
[NEEDS VERIFICATION] = not in a header I read, or the header gives a declaration but not the behaviour, do not design on it.
Note on S1: its `AActor::GetActorLocation Actor.h:1580` is the Blueprint wrapper `K2_GetActorLocation` (:1581); the native getter is Actor.h:2505 (below).

## R2a factory machines (parity row 4)

### Enumeration

- `AFGBuildableSubsystem : AFGSubsystem, IFGSaveInterface` - FGBuildableSubsystem.h:246
  - `static Get(UWorld*)` :272; `static Get(UObject* worldContext)` :276
  - `GetAllBuildablesRef()` :360 (const ref to the array of ALL buildables: belts, walls, machines; can be invalidated by add/remove during the read)
  - `GetBuildableCount(TSubclassOf<AFGBuildable>)` :363 (backed by map mBuildableCount :633; cheap count per class)
  - `GetTypedBuildable(TSubclassOf<AFGBuildable>, TArray<AFGBuildable*>&)` :367; templated `GetTypedBuildable<T>(TArray<T*>&)` :371, body :840
    (header body: loops every entry of mBuildables :629 and does a `Cast<T>`, so cost is linear in all buildables, not in machines)
  - `mFactoryBuildings` :640 (all factory-tickable buildings except belts and splitters/mergers) is under `private:`; no public getter found. Not usable.
  - `DebugGetFactoryActors(TArray<AActor*>&)` :434 (debug name; do not rely on it)
- UE alternative: `TActorIterator` / `TActorIteratorBase` - Engine/Public/EngineUtils.h:317 (ctor with world, class, flags :427). Walks every actor in the world; costlier than the subsystem list.
- Machine class hierarchy:
  - `AFGBuildableFactory : AFGBuildable, IFGSignificanceInterface, IFGConditionalReplicationInterface` - Buildables/FGBuildableFactory.h:27 (every production building, incl. generators, platforms, extractors)
  - `AFGBuildableManufacturer : AFGBuildableFactory, IFGRecipeProducerInterface` - Buildables/FGBuildableManufacturer.h:85 (has a recipe, input and output inventories; assemblers, constructors, refineries etc.)
  - `AFGBuildableManufacturerVariablePower : AFGBuildableManufacturer` - Buildables/FGBuildableManufacturerVariablePower.h:11 (a Manufacturer subclass, so a Cast to Manufacturer covers it)
  - `AFGBuildableFactorySimpleProducer : AFGBuildableFactory` - Buildables/FGBuildableFactorySimpleProducer.h:15 (no recipe, not a Manufacturer)
  - `AFGBuildableTrainPlatform : AFGBuildableFactory` - Buildables/FGBuildableTrainPlatform.h:29 (train platforms are factory buildings too; see R3)
- Capture evidence of FRM's scope: classes seen are Build_AssemblerMk1_C, Build_ConstructorMk1_C, Build_OilRefinery_C only (3 of the trimmed capture's classes, all recipe machines);
  338 and 340 entries on the owner's saves. Whether FRM also lists generators, miners or platforms is not shown by our captures [NEEDS VERIFICATION].
  Recommendation: start from `AFGBuildableManufacturer` (and subclasses) and compare the count with the capture.

### Per-machine declarations

- Identity
  - id: `UObject::GetName()` - Runtime/CoreUObject/Public/UObject/UObjectBaseUtility.h:429 (also `GetFName` UObjectBase.h:206). Capture: `Build_AssemblerMk1_C_2147069774` has the shape "class name + number",
    and frm-getFactory-2026-10-25-id-stability.md records the same ids across a restart, consistent with the saved actor object name. That the capture's ID equals GetName() is an inference [NEEDS VERIFICATION by a harness check].
  - className: `GetClass()->GetName()` (generic UObject); expected form "Build_AssemblerMk1_C" per the capture.
  - name (display): the capture's `Name` is "Assembler". Candidate: the buildable's display name via the class default object; no accessor read yet [NEEDS VERIFICATION].
    (I did not find a one-line getter in FGBuildable.h; look for `GetDisplayName`/`mDisplayName` before relying on it.)
- Recipe
  - `AFGBuildableManufacturer::GetCurrentRecipe()` -> `TSubclassOf<UFGRecipe>` - FGBuildableManufacturer.h:165 (field mCurrentRecipe :282; null when not set)
  - `AFGBuildableManufacturer::IsConfigured()` override - FGBuildableManufacturer.h:102 (base declaration FGBuildableFactory.h:143; behaviour not in header)
  - `UFGRecipe` - FGRecipe.h:40: static `GetRecipeName(TSubclassOf<UFGRecipe>)` :55 (FText; capture shows "Alternate: Coated Iron Canister" for alternates, so the display name already carries the prefix),
    static `GetIngredients(worldContext, recipe)` :59, static `GetProducts(recipe)` :63, static `GetManufacturingDuration(recipe)` :75;
    instance `GetProducts()` :126, `GetIngredients()` :127, `GetManufacturingDuration()` :129; fields mIngredients :157, mProduct :161, mManufactoringDuration :173
  - `FItemAmount` - ItemAmount.h:14 (ItemClass :32, Amount :36)
  - Item names: static `UFGItemDescriptor::GetItemName(TSubclassOf<UFGItemDescriptor>)` - Resources/FGItemDescriptor.h:191 (FText); class name for the rate `className` = `ItemClass->GetName()` (e.g. "Desc_IronPlate_C").
  - Unconfigured machine: contract wants `recipe: null`; FRM sends "Unassigned" plus IsConfigured:false (FrmFactory.cpp:461-462 already converts). Native: null mCurrentRecipe maps straight to null.
- State flags
  - producing: `AFGBuildableFactory::IsProducing()` - FGBuildableFactory.h:151 (via virtual `Factory_IsProducing` :157, field mIsProducing :720 as a bit). This is the instantaneous flag the contract calls `isProducing`.
  - paused (standby): `IsProductionPaused()` :184 (field mIsProductionPaused :653, setter SetIsProductionPaused :180 not for us).
  - has power: `HasPower()` :92 (cached from `Factory_HasPower` :397). Source for the backend's "unpowered" state, if the agent has to send it (the contract omits `state` from the agent form, agent.ts:96, so the backend derives it from flags + percent).
  - status enum: `GetProductionIndicatorStatus()` :189 -> `EProductionStatus` (Buildables/FGBuildable.h:50: IS_NONE, IS_PRODUCING, IS_PRODUCING_WITH_CRYSTAL, IS_STANDBY, IS_ERROR, IS_MAX). Possibly a closer match to what the in-game light shows; how it maps to FRM's three flags is open.
  - `CanProduce()` :176 (BlueprintNativeEvent, "can a cycle start"); not used by the contract.
- Productivity and clock (also used by R2b)
  - `GetProductivity()` :213 (virtual float; header says only "a measure of how productive"); `GetProductivityMeasurementDuration()` :217
  - fields: mCurrentProductivity :712 (a replicated byte, 0-255 = 0-100 percent, per its comment); mDefaultProductivityMeasurementDuration :695 (300 s default);
    the last/current produce-duration and duration accumulators :700-708. The comment on :692 says the actual average spans between 1x and 2x the default window (300 to 600 s).
  - `GetCurrentPotential()` :225 (the clock multiplier, 1.0 = 100%; field mCurrentPotential :671); `GetPendingPotential()` :229 (applied at the end of a cycle, field :610); `GetCurrentMinPotential()` :237; `GetMaxPotential()` :241; `GetCurrentMaxPotential()` :245; `GetCanChangePotential()` :249
  - `GetCurrentProductionBoost()` :315 (Somersloop multiplier); `GetPendingProductionBoost()` :319; `GetMaxProductionBoost()` :331; `IsAlienOverclocked()` :164; `IsOverclocked()` :168
  - `AFGBuildableManufacturer::GetManufacturingSpeed()` - FGBuildableManufacturer.h:153 (field mManufacturingSpeed :250; relation to potential not in header)
- Cycle time: `GetProductionCycleTime()` :197 (with current potential applied, per its comment), `GetDefaultProductionCycleTime()` :201, `GetProductionCycleTimeForRecipe(recipe)` :205 (no modifiers), `CalcProductionCycleTimeForPotential(potential)` :209, `GetProductionProgress()` :193
  (Manufacturer overrides: FGBuildableManufacturer.h:103-107)
- Location
  - `AActor::GetActorLocation()` - Runtime/Engine/Classes/GameFramework/Actor.h:2505 (centimetres); `GetActorRotation()` :2511 (FRotator; yaw is the contract's `rotationDeg`, normalised to [0,360)).
  - Contract `zM` also needs z / 100. Captured `rotation:180`, `pitch:0` in the FRM output; the contract keeps only yaw.
- Power / circuit group
  - `AFGBuildableFactory::GetPowerInfo()` -> `UFGPowerInfoComponent*` - FGBuildableFactory.h:108 (null when the building does not run on power; `RunsOnPower()` :101)
  - `UFGPowerInfoComponent : UActorComponent, IFGSaveInterface, IFGConditionalReplicationInterface` - FGPowerInfoComponent.h:51
    - `GetPowerCircuit()` :80 -> `UFGPowerCircuit*` (power circuit, FGPowerCircuit.h:148)
    - `HasPower()` :93; `IsFuseTriggered()` :97; `GetTargetConsumption()` :108; `GetActualConsumption()` :127 (the capture's PowerConsumed / MaxPowerConsumed are not in the contract; do not read)
  - `UFGCircuit::GetCircuitGroupID()` - FGCircuit.h:71 (field mCircuitGroupID :129); `GetCircuitID()` :57 (see S1: group ids come from RebuildCircuitGroups, FGCircuitSubsystem.h:195)
  - `UFGPowerConnectionComponent::GetPowerCircuit()` FGPowerConnectionComponent.h:46 (same answer through the connection component)
  - Contract: `circuitGroupId` is -1 when not connected (factory.ts). Native: GetPowerInfo() null, or GetPowerCircuit() null => -1. The capture shows CircuitGroupID -1 and CircuitID -1 for the unconnected constructor.
- Inventories
  - `GetInputInventory()` :157, `GetOutputInventory()` :161 (FGBuildableManufacturer.h; fields mInputInventory :258, mOutputInventory :278); also `GetInputInventoryItems(TArray<FInventoryStack>&)` :209 and `GetOutputInventoryItems(...)` :215
  - `UFGInventoryComponent : UActorComponent, IFGSaveInterface, IFGConditionalReplicationInterface` - FGInventoryComponent.h:158
    - `GetInventoryStacks(TArray<FInventoryStack>&, bool getEmptyStacks = false)` :451; `GetStackFromIndex(int32, FInventoryStack&)` :326; `GetItemClassAtIndex(int32)` :454; `GetSizeLinear()` :443 (slot count);
      `GetNumItems(itemClass)` :415; `GetSlotSize(int32 index, TSubclassOf<UFGItemDescriptor> = nullptr)` :493 and `GetSlotSizeForItem(...)` :495 (per-slot capacity)
  - `FInventoryStack` - FGInventoryComponent.h:95: `Item` (FInventoryItem :112, item class via `GetItemClass()` :45), `NumItems` :116
  - `UFGItemDescriptor::GetStackSize(itemClass)` - Resources/FGItemDescriptor.h:251; `GetStackSizeConverted(itemClass)` :258 (divides liquids by 1000, litres to m3, per its comment); `GetForm(itemClass)` :158 and enum `EResourceForm` :18 (RF_INVALID, RF_SOLID, RF_LIQUID, RF_GAS)
  - Fluid stack caching: `GetScaledFluidStackSize()` FGBuildableFactory.h:257; mCachedFluidStackSize :685. The FRM capture shows a refinery fluid slot as 3.2 of MaxAmount 50 (m3 scale), so the unit conversion for fluid slots must be checked against the game numbers (open question 3).

### Mapping table (contract `FactoryBuildingSchema` / `AgentFactoryBuildingSchema`)

| Contract field | Native source | Status |
|---|---|---|
| id | UObject::GetName UObjectBaseUtility.h:429 (capture ID looks like the actor object name) | derived, [NEEDS VERIFICATION] equality with FRM's ID on the same save |
| name | buildable display name (accessor not found) | [NEEDS VERIFICATION] |
| className | GetClass()->GetName() | derived |
| recipe | UFGRecipe::GetRecipeName FGRecipe.h:55 over GetCurrentRecipe FGBuildableManufacturer.h:165; null if mCurrentRecipe is null | found |
| isProducing | IsProducing FGBuildableFactory.h:151 | found |
| isPaused | IsProductionPaused :184 | found |
| isBackedUp / inputsFull | backend/agent derivation from slots: input/output stacks vs GetSlotSize FGInventoryComponent.h:493 (what FrmFactory.cpp:468-485 does with FRM's Amount >= MaxAmount) | derived |
| state | not sent by the agent (omitted in agent.ts:96); backend derives | n/a |
| location (xM,yM,zM,rotationDeg) | GetActorLocation Actor.h:2505 / 100; GetActorRotation :2511 yaw | derived |
| clockSpeedPercent | 100 * GetCurrentPotential FGBuildableFactory.h:225 | derived; compare with capture ManuSpeed 100 / 160 |
| circuitGroupId | GetPowerInfo :108 -> GetPowerCircuit FGPowerInfoComponent.h:80 -> GetCircuitGroupID FGCircuit.h:71; -1 when none | derived |
| production[] / ingredients[] | R2b below | see R2b |

Counts R2a: found 6 (recipe, isProducing, isPaused, power info, circuit group id, inventories), derived 5, unverified 2 (display name accessor, id equality).

## R2b production and ingredient rates (parity row 4, rate columns)

Contract (`ProductionRateSchema`, factory.ts:5-30): name, className, currentPerMinute ("averaged"), maxPerMinute ("includes clock speed"), percent (0-100), unit derived by the backend.

What the headers give:
- Per recipe: ingredient and product amounts per cycle (`FItemAmount` ItemAmount.h:14; UFGRecipe GetIngredients :127, GetProducts :126) and the base cycle time `GetManufacturingDuration()` :129.
- Per machine: the current clock `GetCurrentPotential()` :225, the cycle time with the clock applied `GetProductionCycleTime()` :197 and without it `GetDefaultProductionCycleTime()` :201, and the game's own averaged productivity `GetProductivity()` :213 over a 300 s window that the header says really spans 300 to 600 s (mDefaultProductivityMeasurementDuration :695, comment at :692).
- The Somersloop multiplier `GetCurrentProductionBoost()` :315 is separate from the clock.

Deterministic (no game state beyond the recipe and clock):
- `maxPerMinute` = amount (for liquids and gases, /1000 to m3) x 60 / duration x potential. Derived: the header has no recipe-amount converter. `UFGItemDescriptor::GetForm` (FGItemDescriptor.h:158) tells a liquid or gas (`EResourceForm` :18), and the /1000 litres-to-m3 rule is stated only for stack sizes (the comment on `GetStackSizeConverted`, :255-258). The captures agree with it. Matches the captures: a Stator at 100% shows MaxProd 5, at 160% shows 8 (clock x recipe, already included); refinery 60 crude in / 40 fuel out m3 at 100%.
  Whether the Somersloop boost multiplies production only (not ingredients) is not in the headers I read and no capture has a Somersloop (all Somersloops:0) [NEEDS VERIFICATION].
  Cycle time with the clock applied is also in `GetProductionCycleTime()` :197, so `maxPerMinute` can be cross-checked from two sources.

Averaged / unclear semantics (the ADR's known risk):
- The FRM numbers in our capture satisfy a simple relation: ProdPercent equals the machine's "Productivity" field, which sits on a 1/255 grid (9.4117 = 24/255, 24.7058 = 63/255 in the trimmed capture), and CurrentProd = MaxProd x that percent (60 x 0.0941 = 5.647). That is exactly the grid of the game's byte `mCurrentProductivity` (:712). So FRM's "averaged" rate very probably is the game's own productivity average, and the answer to the ADR's open question on the averaging window is likely the 300 to 600 s window above. This is an inference from the capture shape plus one header comment; the body of `GetProductivity()` is not in the header, and the byte is replicated (quantised), so it is a hypothesis for the harness to test, not a design fact [NEEDS VERIFICATION].
- Consequence if confirmed: `percent` = 100 x GetProductivity() (same value for every item in the machine, as in the capture where ingredients and products share a percent), `currentPerMinute` = `maxPerMinute` x productivity, for both products and ingredients. ConsPercent equals ProdPercent in the capture (both 9.4117).
- Unclear: whether GetProductivity() returns the 0-1 fraction or the quantised byte value as float (header says only "a measure"); whether it is 0 for standby or newly built machines (a field comment says productivity is not ticked for newly built or standby buildings, flag mProductivityMonitorEnabled :716); the instantaneous flag vs average (frm-getFactory capture: IsProducing false with ProdPercent 9.4).
- `unit`: from `UFGItemDescriptor::GetForm` :158 (RF_SOLID items/min, liquid/gas m3/min); contract says the backend resolves it, the agent form omits `unit` (agent.ts:95).
- Not computable deterministically: the per-building tolerance in the ADR (5% for 95% of buildings) depends on the productivity average being the same window and sampling instant as FRM's.

## R3 trains, stations, train routes (parity rows 6 and 7)

### Enumeration

- `AFGRailroadSubsystem : AFGSubsystem, IFGSaveInterface` - FGRailroadSubsystem.h:88
  - `static Get(UWorld*)` :117; `static Get(UObject* worldContext)` :121
  - `GetAllTrains(TArray<AFGTrain*>&) const` :174; `GetTrains(int32 trackID, ...)` :170 (by track graph)
  - `GetAllTrainStations(TArray<AFGTrainStationIdentifier*>&) const` :207; `GetTrainStations(int32 trackID, ...)` :199
  - `SortTrains` / `SortTrainStations` (sorted by name) exist but are not needed
  - raw lists mTrainStationIdentifiers :600, mTrains :604 are private; use the getters above. Both enumerate only what the subsystem tracks, so cost is linear in trains and stations (small), no world scan needed.

### Trains

- `AFGTrain : AActor, IFGSaveInterface, IFGSignificanceInterface, IFGActorRepresentationInterface` - FGTrain.h:386
  - name: `GetTrainName()` :460 (FText; field mTrainName :729, public)
  - id: `GetName()` of the actor (FRM capture ID is `BP_Train_C_2146471703`, the same shape as machines) [NEEDS VERIFICATION: equality]
  - graph id: `GetTrackGraphID()` :468
  - self-driving: `IsSelfDrivingEnabled()` :479; `IsPlayerDriven()` :475; `GetSelfDrivingError()` :487 -> `ESelfDrivingLocomotiveError` FGTrain.h:25; `GetDockingState()` :535 -> `ETrainDockingState` :42 (TDS_None, TDS_ReadyToDock, TDS_Docked); `IsDerailed()` :591
  - status: `GetTrainStatus()` :614 -> `ETrainStatus` FGTrain.h:64: TS_Parked, TS_ManualDriving, TS_SelfDriving, TS_Derailed. These are the game's names; the capture's FRM `Status` is the string "Self-Driving" (hyphen) while the enum DisplayName is "Self Driving" (space, FGTrain.h:68), so the mapping to FRM's wording must be written by us. Only "Self-Driving" is seen in our captures; the strings for parked, manual and derailed are unknown [NEEDS VERIFICATION].
  - timetable: `GetTimeTable()` :511, `HasTimeTable()` :519 -> `AFGRailroadTimeTable : AInfo, IFGSaveInterface` FGRailroadTimeTable.h:32:
    `GetNumStops()` :62, `GetStops(TArray<FTimeTableStop>&)` :70, `GetStop(int32)` :88, `GetCurrentStop()` :92, `IsValidStop(int32)` :81; `FTimeTableStop` FGRailroadTimeTable.h:15 (`Station` -> `AFGTrainStationIdentifier*` :21; docking rule set beside it)
  - vehicles: `GetFirstVehicle()` :523, `GetLastVehicle()` :527; public consist data `mConsistData` :709 (`FTrainConsist` :103, `Vehicles` array :109, Length/Mass/MaxSpeed); `AFGRailroadVehicle : AFGVehicle` FGRailroadVehicle.h:36, `GetTrain()` FGRailroadVehicle.h:85;
    `AFGFreightWagon : AFGRailroadVehicle` FGFreightWagon.h:24 with `GetFreightInventory()` :47; `AFGLocomotive : AFGRailroadVehicle` FGLocomotive.h:48
  - location: `AFGTrain` is an AActor but whether its own root moves with the train is not stated; safer is the first vehicle: `AFGVehicle::GetVehicleLocationAndRotation(FVector&, FRotator&)` FGVehicle.h:339 or `AActor::GetActorLocation` Actor.h:2505 on `GetFirstVehicle()` [NEEDS VERIFICATION which one matches FRM's x,y within 1 m]. cm to whole metres.
  - speed (not in the contract): `FTrainSimulationData` FGTrain.h:299 has `Velocity` :333 (signed, cm/s); `FClientTrainData` :344 has `GetForwardSpeed()` :350. Capture shows ForwardSpeed 14.6 (unit not stated). Skip unless the contract adds speed.

### Stations and platforms

- `AFGTrainStationIdentifier : AInfo, IFGSaveInterface, IFGActorRepresentationInterface` - FGTrainStationIdentifier.h:17
  - name: `GetStationName()` :88 (FText; mStationName :127); `GetStation()` :84 -> `AFGBuildableRailroadStation*` (the building); `GetTrackGraphID()` :104
  - Note the identifier is an AInfo (no world position of its own); location comes from the building via `GetStation()`.
- `AFGBuildableRailroadStation : AFGBuildableTrainPlatform` - Buildables/FGBuildableRailroadStation.h:16: `GetStationIdentifier()` :49; `GetStationOutputConnection()` :56 (public, starts the platform chain); mDockedPlatformList :139 is private.
  - id for the contract: the building's `GetName()` ("Build_TrainStation_C_2147412474" in the capture), not the identifier's. Capture note (frm-train-gate-2026-10-21.md): platform ids equal belt end ids, the station building's id does not appear there.
- Platform chain from a station: `UFGTrainPlatformConnection` - FGTrainPlatformConnection.h:26: `GetConnectedTo()` :42 (neighbour connection), `GetPlatformOwner()` :53 (the platform owning it); `AFGBuildableTrainPlatform::GetConnectionInOppositeDirection(...)` Buildables/FGBuildableTrainPlatform.h:66 (public).
  Walking station output -> connected platform -> opposite connection -> ... visits every platform of the station. The traversal order is mine to define; unverified against the in-game layout.
- Cargo platform: `AFGBuildableTrainPlatformCargo : AFGBuildableTrainPlatform` - Buildables/FGBuildableTrainPlatformCargo.h:18: `GetIsInLoadMode()` :57 (field mIsInLoadMode :327; true = loading, false = unloading); `GetInventory()` :37 (field mInventory :319).
  - `GetDockingStatus()` FGBuildableTrainPlatform.h:75 -> `ETrainPlatformDockingStatus` :13.
  - NOT to be confused with `AFGBuildableDockingStation` (FGBuildableDockingStation.h:63), which is the truck dock.
- Platform `mode` in the contract (load/unload, map.ts:183) = GetIsInLoadMode. Capture `LoadingMode` is "Loading"/"Unloading".
- Platform `items` (cargo classes) = distinct item classes of `GetInventory()` stacks (FGInventoryComponent.h:451). Whether FRM lists classes currently held or classes the platform is set to handle is not shown by the capture [NEEDS VERIFICATION]. Contract text says "the platform's handles; empty when unknown".
- Train `items` (cargo classes) = distinct item classes in each freight wagon's `GetFreightInventory()` over the consist vehicles.

### Mapping tables

mapLive (map.ts:319-338; `MapTrain`, `MapTrainStation`):

| Contract field | Native source | Status |
|---|---|---|
| train.id | train actor GetName() | derived, [NEEDS VERIFICATION] |
| train.name | GetTrainName FGTrain.h:460 | found |
| train.x, y | first vehicle location, cm to whole metres | derived, [NEEDS VERIFICATION] which actor |
| train.status | GetTrainStatus FGTrain.h:614, strings mapped by us to FRM wording | derived, wording open |
| station.id | building GetName() via GetStation FGTrainStationIdentifier.h:84 | derived |
| station.name | GetStationName FGTrainStationIdentifier.h:88 | found |
| station.x, y | GetStation()->GetActorLocation (Actor.h:2505) | derived |

trainRoutes layer (map.ts:182-203):

| Contract field | Native source | Status |
|---|---|---|
| station record: id, name | as above | found/derived |
| station.platforms[].id | platform GetName() | derived |
| station.platforms[].mode | GetIsInLoadMode FGBuildableTrainPlatformCargo.h:57 | found |
| station.platforms[].items | platform GetInventory :37 stacks | derived, semantics open |
| train record: id, name | as above | |
| train.stops | timetable GetStops AFGRailroadTimeTable :70, each stop's Station -> GetStationName FGTrainStationIdentifier.h:88 (names, in order) | found |
| train.items | freight wagons' inventories | derived |

Counts R3: found 6 (trains list, stations list, train name, station name, timetable stops, platform mode), derived 8, unverified 4 (train id/location source, status strings, platform items semantics).

## R4 follow-up: resource node `className`

- Contract: `ResourceNodeSchema.className` optional, "FRM's ClassName, e.g. Desc_OreIron_C" - map.ts:91.
- Recorded FRM values (frm-getResourceNode-2026-09-27-trimmed.json): Desc_Coal_C, Desc_LiquidOil_C, Desc_NitrogenGas_C, Desc_OreIron_C, Desc_SAM_C, Desc_Stone_C, Desc_Water_C. These are the RESOURCE DESCRIPTOR classes (Name "Crude Oil" with ClassName "Desc_LiquidOil_C"), not the node actor's class.
- Native: `AFGResourceNodeBase::GetResourceClass()` - Resources/FGResourceNodeBase.h:144 -> `TSubclassOf<UFGResourceDescriptor>`; `UFGResourceDescriptor : UFGItemDescriptor` - Resources/FGResourceDescriptor.h:13. The value is `GetResourceClass()->GetName()` (UObjectBaseUtility.h:429), which for a Blueprint class ends in `_C` like the capture's strings.
  This is the same call the S1 `type` path uses (display text via `UFGItemDescriptor::GetItemName` FGItemDescriptor.h:191, or `GetResourceName()` FGResourceNodeBase.h:180), so className costs one more `GetName()`. Override-aware variants: `GetResourceClassOverride()` :146, `GetResourceClassOriginal()` :150; the capture matches the effective class, which is what `GetResourceClass()` returns (override behaviour inside is not in the header) [NEEDS VERIFICATION on a geyser / satellite].
- Status: derived, no new header risk. A fracking core (not an AFGResourceNode, S1) still has GetResourceClass because it derives from AFGResourceNodeBase.

## Known output differences (our captures vs game values)

- Status string: FRM "Self-Driving" vs enum display "Self Driving".
- Recipe: FRM "Unassigned" + IsConfigured:false vs native null recipe.
- Clock: FRM ManuSpeed is a percent (160); game potential is a multiplier (1.6).
- Inventory: FRM lists only non-empty slots; fluids appear in m3-scale numbers (3.2 of 50) while game stacks count items (litres for fluids, FGItemDescriptor.h:258).
- Rates: FRM currentPerMinute = maxPerMinute x productivity, apparently the game's byte-quantised average.
- Units: FRM x/y/z in centimetres, contract metres; rotation FRM degrees vs FRotator yaw.
- Platform "LoadingMode" strings vs bool.

## Open questions for the plan

1. Is FRM's ID the actor's `GetName()` for machines, trains, stations and platforms (spot-check on the test save)? The 2026-10-25 stability capture is consistent with it.
2. Which buildable classes does FRM's getFactory include beyond assemblers/constructors/refineries (generators? miners? train platforms)? Our captures do not say; the native filter (AFGBuildableManufacturer) should be count-checked against 338/340.
3. Do slot capacities for fluids come out as m3 (50) through `GetSlotSize` :493 / `GetStackSizeConverted` :258, and is `inputsFull`/`isBackedUp` equal to the adapter's derivation (FrmFactory.cpp:477-485) for fluid machines?
4. What does `GetProductivity()` :213 return (fraction or byte-as-float), and is `percent`/`currentPerMinute` = productivity-based as the capture grid suggests? What is the value for standby or newly built machines?
5. Does Somersloop boost enter `maxPerMinute` in FRM, and for ingredients too? (No Somersloop in our captures.)
6. Enumeration cost: `GetTypedBuildable<T>` :371 scans all buildables (belts included) and `GetAllBuildablesRef` :360 is the same list; at 20,000 machines out of hundreds of thousands of buildables this must be sliced across ticks (ADR risk "slow reads"). The iteration can be cached by class or split with a cursor, but a mutation during the loop invalidates the array reference (header comment). Worth measuring on the largest save before choosing; `GetBuildableCount` :363 gives the expected count cheaply.
7. Which actor gives a train's x,y matching FRM within 1 m (AFGTrain actor, first vehicle, or locomotive)?
8. Exact strings for non-self-driving statuses; does the contract keep FRM's wording or switch to the game's? (map.ts:325 says "passed through as-is".)
9. Platform `items`: current cargo or configured filter? Station platform chain ordering and a station without platforms.
10. Does the agent need `Name` (display) for buildings from the native side, and which accessor provides it?
