# FRM train capture and the ADR-0050 phase 3 gate, 2026-10-21

Source: one read-only `GET /getTrainStation`, `GET /getTrains` and `GET /getBelts` on the owner's live save (FRM 1.5.4,
FRM web server on the game PC), approved by the owner on 2026-10-21 (ADR-0050 owner answer 4). The trimmed copies are
`captured-responses/frm-getTrainStation-2026-10-21-trimmed.json` and `frm-getTrains-2026-10-21-trimmed.json`. Geometry,
colours, `features`, `PowerInfo` and `Path` were removed, and each inventory was cut to 3 entries. The belts response
(3.6 MB) was only compared in memory and not saved.

## What the save has

- 2 train stations (`Build_TrainStation_C`). Each has 2 freight platforms (`Build_TrainDockingStation_C`) in
  `CargoInventory`, with per-platform `LoadingMode` (`Loading` / `Unloading`), `LoadingStatus`, `DockingStatus`,
  `Inventory` and `TransferRate` / `InflowRate` / `OutflowRate`.
- 1 train. Its `TimeTable` is an array of `{ StationName }`. It also has `TrainStation`, `Status`, `Docking`, and
  `Vehicles`, each with its own `Inventory`.

## Gate checks (ADR-0050 phase 3)

1. **Platform ids equal belt end ids: pass.** All 4 platform `ID`s appear as `ConnectedTo0` / `ConnectedTo1` values in
   the same moment's `getBelts`. The station building's own `ID` does not (belts attach to platforms, not the station).
2. **Station names resolve uniquely: pass on this save.** There are 2 names for 2 stations. FRM keeps the trailing
   space the player typed, as in `"Silica/Crstal Out "`, so names must be matched exactly or trimmed the same way on
   both sides. Uniqueness is not enforced by the game, so the planner should flag duplicate names instead of guessing.
3. **Still unverified:** what `TransferRate`, `InflowRate` and `OutflowRate` mean (units, live versus rated). Until a
   capture settles it, train edges carry an item and no rate, as ADR-0050 says.
