# Sprint S4 part A header survey: native readers R8 mapMarkers, R9 droneRoutes, R10 powerLines, and the mod version (ADR-0058)

Paths relative to Source/FactoryGame/Public unless noted. Pinned (harness/toolchain.json): engine 5.6.1, SML 3.12.0.
Headers: the game's own, shipped with the SML 3.12.0 starter project (Source/FactoryGame/Public); SML = Mods/SML/Source/SML/Public;
UE = the engine's Engine/Source/Runtime (engine 5.6.1-CSS), cited as `Engine/...`.
FRM source was not opened. No web search was done. Sources used: the game, SML and UE headers above, ADR-0058, the S3 survey (format and the enumeration facts it settled),
our contract (`packages/shared/src/map.ts`: `MapMarkerSchema` :240-268, `DronePortSchema` :214-225, `PowerLineSchema` :290-296), our mappers (`mapMarkersMapper.ts`, `droneRoutesMapper.ts`, `powerLinesMapper.ts`),
the existing mod code (`GameReader.cpp`, `Version.cpp`, `api-sources.md`), and our recorded FRM outputs (frm-getMapMarkers-2026-09-27-full.json, frm-getDroneStation-2026-10-25-unpaired-trimmed.json and the two paired-*-trimmed.json,
frm-getCables-2026-09-27-trimmed.json), used only as a black box (which fields exist, their values).
Every line below cites a header I opened; comments are paraphrased, no bodies. Status: found = declaration read; derived = computed from found declarations;
[NEEDS VERIFICATION] = not in a header I read, or the header gives a declaration but not the behaviour, do not design on it.

## R8 mapMarkers (contract `MapMarkerSchema`)

Contract: `{ id (1-200), name (<= 60 chars, trimmed), kind stamp|marker, icon (int 0..1,000,000), color "#rrggbb", x, y (whole metres) }`, at most 1,000 per layer (`MAP_MARKERS_MAX_ITEMS`).

### 1. Where the data lives and how to reach it

- `AFGMapManager : AFGSubsystem, IFGSaveInterface` - FGMapManager.h:70. It owns the markers and the stamps in ONE array: `mMapMarkers` `TArray<FMapMarker>` - FGMapManager.h:255 (private; `UPROPERTY( SaveGame, Replicated )` :254,
  comment: "Replicated only once on join, upcoming replications are handled by multicasts").
- Reach: `AFGMapManager::Get(UWorld*)` - FGMapManager.h:95 (comment :94: should always return something unless called very early); also `Get(UObject* worldContext)` :99; also the game state's `GetMapManager()` - FGGameState.h:219 (field :664).
- Read: `GetMapMarkers( TArray<FMapMarker>& out )` - FGMapManager.h:118. It is public, not const (so the manager pointer must be non-const), and returns a copy. `GetNumMapMarkers()` :111 is a cheap count; `GetMaxNumMapMarkers()` :107 (field `mMaxNumMapMarkers = 250` :299).
  The game's own cap of 250 is far below the contract's 1,000, so the cap cannot bind on markers alone (stamps are in the same array; whether they count toward 250 is not in the header [NEEDS VERIFICATION]).
- Dedicated server: the array is `SaveGame` (the server loads it from the save) and `Replicated` (clients get it on join), and the add/update/remove calls are authority ones (`Authority_UpdateMapMarker` :142, `Authority_RemoveMapMarkerByID` :146), so the server's copy is the authoritative one and is populated on a dedicated server.
  One guard: `CreateMapMarkersForInitialReplication()` :247 and `bCreatedInitialMapMarkers` :275 are private and suggest a startup step; whether `GetMapMarkers` is complete right after load on a headless server is a runtime fact [NEEDS VERIFICATION, the parity run settles it: compare the count with the 4 captured items on the same save].
- Thread: nothing marks `GetMapManager`, `Get` or `GetMapMarkers` thread-safe; read on the game thread. At most 250 items, so one slice, no cursor needed.

### 2. The marker struct (`FMapMarker`, FGMapMarker.h:13)

| Field | Symbol | Type and unit |
|---|---|---|
| id | `MarkerGUID` :37 (`UPROPERTY( SaveGame, BlueprintReadWrite )` :36), `HasValidID()` :71 | `FGuid`, "A unique ID of this map marker" (:35) |
| legacy id | `MarkerID_DEPRECATED` :33 | `uint8`, "Legacy Marker ID saved by the old save system" (:31); do not use |
| location | `Location` :40 | `FVector_NetQuantize` (Engine/Classes/Engine/NetSerialization.h:409, a subclass of `FVector`), world centimetres |
| name | `Name` :43 | `FString` |
| category | `CategoryName` :46 | `FString` (the contract drops it; the capture's `Category` is "" on every item) |
| kind | `MapMarkerType` :49 | `ERepresentationType` (FGActorRepresentation.h:14; `RT_MapMarker` :32, `RT_Stamp` :33) |
| icon | `IconID` :52 | `int32` |
| color | `Color` :55 | `FLinearColor` (Engine/Core/Public/Math/Color.h:47), not a hex string |
| scale | `Scale` :58 | `float` (the contract drops it) |
| compass | `CompassViewDistance` :61 | `ECompassViewDistance` (FGActorRepresentation.h:50; `CVD_Off` .. `CVD_Always` :52-56); the contract drops it |
| last editor | `LastEditedBy` :64 | `FPlayerInfoHandle`; PII-adjacent, never read |
| creator | `CreatedByPlayerID` :68 | `FGuid`, "not saved"; never read |

`ERepresentationType` has about twenty values (FGActorRepresentation.h:14-36 and on); the map manager's array holds markers and stamps, but nothing in the headers says no other type is ever stored there.
The mapper folds anything but `RT_Stamp` into "marker" (`markerKind`), which is the right fallback.

### 3. Mapper derivations → game field

- `id`: `MarkerGUID.ToString()` - `FGuid::ToString( EGuidFormats Format = EGuidFormats::Digits )` Engine/Core/Public/Misc/Guid.h:329 (default `Digits`, 32 digits, :39; the doc example is digits only). The capture's `ID` is 32 hex characters, upper case ("3FABC3BA..."),
  so it looks like `Digits`; whether the letters come out upper or lower case is not in the header text I read [NEEDS VERIFICATION; the contract only needs a stable string, so case does not change meaning, but the parity id join should compare case-insensitively].
  A stable id EXISTS (a saved GUID). If `HasValidID()` (:71) is false, apply the mapper's derived-id rule (`derived-` + sha256 of x, y, kind, icon, color, name); with a saved GUID the rule should never fire.
- `name`: `Name` :43, then the mapper's trim and 60-UTF-16-unit cut (`markerName`). The native reader gets a UE `FString` (UTF-16 on Windows builds, a `TCHAR` array): the cut must count UTF-16 code units and not split a surrogate pair, exactly as the mapper does; do it in the pure `SatisDashCore` code with a test vector for an emoji at the cut.
- `kind`: `MapMarkerType == ERepresentationType::RT_Stamp` -> stamp, else marker (FGActorRepresentation.h:33, :32). The capture's strings "RT_Stamp" and "RT_MapMarker" are the enumerator names.
- `icon`: `IconID` :52 (int32, no unit; 660 and 349 in the capture; an `IconID` outside 0..1,000,000 is dropped by the mapper).
- `x`, `y`: `Location.X`, `Location.Y` :40 in centimetres, `Math.round(cm / 100)` (S3: `coordinates.ts` `toWholeMetres`). The capture has fractional values (-12468.55859375), so the values are not integer centimetres in the saved data; `FVector_NetQuantize` is a replication type
  (it rounds to whole centimetres on the wire only, per its name; the body is not in the header text [NEEDS VERIFICATION]), and on the server the stored value is what is read. A sub-metre rounding difference is possible at .5 m boundaries; the parity tolerance is one metre.
- `color`: the hard one. The game stores a `FLinearColor` (:55). The contract wants "#rrggbb" read as RRGGBBAA of FRM's `ColorSlot` with the alpha dropped (owner check 2026-10-27: 6EA37BFF is green; stamps are FFFFFFFF).
  UE gives two conversions: `FLinearColor::ToFColor( bool bSRGB )` - Color.h:381 (`ToFColorSRGB()` :379, "ToFColor(false) is QuantizeRound" :377) and `FColor::ToHex()` - Color.h:706 ("The format of the string is RRGGBBAA" :700).
  So `Color.ToFColor(x).ToHex()` yields exactly an RRGGBBAA string. Whether the game's colour needs the sRGB step (`true`) or plain rounding (`false`) cannot be read from a header: a colour like 6EA37B differs between the two. [NEEDS VERIFICATION, the parity run settles it:
  read the 4 captured markers (plus the owner's green one) with both and keep the one that equals the capture's `ColorSlot`.] White (FFFFFFFF) is the same either way, so the captured stamps do not discriminate; the green marker is the test.
  Alpha is dropped, so alpha handling does not matter. The mapper's fallback "#ffffff" for an unreadable colour has no native equivalent (the struct always has a colour); use it only for NaN.
- Dropped fields (z, `CategoryName`, `Scale`, `CompassViewDistance`): simply not read.

### 4. Volume and privacy

- Captured world: 4 items, 1,019 bytes. Game cap 250 (:299). Names are player text: the native reader must never log them (the mapper's rule), and the evidence bundle must carry counts, not names.

## R9 droneRoutes (contract `DronePortSchema` + proposed nullable `pairedId`)

Contract: `{ id, name, paired (name | null), input[], output[], fuel[] (distinct item class names), x, y }`, at most 2,000 ports. The proposed `pairedId` is the paired port's id or null.

### 1. Enumeration

- Two routes, both public:
  a. `AFGDroneSubsystem : AFGSubsystem` - FGDroneSubsystem.h:61; `Get( UWorld* )` :68 (also `Get( UObject* )` :72); `GetAllStations()` -> `const TArray<AFGDroneStationInfo*>&` - FGDroneSubsystem.h:81 (field `mStations` :142, `Replicated`, private). One entry per station, the info actor.
  b. The buildable list the logistics pass already walks: `Cast<AFGBuildableDroneStation>` over `GetAllBuildablesRef()` (FGBuildableSubsystem.h:360). `AFGBuildableDroneStation : AFGBuildableFactory, IFGActorRepresentationInterface` - Buildables/FGBuildableDroneStation.h:37 (the mod already uses it as a Cast target, api-sources.md:699).
- Recommended: route (a) for the list (it is O(ports) and needs no cast), `GetStation()` to reach the buildable. `AFGDroneStationInfo : AInfo, IFGSaveInterface, IFGBuildingTagInterface` - FGDroneStationInfo.h:159. Its `GetStation()` :252 is documented "Server-only access to the actual station" (:251);
  the field `mStation` :394 is `SaveGame` and not replicated. On a dedicated server that is the case we run, so it is non-null for a live station, but the reader must null-check (a station being destroyed).
  Whether a port can have an info whose `mStation` is null (never expected) is a runtime fact [NEEDS VERIFICATION]; skip such an entry and count it.
- Game thread, one slice: the contract caps at 2,000; the captured test save has 7 ports (13 KB as FRM sends it). No cursor needed for the info list; the inventory walk is the heavier part and is a handful of stacks per port.

### 2. Contract field → symbol

| Contract field | Native source | Status |
|---|---|---|
| id | `GetName()` of the BUILDABLE (`AFGBuildableDroneStation`) - UObjectBaseUtility.h:429 (S2); capture ids are "Build_DroneStation_C_2147451055", the "class name + number" form | derived, [NEEDS VERIFICATION] equality with FRM's `ID` (the S3 note leans on the same assumption: a belt end names the port by the building's `GetName()`) |
| name | `AFGDroneStationInfo::GetBuildingTag_Implementation()` - FGDroneStationInfo.h:190 (field `mBuildingTag` :411, `SaveGame, Replicated`; interface `IFGBuildingTagInterface::GetBuildingTag` FGBuildingTagInterface.h:46, a BlueprintNativeEvent, so call the interface wrapper or the `_Implementation`) | found for the field; that FRM's `Name` is the tag [NEEDS VERIFICATION] (the capture's names "FUEL 5" and "TestLand1" are player-chosen, so the tag is the likely source) |
| name (alternative) | `AFGBuildableDroneStation::GetActorRepresentationText()` - FGBuildableDroneStation.h:52 (an `FText` override; the blueprint hook `GetRepresentationText()` :197 is `BlueprintImplementableEvent`, so its body is not in C++) | found; use only if the tag differs |
| paired (name) | `GetPairedStation()` -> info - FGDroneStationInfo.h:201 (field `mPairedStation` :404, `SaveGame, Replicated`), then that info's tag as above; null pointer = unpaired | found |
| pairedId (proposed) | `GetPairedStation()->GetStation()->GetName()`, null if any link is null | derived; the paired station IS reachable as an object, so its id can be given |
| input | `GetInputInventory()` - FGBuildableDroneStation.h:145 (field `mInputInventory` :317), distinct item classes | found, see the unit note below |
| output | `GetOutputInventory()` :149 (field `mOutputInventory` :321) | found |
| fuel | `GetFuelInventory()` :153 (field `mFuelInventory` :325) | found |
| x, y | `GetActorLocation()` (Engine/Classes/GameFramework/Actor.h:2505) of the buildable, or `AFGDroneStationInfo::GetStationLocation()` FGDroneStationInfo.h:208 (field `mStationLocation` :398, `Replicated`); centimetres, /100 and round | found; which of the two matches FRM's `location` is [NEEDS VERIFICATION, parity run]; prefer the actor location (the building), the info's is a copy |

Header disagreement to record (rule 2, "the header wins"): the accessor comments in FGBuildableDroneStation.h say `GetInputInventory()` is "the inventory that the docked drone unloads into" (:143) and `GetOutputInventory()` "the inventory that the docked drone loads from" (:147),
while the field comments say `mInputInventory` is where "we transfer items from when loading a drone" (:315) and `mOutputInventory` where "we transfer items to when unloading from a drone" (:319). The two readings are opposite.
Our captured output settles which one FRM's names follow: the home port's `InputInventory` held the outgoing cargo (3 Battery) and the partner's was empty (frm-getDroneStation-2026-10-25-paired-battery-cargo-trimmed.json), which matches the FIELD comments and the contract's text
("input = the cargo it sends to its pair"). The native reader reads the three fields by their getters and the parity run compares the item sets with the capture's `InputInventory` and `OutputInventory` on the same save; if the getters turn out to be swapped against the capture, swap them in the reader and record it.

### 3. Item classes in an inventory

- `UFGInventoryComponent` - FGInventoryComponent.h:158 (api-sources.md:557). Walk `GetSizeLinear()` :443 slots; `GetStackFromIndex( idx, FInventoryStack& )` :326; a stack has items when `HasItems()` :104 (`NumItems > 0 && Item.IsValid()`); the class is `Item.GetItemClass()` :45 (`Item` :112, `NumItems` :116).
  The contract wants distinct class names (sorted, by the dash's `itemClasses` helper): use the same class-name form the factory reader already emits for items (`GetName()` of the descriptor class with its `_C` suffix as the S2 reader does), de-duplicated and sorted in the pure core code.
- The capture's inventory is a list of items per inventory; amounts are NOT in the contract, so the reader must not send them (they move on every trip and would break the hash dedup).

### 4. Not in the contract (do not read)

`GetDroneStatus()` FGDroneStationInfo.h:198, `GetConnectedStations()` :205, the trip statistics (:265-353), `GetStationDrone()` and `GetDockedDrone()` FGBuildableDroneStation.h:120-123, fuel info (:218-233). They are in FRM's output and not in the contract.

## R10 powerLines (contract `PowerLineSchema`)

Contract: `{ id (1-200), points: [[x, y], [x, y]] }` whole metres, a straight segment; at most 20,000 lines (`POWER_LINES_MAX_ITEMS`). The captured world has 843.

### 1. The wire buildable

- `AFGBuildableWire : AFGBuildable` - Buildables/FGBuildableWire.h:33, declared `UCLASS( Abstract )` :32. Like rails, filter with `Cast<AFGBuildableWire>`, not a concrete `StaticClass()` count. No class derives from it in the Public headers (`grep "public AFGBuildableWire"` found nothing); the concrete power line is a Blueprint ("Build_PowerLine_C" in the capture).
- Ends: `GetConnection( int32 index )` -> `UFGCircuitConnectionComponent*` - FGBuildableWire.h:61 (index 0 or 1, else null; field `mConnections[2]` `TWeakObjectPtr` :156, `ReplicatedUsing`). The comment (:151-154) says the connections are weak because buildings can be removed and leave the cables hanging: a wire can have a null end, so null-check and drop such a wire (the mapper drops a line without two usable ends).
- World locations of the ends: `GetConnectionLocation( int32 index )` -> `FVector` - FGBuildableWire.h:65 ("The cached and replicated location of the connection at the end of the wire" :63; field `mConnectionLocations[2]` :160, `Replicated`). For an index outside 0 and 1 it returns `GetActorLocation()`, which is a world position, and the cached locations are used for rendering the replicated wire, so they are world space [the header does not state the frame in words: NEEDS VERIFICATION, one run with a known wire]. Centimetres, /100 and round.
  This works even when an end building is gone (the location is cached), which is why it is better than reading the connection component's owner. Unlike `GetConnection`, it does not need the weak pointer to resolve.
- Do not use `mWireInstances` (:164, `TArray<FWireInstance>`; `FWireInstance::Locations[2]` :22 and `CachedRelativeLocations[2]` :25, `SaveGame`): a wire is drawn as several mesh instances (`CreateWireInstancesBetweenConnections` :104 and on), and the relative locations are in the wire's local frame (name, :25).
- Length: `GetLength()` - FGBuildableWire.h:57 ("The distance between the points the wire connects", field `mCachedLength` :168, centimetres). Not in the contract (the capture's `Length` is dropped); useful as a sanity check against the distance between the two ends.
- id: `GetName()` of the wire (UObjectBaseUtility.h:429); the capture's `ID` is "Build_PowerLine_C_2147223283", the same "class + number" form. Equality with FRM's `ID` is an inference [NEEDS VERIFICATION by the parity run's id join].
- No circuit id is read: the contract has none (`map.ts` PowerLineSchema comment). Not read here; `FGBuildableWire.h:7` includes FGCircuit.h and the connection component has a circuit, so a later contract change would find it there, but that is out of scope.

### 2. Enumeration

- Wires are `AFGBuildable`s, so they are ALL candidates for `AFGBuildableSubsystem::GetAllBuildablesRef()` - FGBuildableSubsystem.h:360 (list `mBuildables` :629, "List of all buildables"; `AddBuildable` :287). That wires are registered in that list is not stated by the header; `AFGBuildableWire` has no subsystem mention in FGBuildableSubsystem.h (grep for "wire", no hit) [NEEDS VERIFICATION, the parity run settles it: the count of `Cast<AFGBuildableWire>` over the list must be about 843 on the captured save; also `GetBuildableCount( AFGBuildableWire::StaticClass() )` :363 gives a cheap advisory].
  The logistics pass (`GameReader.cpp` around :866) walks this same list, so if wires are in it, the power-line reader is one more cast in a pass the mod already does (a shared 10-minute geometry pass, as S3 open question 1 recommended) and needs no second walk.
- There is no public wire list on the circuit subsystem to fall back on that I found; the circuit connection component has `GetWires( TArray<AFGBuildableWire*>& )` - FGCircuitConnectionComponent.h:72, per connection. That is a fallback route (walk the circuits' connection components) and I did not survey the circuit subsystem's connection list; mark as NOT SURVEYED.
- Order: the list order is not stable across restarts; sort by id (as the mapper does) in the native reader so the content hash does not move.
- Cost: one cast and two vector reads per wire; 843 wires is trivial; the 20,000 cap is far above any normal save. Same `FStepBudget` slicing as S3 (StepBudget.h:8, 1 ms).

### 3. Mapper derivations

- `points`: `[[round(L0.X/100), round(L0.Y/100)], [round(L1.X/100), round(L1.Y/100)]]` with `L0 = GetConnectionLocation(0)`, `L1 = GetConnectionLocation(1)`. The mapper's `location0` and `location1` are the capture's two ends (cm); the capture also carries a `location` and a bounding box that are the same points again.
  Two ends that round to the same metre are kept (mapper rule).
- A wire whose end location is zero (never set) would map to (0, 0); the reader drops a wire whose connection pointer is null AND whose cached location is exactly zero [recommendation; whether a live wire can have a zero cached location is a runtime fact].
- Wire order of ends (0 vs 1) has no meaning in the contract, but the hash is order-sensitive for the points; the native reader keeps index order, as the bridge does ("location0, location1"); the parity run should confirm FRM's 0 is the game's 0 [NEEDS VERIFICATION].

## Status fields: `gameReachable`, `lastGameReadAt`, `modVersion`

- `gameReachable` and `lastGameReadAt` are the mod's own state (the agent's last successful read on the game thread and its timestamp); they need no game symbol.
- `modVersion`: the mod ALREADY reads its own plugin version. `SatisDash::AgentVersion()` (`SatisDashCore/Private/Version.cpp`, declared in `SatisDash/Version.h`) returns "mod/" + the .uplugin `VersionName` (currently "0.1.0", SatisDashAgent.uplugin), via
  `IPluginManager::Get().FindPlugin( TEXT("SatisDashAgent") )` -> `IPlugin::GetDescriptor()` -> `FPluginDescriptor::VersionName`. Symbols (all already rows in api-sources.md:234-241): Engine/Source/Runtime/Projects/Public/Interfaces/IPluginManager.h:382 (FindPlugin), :649 (Get), :249 (GetDescriptor), Engine/Source/Runtime/Projects/Public/PluginDescriptor.h:46 (VersionName; the neighbouring comment :41 says "Use the VersionName for that" for user-facing text).
  So `modVersion` needs no new symbol if the contract's string shape is "mod/0.1.0" or the part after the slash. Which of the two the contract wants is not stated in what I was given [question below].
- Alternative, not needed: SML's `UModLoadingLibrary` - SML/ModLoading/ModLoadingLibrary.h:95 (a `UGameInstanceSubsystem`), `GetLoadedModInfo( const FString& Name, FModInfo& Out )` :110, `FModInfo::Version` (`FVersion`, SML/Util/SemVersion.h) :40 with the doc that a mod without SML metadata takes its semantic version from the UE plugin version as the major (:36-38).
  Using it would give a `FVersion` that can differ from `VersionName` for a mod without SML metadata; the plugin descriptor is the one the repo already tests (VersionTest.cpp), so prefer it.

## Field-to-symbol table

mapMarkers (`MapMarkerSchema`, map.ts :240-268):

| Contract field | Native source | Status |
|---|---|---|
| id | `FMapMarker::MarkerGUID` FGMapMarker.h:37 `.ToString()` Guid.h:329; derived-id rule only if `HasValidID()` :71 is false | found; stable id exists; case of hex [NEEDS VERIFICATION] |
| name | `FMapMarker::Name` :43, trim + 60-UTF-16-unit cut | found |
| kind | `FMapMarker::MapMarkerType` :49 == `RT_Stamp` FGActorRepresentation.h:33 | found |
| icon | `FMapMarker::IconID` :52 | found |
| color | `FMapMarker::Color` :55 (`FLinearColor`) -> `ToFColor(bSRGB)` Color.h:381 -> `ToHex()` Color.h:706 -> first 6 digits, lower case | derived; sRGB or not [NEEDS VERIFICATION, parity run] |
| x, y | `FMapMarker::Location` :40, cm /100, rounded | found |
| enumeration | `AFGMapManager::Get` FGMapManager.h:95 + `GetMapMarkers` :118 | found |

droneRoutes (`DronePortSchema`, map.ts :214-225, + `pairedId`):

| Contract field | Native source | Status |
|---|---|---|
| id | buildable `GetName()` | derived, [NEEDS VERIFICATION] equality with FRM's `ID` |
| name | `AFGDroneStationInfo::GetBuildingTag_Implementation` FGDroneStationInfo.h:190 | found; equals FRM's `Name` [NEEDS VERIFICATION] |
| paired | `GetPairedStation()` :201 then its tag | found |
| pairedId | `GetPairedStation()->GetStation()->GetName()` :201, :252 | derived; reachable as an object |
| input / output / fuel | `GetInputInventory/GetOutputInventory/GetFuelInventory` FGBuildableDroneStation.h:145/149/153, stacks via FGInventoryComponent.h:326, :104, :45 | found; input/output direction [NEEDS VERIFICATION], header comments disagree |
| x, y | `GetActorLocation()` Actor.h:2505 (or `GetStationLocation()` FGDroneStationInfo.h:208) | found; source choice [NEEDS VERIFICATION] |
| enumeration | `AFGDroneSubsystem::Get` FGDroneSubsystem.h:68 + `GetAllStations()` :81 | found |

powerLines (`PowerLineSchema`, map.ts :290-296):

| Contract field | Native source | Status |
|---|---|---|
| id | wire `GetName()` | derived, [NEEDS VERIFICATION] equality with FRM's `ID` |
| points[0], points[1] | `AFGBuildableWire::GetConnectionLocation( 0 / 1 )` FGBuildableWire.h:65, cm /100, rounded | found; frame (world) [NEEDS VERIFICATION] |
| enumeration | `GetAllBuildablesRef()` FGBuildableSubsystem.h:360 + `Cast<AFGBuildableWire>` (:33, Abstract :32) | found; wires in the list [NEEDS VERIFICATION] |

Counts R8: found 6 (manager getter, read call, struct fields for id, name, kind, icon, location), derived 1 (color), unverified 3 (hex case, color sRGB step, startup completeness).
Counts R9: found 9 (subsystem list, info class, paired getter, tag, three inventories, stack walk, location), derived 2 (id, pairedId), unverified 4 (id equality, name equals tag, inventory direction, location source).
Counts R10: found 5 (wire class, connections, end locations, length, buildable list), derived 2 (id, points), unverified 4 (id equality, location frame, wires in the list, end order).
Modversion: found (already in use).

## Known output differences (our captures vs what the headers suggest)

- Marker colour: FRM's `ColorSlot` is an 8-digit hex string; the game holds a `FLinearColor`. The conversion path (linear to sRGB or plain) is the one thing a header cannot settle.
- Marker location: the capture has fractional centimetres; the contract rounds to whole metres, so a .5 m case can differ by one metre.
- Drone port pairing: FRM reports the partner's NAME on both ports (`PairedStation` is "None" when unpaired), not its id; the native reader can give the partner's id as `pairedId` and the name as `paired`. Names can repeat, ids cannot.
- Drone inventory naming: the getters' comments and the fields' comments disagree (see R9); the capture agrees with the fields.
- Drone ports in FRM's output include a `PowerInfo`, trip statistics and fuel info that the contract does not carry.
- Power lines: FRM's `ColorSlot` and `Name` are dropped by the contract; the native reader does not read them.
- Order: FRM's list order is its own; the mappers sort by id (then content) before hashing; the native readers must sort the same way.

## Open questions for the plan

1. Marker colour conversion: read `Color.ToFColor(true)` or `ToFColor(false)`? Recommended: implement as a one-line switch, run both on the owner's green marker and the 4 captured ones on the parity run, keep the one equal to `ColorSlot`; do not guess.
2. Marker id case: should the native reader emit the `FGuid` digits upper case, as the capture shows? Recommended: yes, upper-case it explicitly (so the id equals FRM's), since the contract only requires a stable string and the id join is case-sensitive in the dash.
3. Drone port `name`: the building tag (`mBuildingTag`) or the representation text? Recommended: the tag, with the parity run comparing against the 7 captured names; fall back to the representation text only if they differ.
4. Add `pairedId` to `DronePortSchema` as `boundedString.nullable()` and keep `paired` (the name)? Recommended: yes, both; `pairedId` null when unpaired or the partner's buildable is gone. The dash's route inference (PRs 12a/12b) can then stop matching by name.
5. Drone station enumeration: the drone subsystem's info list or the buildable list? Recommended: the subsystem's list (`GetAllStations()`), because it needs no cast over every buildable; the buildable route is the fallback if the list is empty on the dedicated server.
6. Wire enumeration: are wires in `GetAllBuildablesRef()`? Recommended: assume yes, and have the first parity run fail loudly if the cast count differs from the 843 captured by more than a few; the circuit-component route (`GetWires`, FGCircuitConnectionComponent.h:72) is the fallback and needs its own survey.
7. Should the power-line reader share the S3 geometry pass (rails, conveyors, wires: one cursor over `GetAllBuildablesRef()` every 10 minutes)? Recommended: yes, one shared pass; the markers and drone reads are tiny and can run in the factory pass's idle slices.
8. Wire end order and zero-location wires: keep index order and drop wires with a null end? Recommended: yes, count the dropped ones in the read summary (`dropped`) so the evidence shows them.
9. `modVersion` string shape: "mod/0.1.0" (as `AgentVersion()` returns today) or just "0.1.0"? Recommended: whatever the status contract already says for `agentVersion`; reuse `SatisDash::AgentVersion()` and do not add a second reader. I could not see the status contract, so this needs the owner's or implementer's check.
10. Markers cap: the game caps at 250 (FGMapManager.h:299) and the contract at 1,000; keep the contract's cap as is? Recommended: yes, no change.
11. Privacy: marker and port names are player text. Recommended: the readers never log names, evidence carries counts and ids only, and the parity diff compares names inside the harness, not in the committed bundle.

FRM source was not opened.
