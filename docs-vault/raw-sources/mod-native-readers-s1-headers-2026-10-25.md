# Sprint S1 header survey: native readers R0 power, R1 players, R4 resource nodes (ADR-0058)

Paths relative to Source/FactoryGame/Public unless noted. Pinned (harness/toolchain.json): engine 5.6.1, SML 3.12.0.
Headers: the game's own, shipped with the SML 3.12.0 starter project (Source/FactoryGame/Public); UE = the engine's Engine/Source/Runtime/Engine.
FRM source was not opened. FRM output was read only from our own captures (frm-getPower*, frm-getPlayer*, frm-getResourceNode*)
and our contract/adapter code, as a black box. Every line below cites a header I opened; "unverified" marks what I did not.
Names only: no code bodies. Status: found = declaration read; derived = computed from found declarations;
[NEEDS VERIFICATION] = not in a header I read, do not design on it.

## R0 power (parity row 3)

- `AFGCircuitSubsystem : AFGSubsystem, IFGSaveInterface` - FGCircuitSubsystem.h:32
  - `static GetCircuitSubsystem(UObject* worldContext)` :49
  - `FindCircuit(int32 circuitID)` (+ templated `FindCircuit<T>`) :84, :88 (by circuit id; mCircuits is a TMap, :251)
  - `GetCircuitGroup(int32 circuitGroupId)` :139 (indexes mCircuitGroups, :272, so group ids are array indices)
  - `RebuildCircuitGroups()` :195 (group ids are assigned here; body not in header; flag mAreCircuitGroupsDirty :275)
- `UFGCircuit : UObject, IFGSaveInterface, ...` - FGCircuit.h:22
  - `GetCircuitID()` :57; `GetCircuitGroupID()` :71 (comment: "the group this circuit belongs too"); fields mCircuitID :114, mCircuitGroupID :129
- `UFGPowerCircuit : UFGCircuit` - FGPowerCircuit.h:148
  - `GetStats(FPowerCircuitStats&)` :171
  - `IsFuseTriggered()` :163 (non-const; mIsFuseTriggered :355)
  - `GetPowerProductionCapacity()` :167; `GetMaximumPowerConsumption()` :267 (mMaximumPowerConsumption :322)
  - `HasBatteries()` :211; `GetBatterySumPowerStore()` :215; `GetBatterySumPowerStoreCapacity()` :219
  - `GetBatterySumPowerStorePercent()` :223 (store / capacity, a 0..1 fraction, divides by zero without batteries)
  - `GetBatterySumPowerInput()` :227 (max(x,0)); `GetBatterySumPowerOutput()` :231 (max(-x,0)); signed field mBatterySumPowerInput :342
  - `GetTimeToBatteriesEmpty()` :235; `GetTimeToBatteriesFull()` :239; `HasPower()` :256
  - private per-circuit copies: mPowerProductionCapacity :306, mPowerProduced :310, mPowerConsumed :314
- `FPowerCircuitStats` - FGPowerCircuit.h:57 (read by `GetStats`)
  - PowerProductionCapacity :101; PowerProduced :104; PowerConsumed :107; MaximumPowerConsumption :110; BatteryPowerInput :113; BoostProduced :116
  - (history: StatIntervalTime :88, StatHistoryTime :92, graph points; not needed)
- `FPowerGraphPoint` - FGPowerCircuit.h:17 (Consumed :26, Produced :29, ProductionCapacity :32, MaximumConsumption :35, BatteryPowerInput :38, BoostProduced :41)
- `UFGPowerCircuitGroup : UFGCircuitGroup` - FGPowerCircuit.h:385; `friend` of UFGPowerCircuit (:373)
  - private group aggregates, no getters: mConsumption :427, mMaximumPowerConsumption :428, mBaseProduction :430,
    mMaximumProductionCapacity :433, mHasBatteries :434, mTotalPowerStore :435, mTotalPowerStoreCapacity :436,
    mAreAllFusesTriggered :437, mIsAnyFuseTriggered :438. `ResetFuses(...)` :390 is a write, not for us.
  - `UFGPowerCircuit::CreateCircuitGroup(subsystem)` :292 builds the group object for a circuit.
- Our code today: GameReader.cpp:83-116 (`ReadPower`): loops circuit ids 0..MaxCircuitIdScanned, `FindCircuit<UFGPowerCircuit>`,
  `GetStats`, then reads group id, fuse, batteries (GameReader.cpp:99-113); `SatisDash::GroupCircuits` (GameValues.cpp:3-43)
  merges by group id using the lowest circuit id as the group's "speaker". GameValues.h:9 `FPowerCircuitSample`, :30 `GroupCircuits`.

| Contract field (power.ts) | Native source | Status |
|---|---|---|
| circuitGroupId | UFGCircuit::GetCircuitGroupID FGCircuit.h:71 | found (assignment inside RebuildCircuitGroups :195, body unverified) |
| productionMW | FPowerCircuitStats::PowerProduced :104 | found (proven natively, per brief) |
| consumptionMW | FPowerCircuitStats::PowerConsumed :107 | found, not yet judged |
| capacityMW | FPowerCircuitStats::PowerProductionCapacity :101 | found (proven) |
| maxConsumptionMW | FPowerCircuitStats::MaximumPowerConsumption :110 (also GetMaximumPowerConsumption :267) | found, not yet judged |
| fuseTriggered | UFGPowerCircuit::IsFuseTriggered :163 | found, not yet judged |
| batteryCapacityMWh | GetBatterySumPowerStoreCapacity :219 | found |
| batteryPercent | 100 * GetBatterySumPowerStore :215 / capacity :219 (header :223 is a fraction) | derived |
| batteryDifferentialMW | GetBatterySumPowerInput :227 minus GetBatterySumPowerOutput :231 (= signed mBatterySumPowerInput :342) | derived |

Counts R0: found 6, derived 3, unverified 0 (declarations); behaviour of group merging is open (see questions).

What "max consumption" is in the game: `MaximumPowerConsumption` is a stats member beside PowerConsumed (FGPowerCircuit.h:110) and a
graph series "MaximumConsumption" (:35); the header gives no definition. Our contract text (power.ts:27, "draw if every consumer ran flat out")
and the capture (PowerMaxConsumed 4606 vs PowerConsumed 2693) match the name; the semantics come from our capture, not from a header comment.

## R1 players (parity row 5)

- `AGameStateBase` - UE Classes/GameFramework/GameStateBase.h; `PlayerArray` :55 (TArray of APlayerState, connected players)
- `AFGGameState : AGameState, IFGSaveInterface` - FGGameState.h:116 (no player list member found in my grep of the file)
- `AFGPlayerState final : APlayerState, IFGSaveInterface, IOnlinePlayerStateIdentityInterface` - FGPlayerState.h:261
  - `GetOwningController()` :412; `GetControlledPlayerCharacter()` :307; `IsValidActivePlayerState()` :377 (semantics unread)
  - `OnRep_PlayerName()` :279 override
- `APlayerState` - UE Classes/GameFramework/PlayerState.h: `GetPlayerName()` :232 (virtual `GetPlayerNameCustom()` :235 if a custom-name flag is set, :102);
  `IsInactive()` :381 (bIsInactive :91; comment :89 "came from the GameMode's InactivePlayerArray")
- `AGameMode` (not Base) - UE Classes/GameFramework/GameMode.h: `InactivePlayerArray` :138 (server-side; players who left, kept for rejoin)
- `FServerGameState` (the vanilla API's state) - Server/FGDSGameplayTypes.h: NumConnectedPlayers :42, PlayerLimit :46 (counts only; GameReader.cpp:35-36 uses them)
- Our code today: no name reader. GameReader.cpp:35 reads only the count.

| Contract field (players.ts) | Native source | Status |
|---|---|---|
| name | APlayerState::GetPlayerName PlayerState.h:232 over AGameStateBase::PlayerArray GameStateBase.h:55 (AFGPlayerState FGPlayerState.h:261 is the concrete class) | found |
| online (connected) | member of PlayerArray => true | derived |
| online (offline, known players) | AGameMode::InactivePlayerArray GameMode.h:138 is the only header candidate | [NEEDS VERIFICATION] |

Counts R1: found 1, derived 1, unverified 1 (the offline half of `online`). ADR-0029: read only name and online; do not touch ids, location, inventory.
Observed in our capture (frm-getPlayer-2026-09-27-full.json): a server with nobody connected still returned 1 player with Online:false,
so the game or the FRM layer remembers players across disconnects; which game structure holds them is unknown to me.

## R4 resource nodes (parity row 8)

- `EResourceNodeType : uint8` - Resources/FGResourceNodeBase.h:24: Node, FrackingSatellite, FrackingCore, Geyser, Deposit, Invalid
- `AFGResourceNodeBase : AFGStaticReplicatedActor, IFGExtractableResourceInterface, ...` - Resources/FGResourceNodeBase.h:93
  - `IsOccupied() const` :140 (override; replicated mIsOccupied :267); `CanBecomeOccupied()` :142; `SetIsOccupied` :138
  - `GetResourceClass()` :144 (-> TSubclassOf<UFGResourceDescriptor>); `GetResourceClassOverride()` :146; `GetResourceClassOriginal()` :150
  - `GetResourceNodeType()` :176 (mResourceNodeType :281); `GetResourceName()` :180; `GetResourceForm()` :184
- `EResourcePurity` - Resources/FGResourceNode.h:26: `RP_Inpure` (DisplayName "Impure") :28, `RP_Normal` :29, `RP_Pure` :30, `RP_MAX` (Hidden) :31
- `AFGResourceNode : AFGResourceNodeBase` - Resources/FGResourceNode.h:66
  - `GetResourcePurity()` :113 (override-aware: mPurityOverride == RP_MAX ? mPurity : mPurityOverride); mPurity :165, mPurityOverride :169
  - `GetResourceAmount()` (EResourceAmount) ~:138; `mResourcesLeft`; `CanPlaceResourceExtractor()` (virtual override)
- `AFGResourceNodeFrackingSatellite : AFGResourceNode` - Resources/FGResourceNodeFrackingSatellite.h:23
  - `GetState()` :52 (EFrackingSatelliteState: FSS_Untouched, FSS_Active, FSS_Inactive, :12-16); `GetCore()` :61; `GetExtractor()` :58
- `AFGResourceNodeFrackingCore : AFGResourceNodeBase` - Resources/FGResourceNodeFrackingCore.h:14 (NOT an AFGResourceNode: no purity getter)
  - `GetSatellites(...)` :45; `GetNumOccupiedSatellites(int32&)` :48; `IsAllSatellitesOccupied()` :52; `GetActivator()` :39
- `AFGResourceNodeGeyser : AFGResourceNode` - FGResourceNodeGeyser.h:15 (mAttachedGeoThermals :34)
- `UFGResourceDescriptor : UFGItemDescriptor` - Resources/FGResourceDescriptor.h:13; display name field mDisplayName (FText) Resources/FGItemDescriptor.h:380
- `AFGResourceNodeManager : AFGSubsystem` - Resources/FGResourceNodeManager.h:94: `Get(UWorld*)` :99, static `GetClosestNode(...)` :118;
  the lists mResourceNodes :137, mGeysers :138, mFrackingCore :140 sit under `private:` (:116), so they are not an enumeration API.
  `AFGResourceNodeUtilities::mAllResourceNodesInWorld` :86 is in a separate AActor class (access unread).
- UE: `AActor::GetActorLocation` Classes/GameFramework/Actor.h:1580 (UU = cm); `TActorIterator` EngineUtils.h (iterate `AFGResourceNodeBase`).
- Our code today: none (no resource-node reader in GameReader.cpp).

| Contract field (map.ts:80-95) | Native source | Status |
|---|---|---|
| type (resource name) | GetResourceClass FGResourceNodeBase.h:144 -> UFGResourceDescriptor mDisplayName FGItemDescriptor.h:380 (or GetResourceName :180) | derived (text vs FRM's "Crude Oil" spelling to check) |
| purity | AFGResourceNode::GetResourcePurity FGResourceNode.h:113, enum :26-31 | found (core and non-AFGResourceNode types have none) |
| nodeType | GetResourceNodeType FGResourceNodeBase.h:176, enum :24 | found |
| x, y | AActor::GetActorLocation Actor.h:1580, cm to whole metres | derived |
| exploited | IsOccupied FGResourceNodeBase.h:140 | derived (meaning for satellites/geysers unverified) |
| className | GetResourceClass :144 -> class name (observed "Desc_LiquidOil_C") | derived; in the contract as optional `className` (satisfactory-dash `main`, `packages/shared/src/map.ts:91`, ADR-0053 Decision 5) |

Counts R4: found 3 (purity, nodeType, exploited getter), derived 4 (type, x, y, className), unverified 0 declarations; semantics open below.
Enumeration: no public subsystem list; the candidate is a world actor iterator over AFGResourceNodeBase (server world), which needs a
harness-side count check against the capture (608 items: 459 Node, 118 Fracking Satellite, 31 Geyser; 31 exploited).

## Known output differences (our captures vs game values)

- Purity: capture shows `"Purity":"Impure"` beside `"EnumPurity":"RP_Inpure"`; the game enumerator is spelled RP_Inpure with
  DisplayName "Impure" (FGResourceNode.h:28). map.ts:86 says FRM's "Inpure" typo is corrected to `impure`; our trimmed capture
  shows the corrected word in `Purity`, so the typo survives only in the enumerator name. Native reader: map RP_Inpure -> `impure`.
- NodeType strings in output are "Node", "Fracking Satellite", "Geyser" vs game enum Node, FrackingSatellite, FrackingCore, Geyser, Deposit;
  our contract camelCases them (node, frackingSatellite, geyser). The capture has no Fracking Core or Deposit item (not seen, not proven absent).
- Power: PowerConsumed excludes battery charging (capture header); BatteryPercent in output is 0..100 (2.33) while the game getter is a fraction.
- Power groups: capture shows AssociatedCircuits [0,3] under CircuitGroupID 0 (a battery behind a power switch).
- Players: output carries Name, Online, plus inventory/location/health fields our contract drops (ADR-0029).

## Open questions for the plan

1. Do per-circuit `GetStats()` values (FGPowerCircuit.h:171) hold group-level totals, or per-circuit ones? GroupCircuits takes the lowest-id
   circuit as speaker (GameValues.cpp:13); group aggregates (UFGPowerCircuitGroup :427-438) have no public getter. Needs a capture with a switch-merged group.
2. How are group ids assigned in RebuildCircuitGroups (FGCircuitSubsystem.h:195)? Are they stable, dense, do they equal FRM's CircuitGroupID (0 for circuits 0 and 3)?
3. What is the game's definition of MaximumPowerConsumption (FGPowerCircuit.h:110)? Header has no comment.
4. Which game structure keeps offline players on a dedicated server (InactivePlayerArray GameMode.h:138 is only a candidate)? How long does it persist?
5. Does the contract want fracking cores and deposits (EResourceNodeType :24-31)? FRM output shows neither in our capture.
6. Does IsOccupied (:140) become true for fracking satellites with an extractor, and for geysers with a geothermal generator? Compare with 31 exploited.
7. Is a world actor iterator on a dedicated server complete (are nodes streamed/significance-gated, IsSignificant :195)? Needs the 608-count check.
8. Resource-name text: mDisplayName is FText (localised); is the server culture English, and does it match "Crude Oil"/"SAM"? className (Desc_*_C) is the stable key.
9. ~~Should className join the resourceNodes contract?~~ Answered: it is already there, optional (`map.ts:91` on `main`; the survey's first draft read an older checkout).
