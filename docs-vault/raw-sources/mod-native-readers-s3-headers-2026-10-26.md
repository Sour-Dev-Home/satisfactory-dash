# Sprint S3 header survey: native readers R5 rails and R6 conveyors (belts, lifts, pipes) (ADR-0058)

Paths relative to Source/FactoryGame/Public unless noted. Pinned (harness/toolchain.json): engine 5.6.1, SML 3.12.0.
Headers: the game's own, shipped with the SML 3.12.0 starter project (Source/FactoryGame/Public);
UE = the engine's Engine/Source/Runtime (engine 5.6.1-CSS), cited as `Engine/...`.
FRM source was not opened. No web search was done. Sources used: the game and SML headers above, UE headers, ADR-0058 (parity rows 9 and 10, the sprint table),
the S2 survey (dash PR #700, format and the enumeration facts it already settled), our contract (`packages/shared/src/map.ts`, identical to the mod repo's `harness/contract/src/map.ts`),
our bridge and adapter code (`FrmRails.cpp`, `railsMapper.ts`, `conveyorsMapper.ts`, `rawSchemas.ts`), the S2 native readers (`GameReader.cpp`, `StepBudget.h`), and our recorded FRM outputs
(frm-getTrainRails-2026-09-27-trimmed.json, frm-getBelts-2026-10-21-connections-trimmed.json, frm-getLifts-2026-10-21-trimmed.json, frm-getPipes-2026-10-21-connections-trimmed.json,
frm-getDroneStation-2026-10-25-unpaired-trimmed.json, frm-endpoint-volumes.md, mod-core-v1/README.md G-B1 and G-B2), used only as a black box (which fields exist, their values).
Every line below cites a header I opened; comments are paraphrased, no bodies. Status: found = declaration read; derived = computed from found declarations;
[NEEDS VERIFICATION] = not in a header I read, or the header gives a declaration but not the behaviour, do not design on it.

## R5 rails (parity row 9)

Contract (`map.ts`): `RailSegmentSchema` = `{ id: string(max 200), points: [x, y][] }`, whole metres, world space, 2 to 1,000 points (`MAP_WORLD_MAX_POLYLINE_POINTS` :49, `PolylineSchema` :61),
at most 5,000 segments (`MAP_WORLD_MAX_ITEMS` :52, `RailsLayerDataSchema` :72), 2 MB per layer (`MAP_WORLD_LAYER_MAX_BYTES` :45).

### 1. Enumeration

- There is no public track list. `AFGRailroadSubsystem` (FGRailroadSubsystem.h:88; `Get(UWorld*)` :117) keeps `mTracks` :592 ("All tracks in the world, valid on server and client (only relevant tracks)")
  and `mTrackGraphs` :596 (`FTrackGraph`, :37, with `Tracks` :49) both under `private:` (:583). Its public track functions are `AddTrack` :225, `RemoveTrack` :228 and the third-rail getters :237, :246. Not usable for a read.
  (The subsystem does expose trains and stations publicly, which is why R3 uses it; S2.)
- Use the buildable subsystem, as R2a does: `AFGBuildableSubsystem` (FGBuildableSubsystem.h:246), `Get(UWorld*)` :272, `GetAllBuildablesRef()` :360 (const ref to all buildables, can be invalidated by add/remove),
  `GetBuildableCount(TSubclassOf<AFGBuildable>)` :363 (cheap advisory count per class), `GetTypedBuildable<T>` :371 (body :840, linear in ALL buildables).
  Rails are `AFGBuildableRailroadTrack : AFGBuildable, IFGSplineBuildableInterface, IFGNetSignificanceInterface` - Buildables/FGBuildableRailroadTrack.h:100 (declared `UCLASS( Abstract )` :99, so the filter is
  `Cast<AFGBuildableRailroadTrack>`, not a `StaticClass()` count of a concrete class; a count via `GetBuildableCount(AFGBuildableRailroadTrack::StaticClass())` :363 should be checked to include subclasses [NEEDS VERIFICATION]).
  No class derives from it in the headers I grepped (no `public AFGBuildableRailroadTrack` elsewhere in Public); the concrete Blueprint is the one named "Build_RailroadTrack_C" in the capture.
- Platform-owned tracks: a train platform holds its own track (`mRailroadTrack` Buildables/FGBuildableTrainPlatform.h:108, `AssignRailroadTrack` :104) and the track knows (`GetIsOwnedByPlatform()` FGBuildableRailroadTrack.h:156, field :321).
  Whether those tracks are in `mBuildables` and whether FRM lists them are not shown by the headers or the capture [NEEDS VERIFICATION]; the contract draws a line per track, so including them is the natural reading.
- Safe on the game thread, in slices: same pattern as `StepFactoryRead` (GameReader.cpp:370-447): a cursor over `GetAllBuildablesRef()` re-fetched per element (never keep the reference across ticks), `Cast`, `IsValid`, stepping under `FStepBudget` (StepBudget.h:8, 1 ms).
  Everything below is a plain getter or a spline evaluation on the game thread; nothing in the headers marks any of it thread-safe, so no worker-thread read.
  For per-track work heavier than a cast (sampling), collect `TWeakObjectPtr` first and read in later slices, as the trains reader does (GameReader.cpp:643-646).

### 2. World-space points and the contract polyline

- Spline component: `AFGBuildableRailroadTrack::GetSplineComponent()` -> `USplineComponent*` - FGBuildableRailroadTrack.h:247 (override of `IFGSplineBuildableInterface::GetSplineComponent` FGSplineBuildableInterface.h:37;
  field `mSplineComponent` :305). The interface comment says it "should only be used after BeginPlay, before BeginPlay use GetSplinePointsData" (:35); a server world being read is played, so the component is populated.
- Raw alternative: `GetSplinePointData()` -> `const TArray<FSplinePointData>&` - FGBuildableRailroadTrack.h:243 (interface :44; field `mSplineData` :310); the interface says the points are in LOCAL space (:40, and the field comment :308),
  so it needs the actor transform (`AActor::GetActorTransform()` Engine/Classes/GameFramework/Actor.h:2499). `FSplinePointData` (Engine/Classes/Components/SplineComponent.h:200) holds `Location`, `ArriveTangent`, `LeaveTangent`.
  These are the CONTROL points (a straight rail has two); FRM's `SplineData` is a finer sampling (below). Control points alone would draw a curve as a straight chord.
- `USplineComponent` (Engine/Classes/Components/SplineComponent.h:284): `GetNumberOfSplinePoints()` :644; `GetLocationAtSplinePoint(int32, ESplineCoordinateSpace::Type)` :660 (`ESplineCoordinateSpace` {Local, World} :35-41);
  `GetSplineLength()` :731; `GetLocationAtDistanceAlongSpline(float, ESplineCoordinateSpace::Type)` :763; `GetLocationAtSplineInputKey(float, ...)` :482; `GetSplineData(ESplineCoordinateSpace::Type)` :964 (returns all points as `FSplinePointData`); `bClosedLoop` :361.
  Inline world helpers: `GetWorldLocationAtSplinePoint` :1134, `GetWorldLocationAtDistanceAlongSpline` :1136 (the Blueprint-deprecated spellings sit at :663 and :766; use the coordinate-space overloads).
  Units: world units are centimetres (S2: Actor.h:2505 position in cm); the contract's `WholeMetreSchema` rounds, the adapter does `Math.round(cm / 100)` (`coordinates.ts`: `toWholeMetres`, bound 1,000,000 m).
- The game's own track sampler: `GetWorldLocationAndDirectionAtDistance(float distance, FVector&, FVector&)` - FGBuildableRailroadTrack.h:171 (and `...AtPosition` :166); `GetLength()` :150 (field `mLength` :328, cm).
  Equivalent to evaluating the spline at a distance, but it is the call the game uses to put trains on rails, so it is the closest to "where the rail really is". Whether it equals the spline component's value [NEEDS VERIFICATION].
- Mapping to the contract (derived): for each track, `n = ceil(GetLength() / step)`, evaluate world location at `i * length / n`, drop z, divide by 100, round, collapse consecutive equal points (what `railsMapper.ts:mapRailSegment` and `FrmRails.cpp` do),
  drop the segment if fewer than 2 points remain, clamp to 1,000 points. A one-metre step keeps a 95 m straight at 96 points; a coarser step cuts bytes but rounds curves into chords. The step is a choice (open question 2), not a header fact.
  - Capture check (frm-getTrainRails-2026-09-27-trimmed.json): `SplineData` x/y/z are world centimetres, the first point equals the item's `location` (-111900, -150400), consecutive points are about 75 cm apart horizontally
    (17 points over a 1,236.9 cm track; 127 points over a 9,500 cm track), `Length` is cm, and the 65 segments run 17 to 127 points. FRM therefore samples about every 75 cm; the contract only needs about every metre.
- Track id: the capture's `ID` is "Build_RailroadTrack_C_2147304732" and "Build_RailroadTrack_C_2147290722", the shape "class name + number" every other FRM id has. Native: `UObject::GetName()` (Engine/Runtime/CoreUObject/Public/UObject/UObjectBaseUtility.h:429, S2).
  That the capture's ID equals `GetName()` is an inference carried over from R2a [NEEDS VERIFICATION by the id-set join in the parity run]. The contract only uses the id as a React key and a diff key (`map.ts` :65-66).
- Order: `GetAllBuildablesRef()` order is the subsystem's, not stable across restarts. The rails mapper does not sort (`railsMapper.ts`), but the backend's content hash (ADR-0038) must not change when nothing changed, so the native reader should sort by id.
- Optional topology, not in the contract: `GetConnection(0/1)` -> `UFGRailroadTrackConnectionComponent` - FGBuildableRailroadTrack.h:187 (fields `mConnections` :317); `GetTrackGraphID()` :194. Skip unless a later layer wants them (the contract comment at `map.ts` :65-67 says it does not).

### 3. Volume and caps

- Measured: 65 segments, 17-127 points each, 278,891 bytes as FRM sends it (frm-endpoint-volumes.md:26, 43). One world, 2026-09-27.
- Projected (derived, an estimate): about 4,400 FRM points at about 75 cm = roughly 3.3 km of track in that save. At a one-metre step that is about 3,400 points, about 14 bytes each as `[x,y],` = about 50 KB, plus about 100 bytes per segment for the id and keys (about 6 KB): well under 0.1 MB.
- Caps fit: 65 of 5,000 segments (77x headroom), longest 127 points of 1,000 (and a one-metre step needs a track longer than 1 km to pass 1,000 points; the longest captured is 95 m; the maximum length the game allows a single track is not in the headers I read [NEEDS VERIFICATION]).
  The 2 MB byte cap would bind at roughly 140,000 points (about 140 km of track at one metre). A coarse chord limit is cheap insurance: clamp points per segment, never reject the layer.
- Cost: one track costs about one spline evaluation per point; 3,400 evaluations for the captured world. Measured cost is for the harness [NEEDS VERIFICATION]; the 10-minute cadence (ADR row 9) leaves the budget wide.

## R6 conveyors (parity row 10)

Contract (`map.ts` :144-164): `ConveyorEdgeSchema` = `{ id, kind: belt|lift|pipe, from, fromKind, to, toKind, capacityPerMinute, tier, at {x,y} }`; `from` is end 0, `to` is end 1; an open end is `null` and its kind is `null` exactly when the id is;
node kinds `machine, splitter, merger, storage, station, extractor, consumer, junction, conveyor, other` (:113-124); id strings 1-128 characters; `capacityPerMinute` null when not trusted; `tier` 1-64 characters; at most 50,000 edges (`CONVEYORS_MAX_EDGES` :107), in practice the 2 MB cap (about 7,400 edges at about 270 bytes each, :103-106).

### 1. Enumeration

- All three kinds are in the same `mBuildables` list as machines (same subsystem as R2a: FGBuildableSubsystem.h:360, :371, :629). The subsystem also holds conveyors in tick groups (`mConveyorTickGroup` :653, `FConveyorTickGroup::Conveyors` :98, private) and a pipe subsystem holds `mNetworks`
  (FGPipeSubsystem.h:187, private); neither is a public list. The subsystem's comment on `mFactoryBuildings` :639 says it excludes "conveyors and splitter/mergers" (private), which confirms conveyors are only reachable through `mBuildables`.
- Belts: `AFGBuildableConveyorBelt : AFGBuildableConveyorBase, IFGSplineBuildableInterface, IFGNetSignificanceInterface` - Buildables/FGBuildableConveyorBelt.h:22.
- Lifts: `AFGBuildableConveyorLift : AFGBuildableConveyorBase` - Buildables/FGBuildableConveyorLift.h:72 (no spline interface).
- Common base `AFGBuildableConveyorBase : AFGBuildable, IFGSignificanceInterface` - Buildables/FGBuildableConveyorBase.h:97. One cast to the base gives belts and lifts; the subclass tells belt from lift.
- Pipes: `AFGBuildablePipeBase : AFGBuildable, ...` - Buildables/FGBuildablePipeBase.h:22; `AFGBuildablePipeline : AFGBuildablePipeBase, IFGFluidIntegrantInterface` - Buildables/FGBuildablePipeline.h:32.
  Do NOT cast to `AFGBuildablePipeBase`: `AFGBuildablePipeHyper : AFGBuildablePipeBase, IFGPipeHyperInterface` (FGBuildablePipeHyper.h:16) is also one, and hypertubes carry no fluid. Cast to `AFGBuildablePipeline`.
  (The capture lists `Build_Pipeline_C` ids only; whether FRM's getPipes also lists hypertubes is not shown and the pipe capture has none [NEEDS VERIFICATION].)
- Counts (advisory, as `GameReader.cpp:BeginFactoryRead` does): `GetBuildableCount(AFGBuildableConveyorBelt::StaticClass())` etc. FGBuildableSubsystem.h:363. Captured world (2026-10-21): 1,987 belts + 257 lifts + 156 pipes = 2,400 edges.
- Slicing: one cursor pass collecting weak pointers to belts, lifts and pipelines, then per-edge reads in later slices. A single `Cast` chain per buildable (base, then Pipeline) keeps the scan close to R2a's cost; the scan is linear in all buildables
  (S2 open question 6). Sharing one pass with R5 is possible because both run at 10 minutes (ADR rows 9 and 10); R2a runs at 30 s and keeps its own cursor.
- Not lightweight: walls and foundations can be lightweight (no actor; FGBuildableConveyorAttachment.h:169-173 has a "Lightweight class containing no components" for splitter attachments used for "abstract instances etc.", and FGLightweightBuildableSubsystem.h exists),
  but belts, lifts, pipelines and rails are spline actors with components, so `GetName()` exists for them [NEEDS VERIFICATION that no conveyor-class lightweight variant is in play for saves].

### 2. Connections and end ids

- Belts and lifts: `GetConnection0()` / `GetConnection1()` -> `UFGFactoryConnectionComponent*` - FGBuildableConveyorBase.h:163-164 (fields :380, :383). The field comment says "mConnection0 is the input, mConnection1 is the output" (:378).
  That matches the contract (`from` = end 0, items enter at end 0) and the capture ("miners appear only as ConnectedTo0; generators, sink, central storage only as ConnectedTo1").
- Pipes: `AFGBuildablePipeBase::GetConnection0()` / `GetConnection1()` -> `UFGPipeConnectionComponentBase*` - FGBuildablePipeBase.h:68-69 (fields :160, :166); `AFGBuildablePipeline::GetPipeConnection0()` / `GetPipeConnection1()` -> `UFGPipeConnectionComponent*` - FGBuildablePipeline.h:109, :112
  (field `mPipeConnections` :221). Pipes are not oriented by flow (capture notes; the contract comment above `ConveyorEdgeSchema`, `map.ts` :144, says so).
- What the far end of a belt or lift end is: `UFGFactoryConnectionComponent::GetConnection()` -> the connected component or null - FGFactoryConnectionComponent.h:96 (field `mConnectedComponent` :244); `IsConnected()` :111 (lightweight flag `mHasConnectedComponent` :248;
  the comment says always false for a hologram, snap-only or bad index). Its building: `GetOuterBuildable()` -> `AFGBuildable*` - FGFactoryConnectionComponent.h:180 (field :260, "Buildable owning us, cached").
  Chain: `belt->GetConnection1()->GetConnection()->GetOuterBuildable()->GetName()` is the `to` id; null at any step is an open end (`ConnectedTo` is "" in the capture exactly when `Connected` is false, 1987 of 1987 belts).
  A connection that is set but whose outer buildable is null has no capture counterpart; recommend treating it as an open end plus a counter [NEEDS VERIFICATION whether it can happen].
- Conveyor poles are snap-only (`FCD_SNAP_ONLY` FGFactoryConnectionComponent.h:33, comment "Special case for conveyor poles"); a snap-only component is never "connected" (:108), so a belt resting on a pole does not become an end.
- For a pipe end: `UFGPipeConnectionComponentBase::GetConnection()` - FGPipeConnectionComponent.h:69 (null if the pointer is invalid), `IsConnected()` :94 (field `mConnectedComponent` :164); `UFGPipeConnectionComponentBase : UFGConnectionComponent` :38,
  and `UFGConnectionComponent : USceneComponent, IFGSaveInterface` (FGConnectionComponent.h:15). The pipe component has no `GetOuterBuildable`; the owner is the generic `UActorComponent::GetOwner()` (Engine/Classes/Components/ActorComponent.h:491), an `AActor*` that for a pipe junction, pump,
  tank or machine is the building and for a joined pipeline is the `AFGBuildablePipeline`. `mCachedPipelineOwner` FGPipeConnectionComponent.h:321 shows the owner can be a pipeline. Hence `pipe->GetConnection0()->GetConnection()->GetOwner()->GetName()`.
  Pipe network id: `GetPipeNetworkID()` :199 (not in the contract).
- Pipe end kind by type: `UFGPipeConnectionComponent::GetFluidIntegrant()` :209 and `EPipeConnectionType` {PCT_ANY, PCT_CONSUMER, PCT_PRODUCER, PCT_SNAP_ONLY} :21-27 (`GetPipeConnectionType()` :123) are about the connection, not the building kind; they are not needed.
- Kinds. The adapter types an end by REGEX over the class part of the end id (`conveyorsMapper.ts:classifyConveyorEnd`). Native has both the id and the object, so there are two ways:
  (a) the same prefix table in C++ over `GetClass()->GetName()` (byte-for-byte what the adapter does today, testable in `SatisDashCore`); (b) `Cast` to game classes. The classes behind each kind, for cross-checking a table (a) against reality:
  | contract kind | game class (header:line) |
  |---|---|
  | splitter | `AFGBuildableAttachmentSplitter` FGBuildableAttachmentSplitter.h:14; `AFGBuildableSplitterSmart` FGBuildableSplitterSmart.h:64 (all `: AFGBuildableConveyorAttachment` FGBuildableConveyorAttachment.h:108) |
  | merger | `AFGBuildableAttachmentMerger` FGBuildableAttachmentMerger.h:14; `AFGBuildableMergerPriority` FGBuildableMergerPriority.h:14 |
  | conveyor | `AFGBuildableConveyorBase` :97, `AFGBuildablePipeline` :32 |
  | junction | `AFGBuildablePipelineJunction` FGBuildablePipelineJunction.h:14, `AFGBuildablePipelinePump` FGBuildablePipelinePump.h:36 (both `: AFGBuildablePipelineAttachment` FGBuildablePipelineAttachment.h:15) |
  | storage | `AFGBuildableStorage` FGBuildableStorage.h:13 (incl. `AFGCentralStorageContainer` FGCentralStorageContainer.h:15); `AFGBuildablePipeReservoir` FGBuildablePipeReservoir.h:43 |
  | station | `AFGBuildableDroneStation` FGBuildableDroneStation.h:37; `AFGBuildableTrainPlatformCargo` FGBuildableTrainPlatformCargo.h:18 (the freight platform; "Build_TrainDockingStation_C" in the capture); `AFGBuildableDockingStation` FGBuildableDockingStation.h:63 (truck) |
  | extractor | `AFGBuildableResourceExtractorBase` FGBuildableResourceExtractorBase.h:65 (miners, pumps, `AFGBuildableWaterPump` FGBuildableWaterPump.h:13, fracking activators FGBuildableFrackingActivator.h:15) |
  | consumer | `AFGBuildableGenerator` FGBuildableGenerator.h:60; `AFGBuildableResourceSink` FGBuildableResourceSink.h:14; `AFGBuildableSpaceElevator` FGBuildableSpaceElevator.h:51 |
  | machine | `AFGBuildableManufacturer` FGBuildableManufacturer.h:85 (S2) |
  | other | everything else (never drops an edge) |
  Recommendation: use (a) so native output equals the adapter's for any class name FRM and the game share, and use (b) only in a test that checks the table against the casts on the test save.
  Differences are expected where the regex is looser or tighter than the class tree (for example an extractor built from a Blueprint whose name does not start with Miner/WaterPump/OilPump/Frack); the parity run will list them.
- `at` (end 0 position, whole metres): the connector's world location. Factory connection: `GetConnectorLocation(bool withClearance = false)` - FGFactoryConnectionComponent.h:141; pipe or any scene component: `GetComponentLocation()` - Engine/Classes/Components/SceneComponent.h:1031.
  Capture: belt `location0` is a spline start (x -55554.98, y -128606.36), lift `location0`/`location1` differ only in z by the lift's `Length` (400); a lift's top is `GetTopTransform()` FGBuildableConveyorLift.h:158 (field :268, height `GetHeight()` :132), its base the actor.
  Whether the connector location, the actor location or spline point 0 gives the capture's `location0` to within a metre is [NEEDS VERIFICATION]; the contract needs only whole metres but a value near x.5 can round differently and flip the content hash between sources.

### 3. Capacity and tier

- Belt and lift speed: `AFGBuildableConveyorBase::GetSpeed()` - Buildables/FGBuildableConveyorBase.h:160 (field `mSpeed` :369, comment "Speed of this conveyor", `EditDefaultsOnly`). The header gives NO unit and no items-per-minute call (I grepped the Public tree for per-minute accessors; the only
  conveyor hits are `AFGBuildableConveyorMonitor::CalculateItemsPerMinute` FGBuildableConveyorMonitor.h:93, a measured throughput, not a tier rating).
  Derivation, unconfirmed: item spacing is `ITEM_SPACING = 120.0f` ("from origo to origo", FGBuildableConveyorBase.h:327), so if `mSpeed` is cm/s then items per minute = `mSpeed * 60 / 120` = `mSpeed / 2`; the captured 60/120/270/480 would mean `mSpeed` 120/240/540/960.
  [NEEDS VERIFICATION: read GetSpeed() for the four belt tiers and the four lift tiers on the test server; if `GetSpeed() / 2` equals 60/120/270/480 for all eight, adopt it, otherwise use a table keyed by class]. The capture says belts and lifts share the four values (507/435/465/580 belts; 57/28/118/54 lifts).
- Pipe flow limit: `AFGBuildablePipeline::GetFlowLimit()` - Buildables/FGBuildablePipeline.h:136, comment "maximum flow of the pipe [m^3/s]" (field `mFlowLimit` :182, "Maximum flow through this pipe in cubic meters. [m^3/s]"). This matches G-B2 (FRM `Speed` is m3/s, Mk.1 5, Mk.2 10) and the adapter's `Speed * 60`.
  So the native capacity per minute is `GetFlowLimit() * 60` (derived; 300 and 600 m3/min if the values 5 and 10 hold natively [NEEDS VERIFICATION]). The contract keeps pipe capacity null until G-B2 is trusted (`map.ts` :141); native can send the value, the adapter decides.
  Related: `GetMaxContent()` :128 (m3), inner radius `mRadius` :178 (cm), neither needed.
- Tier name: `AFGBuildable::mDisplayName` - Buildables/FGBuildable.h:824 (`FText`, "The human readable display name of this object", `EditDefaultsOnly`, in the `public:` section opened at :813). Captured names: "Conveyor Belt Mk.1", "Conveyor Lift Mk.3", "Pipeline Mk.1".
  `mDisplayName.ToString()` is the candidate for `tier` (max 64 characters). This also supplies the display-name accessor that S2 open question 10 could not find. Whether it equals FRM's `Name` exactly (case, localisation) [NEEDS VERIFICATION];
  there is also `SetBuildableDisplayName(TSubclassOf<AFGBuildable>, FText)` FGBuildable.h:467, which shows the field can be overridden per class.

### 4. Do conveyor end ids equal the factory reader's machine ids?

- By construction, yes for every end that is a building the factory reader lists: R2a emits `Machine->GetName()` (GameReader.cpp:402); the conveyor end is `GetOuterBuildable()->GetName()` (belts, lifts) or `GetOwner()->GetName()` (pipes) on the same actor.
  Both are `UObject::GetName()` (UObjectBaseUtility.h:429) of one object, so they cannot differ if they are the same actor.
- The capture agrees on the form and the join: 332 of the 340 getFactory building ids appear as a conveyor end in the same "Build_<Class>_C_<number>" form (frm-getBelts-2026-10-21-connections-trimmed.json, "Join with getFactory"). The 8 absent are buildings with no belt, lift or pipe.
- Ends that R2a does not list (splitters, mergers, storage, miners, generators, stations, the sink, the space elevator; the capture says they are known only as ids on conveyor ends) still get `GetName()` ids; R6 is the only layer that names them, so nothing to join against.
- Open: that FRM's id equals `GetName()` is the same inference as R2a [NEEDS VERIFICATION by the parity run's id-set join]. Rebuilt belts get new ids (G-B1, mod-core-v1/README.md:65); native `GetName()` of a replaced actor is expected to change the same way ("Respline" creates a new belt,
  FGBuildableConveyorBelt.h:103) [NEEDS VERIFICATION].

### 5. Drone ports (ADR-0055 PR 12a question)

- A drone port is `AFGBuildableDroneStation : AFGBuildableFactory, IFGActorRepresentationInterface` - FGBuildableDroneStation.h:37; it is a factory building, so a belt end attached to it resolves through the same chain as any building
  (`...->GetConnection()->GetOuterBuildable()` is the station actor; `AFGBuildableFactory::GetConnectionComponents()` Buildables/FGBuildableFactory.h:78 lists its connections).
- Id: `GetName()` of that actor. The FRM drone-station capture's ID is "Build_DroneStation_C_2146572476" (frm-getDroneStation-2026-10-25-unpaired-trimmed.json), the same "class + number" form as machines and belt ends. The port's player-typed label ("FUEL 1" in the capture) is a different value:
  the port's `mBuildingTag` lives on the info object (`AFGDroneStationInfo`; factorygame-drone-truck-classes-2026-10-25.md E1, `GetInfo()` FGBuildableDroneStation.h:157), not on the id.
  So if the dash's drone-station data uses `GetName()` for its id, the belt end id and the drone-station id are the same string (derived); the PR 12a reader must use `GetName()` and not the tag or the info object's name [NEEDS VERIFICATION once a drone reader exists and by a captured belt on a port: none of our belt captures has a drone port end].
- Input or output: the belt side is settled by the belt, not the port: a belt's end 1 is its output (FGBuildableConveyorBase.h:378), so a port named as `to` is receiving items from the belt (they go to the port's input inventory, which the header describes as "Inventory where we transfer items from when loading a drone", FGBuildableDroneStation.h:315-317),
  and a port named as `from` is delivering items it unloaded ("Inventory where we transfer items to when unloading from a drone", :319-321) onto the belt.
  The port's own component direction is `UFGFactoryConnectionComponent::GetDirection()` -> `EFactoryConnectionDirection` {FCD_INPUT, FCD_OUTPUT, FCD_ANY, FCD_SNAP_ONLY} - FGFactoryConnectionComponent.h:122, :28-34 (field `mDirection` :236, set in the Blueprint).
  The header cannot say how many connectors a port has or which are input and which output; the station's `mStorageInputConnections` (FGBuildableDroneStation.h:328, private, "connections that can pull data to our storage") hints at several inputs [NEEDS VERIFICATION: list the port's `GetConnectionComponents()` with their directions on the test server].
  No contract field carries the component, only the port id; the contract needs nothing more than the edge direction.
- `kind` of a port end: `station` (the adapter's regex already matches `Build_DroneStation`).

## Mapping tables (contract, both layers)

rails (`RailSegmentSchema`, map.ts :68-72):

| Contract field | Native source | Status |
|---|---|---|
| id | `GetName()` of the track (UObjectBaseUtility.h:429); capture shape "Build_RailroadTrack_C_<n>" | derived, [NEEDS VERIFICATION] equality with FRM's ID |
| points | track `GetSplineComponent()` FGBuildableRailroadTrack.h:247, `GetLocationAtDistanceAlongSpline(d, World)` SplineComponent.h:763, x and y over 100, rounded, consecutive duplicates collapsed, at least 2, at most 1,000 | derived (step is a choice) |
| enumeration | `GetAllBuildablesRef()` FGBuildableSubsystem.h:360 + `Cast<AFGBuildableRailroadTrack>` | found; platform-owned tracks [NEEDS VERIFICATION] |

conveyors (`ConveyorEdgeSchema`, map.ts :144-164):

| Contract field | Native source | Status |
|---|---|---|
| id | `GetName()` of the belt, lift or pipeline | derived, [NEEDS VERIFICATION] equality with FRM's ID |
| kind | belt `AFGBuildableConveyorBelt` :22, lift `AFGBuildableConveyorLift` :72, pipe `AFGBuildablePipeline` :32 | found |
| from, to | `GetConnection0/1()` FGBuildableConveyorBase.h:163-164 (pipes FGBuildablePipeBase.h:68-69) -> `GetConnection()` FGFactoryConnectionComponent.h:96 (pipes FGPipeConnectionComponent.h:69) -> `GetOuterBuildable()` :180 (pipes `GetOwner()` ActorComponent.h:491) -> `GetName()`; null when unconnected | found/derived |
| fromKind, toKind | class-name prefix table (as `conveyorsMapper.ts`) or `Cast` (table above); null exactly when the id is | derived |
| capacityPerMinute | belts/lifts: `GetSpeed()` FGBuildableConveyorBase.h:160 mapped to 60/120/270/480; pipes: `GetFlowLimit() * 60` FGBuildablePipeline.h:136 | belt/lift unit [NEEDS VERIFICATION]; pipe derived |
| tier | `mDisplayName.ToString()` FGBuildable.h:824 | found, string equality [NEEDS VERIFICATION] |
| at | end 0 connector location, `GetConnectorLocation()` FGFactoryConnectionComponent.h:141 or `GetComponentLocation()` SceneComponent.h:1031, over 100, rounded | derived, [NEEDS VERIFICATION] which source matches |

Counts R5: found 6 (enumeration, spline component, point data, length, sampler, connections), derived 3 (id, points, order), unverified 5 (id equality, platform tracks, abstract-class count, sampler equals spline, single-track maximum length).
Counts R6: found 14 (belt, lift, pipeline classes, connection getters, owner chain, flow limit, display name, spacing constant, drone station class, connection direction, node kind classes), derived 6 (ids, kinds, `at`, pipe capacity, drone id, drone direction), unverified 7 (belt unit, id equality, `at` source, tier string, hypertube in getPipes, drone connectors, rebuilt ids).

## Known output differences (our captures vs what the headers suggest)

- Rails sampling: FRM about every 75 cm (127 points on a 95 m track) vs the contract's whole-metre dedupe; the native step is ours. The contract already collapses consecutive equal metres, so parity is on the metre grid, not on the point count.
- Rails z: FRM sends x, y, z in centimetres; the contract drops z.
- Rails platform tracks: the headers show tracks owned by platforms (FGBuildableRailroadTrack.h:156); the capture does not say whether FRM lists them.
- Belts: FRM `ItemsPerMinute` is a per-tier constant (60/120/270/480); the header has `mSpeed` with no unit. Parity needs the mapping to be checked on all eight tiers.
- Pipes: FRM `Speed` is m3/s (5 and 10); the adapter multiplies by 60; native `GetFlowLimit()` is documented m3/s (FGBuildablePipeline.h:136). Pipe capacity stays null in the contract until the adapter decides.
- Open ends: FRM `ConnectedTo` is "" when `Connected` is false; native null at any step of the chain. Equal in the capture's 1987 of 1987 belts by FRM's own rule; native must be checked on the same save (the counts 20 false/true, 14 true/false, 9 false/false for belts).
- End kinds: the adapter classifies from the class part of the id with a regex; a native class-name table is byte-equal, a `Cast` table can differ for classes whose name does not match the regex.
- Pipe vs hypertube: a `AFGBuildablePipeBase` filter would add hypertubes that FRM's getPipes may not list; the `AFGBuildablePipeline` filter is the safe one.
- Tier name: FRM's `Name` ("Conveyor Belt Mk.1") vs `mDisplayName`; same source in the editor, string equality unchecked.
- `at`: FRM `location0` has decimals (x -55554.9777...) that suggest a spline or connector point; the native source may differ by sub-metre amounts.
- Ids after rebuild (G-B1): FRM gives a rebuilt belt a new ID; native expected the same (a new actor).
- Order: FRM lists in its own order; the adapter sorts conveyors by id before hashing (`conveyorsMapper.ts` `byId`); the rails mapper does not sort and the native reader should.

## Open questions for the plan

1. Is it acceptable that rail and conveyor reads share one cursor pass over `GetAllBuildablesRef()` every 10 minutes (separate from R2a's 30-second pass), with the same 1 ms step budget? Recommended: yes, one shared geometry-and-graph pass, because the scan cost is linear in all buildables and the two layers share the cadence.
2. What sampling step for rails (and the clamp)? Recommended: 1 m by distance along the spline, collapse consecutive equal whole-metre points, clamp to 1,000 points per segment by raising the step for a segment that would exceed it; no Douglas-Peucker in the mod (the backend can still simplify).
3. Do we include platform-owned tracks (`GetIsOwnedByPlatform()` FGBuildableRailroadTrack.h:156)? Recommended: yes, they are tracks on the map; compare the native count with the 65 captured segments on the same save and record any gap.
4. Where is the end kind decided: C++ class-name table in `SatisDashCore` (the adapter's regex ported, with tests against the adapter's own test vectors) or `Cast` in the game module? Recommended: the class-name table, with a harness check that it agrees with the casts on the test save.
5. How is belt and lift capacity derived: `GetSpeed() / 2` from the header's `ITEM_SPACING` 120, or a class-keyed table of 60/120/270/480? Recommended: read the eight speeds on the test server first; if `GetSpeed() / 2` matches all eight, use it (it follows future tiers), else the table.
6. Do pipes carry a capacity (`GetFlowLimit() * 60`) from the native reader? Recommended: yes, send it; the contract allows it (`map.ts` :141) and the adapter still decides when to trust it; check Mk.1 5 and Mk.2 10 on the test save (G-B2 had no Mk.2 in the world capture).
7. `tier` from `mDisplayName.ToString()`: accept if it equals FRM's `Name` on all captured tiers? Recommended: yes; if it differs, prefer the game's string and record the difference (the contract treats `tier` as a display string).
8. `at` source: connector location of end 0 or the actor/spline point? Recommended: the end-0 connector location (it is where the edge is anchored), and make the parity tolerance one metre for `at`, not byte equality.
9. Drone ports: should the dash's PR 12a drone-station id be the building's `GetName()`? Recommended: yes, and capture one belt attached to a port on the owner's drone test save to confirm the belt end id equals the drone-station reader's id; the belt orientation (to = port receives, from = port delivers) needs no extra field.
10. Hypertubes and other pipe-like buildables: should a hypertube appear in the conveyors layer? Recommended: no (the kind enum has no tube), filter on `AFGBuildablePipeline` only, and count hypertubes as ignored in the parity evidence.
11. Is a connection whose outer buildable is null (set but unowned) an open end? Recommended: yes, plus a counter in the read summary, so it shows in the parity evidence if it ever occurs.
12. Rails sorted by id before sending, to keep the content hash stable (the FRM-fed mapper does not sort)? Recommended: yes, sort in the native reader and note that ordering differs from the bridge's; the backend hash is order-sensitive.
