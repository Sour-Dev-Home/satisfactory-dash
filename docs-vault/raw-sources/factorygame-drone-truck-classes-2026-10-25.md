# FactoryGame: drone and truck classes and properties (2026-10-25)

Source: the FactoryGame C++ headers shipped in the SML 3.12.0 modding project (game build 513885), under
`Source/FactoryGame/Public/`. Read for ADR-0055 PRs 12a/12b (drone and truck route inference). Paths below are relative
to that folder, with the header line of each declaration. Names only; no header text is copied beyond member names
and short quoted comments.

### E1 — Drone port and its info object

- `AFGBuildableDroneStation : AFGBuildableFactory` (`Buildables/FGBuildableDroneStation.h:37`). FRM class `Build_DroneStation_C`.
  - `mInfo` (`AFGDroneStationInfo*`, :331), the port's info object; `mStationDrone` (`AFGDroneVehicle*`, :293);
    `mDockedDrone` (:297); `mDroneDockingQueue` (`TArray<AFGDroneVehicle*>`, :241).
- `AFGDroneStationInfo : AInfo` (`FGDroneStationInfo.h:159`).
  - `mPairedStation` (`AFGDroneStationInfo*`, :404, SaveGame and Replicated): the port this one is paired with. FRM's
    `PairedStation` field.
  - `mConnectedStations` (`TArray<AFGDroneStationInfo*>`, :408); `mBuildingTag` (`FString`, :411), the port's name;
    `mDroneStatus` (`EDroneStatus`, :414); `mLatestDroneTrips` (`TArray<FDroneTripInformation>`, :429);
    `mDroneTripStatistics` (:433).

### E2 — Drones and trips

- `AFGDroneVehicle : AFGVehicle` (`FGDroneVehicle.h:121`).
  - `mHomeStation` (:429), `mDockedStation` (:426), `mCurrentDestinationStation` (:432), all `AFGBuildableDroneStation*`,
    SaveGame; `mCurrentTripInformation` (`FDroneTripInformation`, :417).
- `FDroneTripInformation` (`FGDroneVehicle.h:50`): `TripDuration` (float, :56; its comment says the time to go to the other
  station and back), `IncomingItemCount` (:60), `OutgoingItemCount` (:64), `IncomingItemStacks` (:68), `OutgoingItemStacks` (:72).
- `AFGDroneSubsystem : AFGSubsystem` (`FGDroneSubsystem.h:61`): `mStations` (:142), `mDrones` (:146), `mStationNames` (:154).
- `AFGDroneTransport : AFGDroneVehicle` (`FGDroneTransport.h:13`) is an empty legacy subclass.
- Drone route: a port's `mPairedStation`, named by `mBuildingTag`. A drone flies between `mHomeStation` and
  `mCurrentDestinationStation`.

### E3 — Truck station

- `AFGBuildableDockingStation : AFGBuildableFactory` (`Buildables/FGBuildableDockingStation.h:63`). FRM class `Build_TruckStation_C`.
  - `mStationIdentifier` (`AFGDockingStationIdentifier*`, :351); `mDockingPathNode` (`AFGVehiclePathNode*`, :355);
    `mDockedActor` (:319); `mIsInLoadMode` (:327); `mVehicleTracking` (:387).
- `AFGDockingStationIdentifier : AInfo` (`WheeledVehicles/FGDockingStationIdentifier.h:27`): `mStation` (:111),
  `mStationName` (`FText`, :118), `mPathNodeGUID` (`FGuid`, :124, SaveGame and Replicated), `mBuildingTag` (`FString`, :130).

### E4 — Trucks, routes and paths (1.0 autopilot)

- `AFGWheeledVehicle : AFGVehicle` (`WheeledVehicles/FGWheeledVehicle.h:23`). FRM class `BP_Tractor_C` in the capture.
  - `mVehicleIdentifier` (:417), `mAutopilotComponent` (:319), `mCurrentlyDockingStation` (:421),
    `mCurrentVehiclePathSegment` (:425), `mVehiclePathPreset` (:363).
- `AFGWheeledVehicleIdentifier : AInfo` (`WheeledVehicles/FGWheeledVehicleIdentifier.h:32`).
  - `mVehicleRoute` (`TArray<FGuid>`, :182, comment: "Vehicle route that the vehicle will follow"); FRM's `Route[].PathNodeGUID`.
  - `mVehicleName` (`FText`, :175), `mIsAutopilotEnabled` (:178), `mCurrentFromPathNodeGuid` (:186),
    `mCurrentToPathNodeGuid` (:189), `mCurrentAutopilotErrorStatus` (:198), `mCurrentTargetWaypointIndex` (:202),
    `mIsCurrentlyDocking` (:206).
- `AFGVehiclePathNode : AFGBuildable` (`WheeledVehicles/FGVehiclePathNode.h:22`): `mPathNodeGUID` (:111),
  `mPathNetworkID` (:115), `mArrivingConnections` / `mLeavingConnections` (:119/:123).
- `AFGVehiclePathSegment : AFGBuildable` (`WheeledVehicles/FGVehiclePathSegment.h:161`): `mStartNode` / `mEndNode` (:420/:424),
  `mSplinePoints` (:412), `mVehicles` (:443). FRM class `Build_VehiclePath_Tractor_C` in the capture.
- `AFGVehicleSubsystem : AFGSubsystem` (`WheeledVehicles/FGVehicleSubsystem.h:276`): `mAllDockingStations` (:420),
  `mAllVehicles` (:423), `mPathNodeByIDLookup` (`TMap<FGuid, AFGVehiclePathNode*>`, :448),
  `mDockingStationByIDLookup` (`TMap<FGuid, AFGDockingStationIdentifier*>`, :452).
- Truck route, inferred from names and comments (no header states it): each `mVehicleRoute` GUID is a path node's
  `mPathNodeGUID`, and a station's identifier carries its own path node's GUID. FRM 1.5.4 does not expose the station
  side of that link (see `captured-responses/frm-getTruckStation-2026-10-25-trimmed.json`).

### E5 — Legacy recorded paths (pre-1.0 saves)

- `AFGWheeledVehicle::mTargetList` (`AFGDrivingTargetList*`, :404), `mTargetNodeLinkedList` (:400) and
  `mIsLegacyAutopilotEnabled` (:408) are marked deprecated, kept for legacy saves.
- `AFGDrivingTargetList : AInfo` (`WheeledVehicles/FGTargetPointLinkedList.h:24`; `mFirst` :46, `mLast` :50).
- `AFGTargetPoint : AActor` (`WheeledVehicles/FGTargetPoint.h:12`; `mNext` :28, `mWaitTime` :32, `mTargetSpeed` :36). Its
  `ShouldSave_Implementation` returns false (:23).
