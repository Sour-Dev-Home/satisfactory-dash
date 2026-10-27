# FRM HTTP output captures (trimmed), test save Test3

Source: core run 40522552255 (Sour-Dev-Home/satisfactory-dash-mod), ADR-0058 Sprint S4,
captured 2026-10-27 on the test save `Test3`. Each file holds a trimmed subset of the
first full FRM body for one endpoint. Fields and values are exactly as FRM wrote them,
apart from the player-text replacement below.

| File | Records in full body | Records kept |
|---|---|---|
| frm-getGenerators-2026-10-27-test3-trimmed.json | 124 | 5 (one per ClassName) |
| frm-getExtractor-2026-10-27-test3-trimmed.json | 74 | 4 (oil, miner Mk1, Mk2, water) |
| frm-getStorageInv-2026-10-27-test3-trimmed.json | 110 | 5 (one per container class, one non-empty) |
| frm-getTrains-2026-10-27-test3-trimmed.json | 4 | 2 |
| frm-getTrainStation-2026-10-27-test3-trimmed.json | 12 | 5 (non-zero TransferRate) |
| frm-getDroneStation-2026-10-27-test3-trimmed.json | 7 | 2 (one paired, one unpaired) |
| frm-getCables-2026-10-27-test3-trimmed.json | 1498 | 3 |

- getMapMarkers returned 0 records, so it has no file.
- Rate hits over 30 reads: getTrains 0/30, getTrainStation 30/30.
- getTrainStation uses a body from `rateSamples` (`rateSampleAt` in the file), not `first`.
  In it only `TransferRate` is non-zero; `InflowRate` and `OutflowRate` are 0.
- Player-entered text is replaced with stable placeholders, the same across all files:
  train names (Train A..), station names in trains, timetables and stations (Station A..),
  drone port names and `PairedStation` (Port A..). Game class names, ids and the
  game's own display names (e.g. "Coal-Powered Generator") are untouched. "No Station"
  and "None" are FRM sentinels and are kept.
