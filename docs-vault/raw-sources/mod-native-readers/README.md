# mod-native-readers

Evidence for ADR-0058's native readers, Sprint S1: R0, the rest of power; R1, players; and R4, resource nodes. Each
reader is read from the game itself instead of FicsitRemoteMonitoring (FRM). There is one folder per passing run,
named `<run>-<run start, UTC>`.

Source: the harness and the mod in `Sour-Dev-Home/satisfactory-dash-mod`, Sprint S1 (PRs #53 and #54), then the two
switch PRs (#55 and #56) that made R1 and R4 native by default. Pinned to the merge commit of PR #56, the last one:
https://github.com/Sour-Dev-Home/satisfactory-dash-mod/commit/b97f781

Method: the harness's `core-run <run>` and `test-mod`, dispatched on the self-hosted runner and approved by the owner
each time. Each run builds and installs the mod, starts the test server, applies the run's pass condition
(`runs/<run>/pass.ts` in the mod repository) and writes the bundle. Only each run's `result.json` is copied here, as
written. The full bundles stay as CI artifacts, linked by run id below. They hold FRM's samples, the per-reader verdicts
(`readers.json`) and the memory and outbound captures.

Clean room: FRM was used only as a black box over HTTP, as the oracle the native readers are compared against. Its
source was not opened (`docs/clean-room.md` in the mod repository; each reader has a `PROVENANCE.md` there). The
headers the readers use are surveyed in `../mod-native-readers-s1-headers-2026-10-25.md`.

## Where they ran

On the **separate test install** of the dedicated server on the owner's PC, never the owner's live server: Net CL
513885 (`Net CL: 513885` in `versionLines`), SML 3.12.0, engine 5.6.1-CSS. The world was the staged test save. The
backend was the throwaway satisfactory-dash stack from the `main` images. Player names never appear in the evidence:
the harness hashes them.

## The runs

| Run | Run id | Started (UTC) | Verdict | What it proves |
| --- | --- | --- | --- | --- |
| native-parity | [40244496806](https://github.com/Sour-Dev-Home/satisfactory-dash-mod/actions/runs/40244496806) | 2026-10-25T23:25:50Z | pass | 30 minutes with the native readers on, compared with FRM's endpoints read beside them. R0: 351 rounds within 3% of FRM's neighbouring reads, every compared field matching. R1: 351 rounds with the (hash, online) lists equal to FRM's. R4: the posted layer is valid against the contract and equal to FRM's (608 nodes, 31 exploited) |
| native-parity | [40253178598](https://github.com/Sour-Dev-Home/satisfactory-dash-mod/actions/runs/40253178598) | 2026-10-26T01:14:09Z | pass | The same, repeated: 357 rounds for R0 and R1, and R4 equal to FRM's (608 nodes, 31 exploited). The scan covered 68,822 actors in 35 steps, with the longest step 0.26 ms and 4.53 ms in all on the game thread |
| tick-cost-native | [40262414493](https://github.com/Sour-Dev-Home/satisfactory-dash-mod/actions/runs/40262414493) | 2026-10-26T03:07:34Z | pass | With the native readers on: no tick-rate cost (median 29.85 without the mod, 29.83 with it). Memory ended 9.8 MB above the baseline (limit 100 MB) and grew -0.4 MB over the last 5 minutes (limit 25 MB). S12: the mod contacts only the backend, FRM's loopback port and the game's own address lookup. The readers were live in the window (120 snapshots with players, 1 resource-node post) |
| mod-test | [40266765910](https://github.com/Sour-Dev-Home/satisfactory-dash-mod/actions/runs/40266765910) | 2026-10-26T03:59:42Z | pass | All 149 in-game C++ automation tests, 0 failed, on `0108ce3`, the branch with both defaults switched to native |

## What the test world did not exercise

The judge reports these as NOT EXERCISED and does not fail on them (owner, 2026-10-25):

- **R0:** a tripped fuse (`fuseTriggered` was never true).
- **R0:** a merged circuit group, where a power switch joins circuits. The test world has one circuit group (`mergedGroupsMax` 1 in both parity bundles). FRM's output for a merged group was captured on the live server in `../captured-responses/frm-getPower-2026-09-22-H-battery-charging.json` (`AssociatedCircuits` [0,3]), and the mod's grouping is unit-tested (`GameValuesTest.cpp`: circuits in one group give one row, and the lowest id wins). No native run on the server has read a merged group yet.
- **R1:** any online player. Nobody was connected, so every listed player was offline.

## Decisions taken during the sprint

- **The players crash (2026-10-25).** The first `native-parity` run (40241942772) crashed the dedicated server on the first native players read, inside `AFGGameState::GetOfflineCachedPlayerInfosInSession`. The reader now reads the save's player cache (`GetAllPlayerInfoData`) and drops each player whose id matches a connected one (mod PR #54, `1b806ec`).
- **The tick-cost judge (owner, 2026-10-26).** The first two `tick-cost-native` runs (40247280125 and 40256047941) failed on two things the FRM bridge brought in since Plan 3A, which the bridge-mode tick-cost run had not yet measured.
  - S12 now allows exactly FRM's loopback endpoint.
  - The memory leak is judged on each window's last 5 minutes, with the baseline's growth floored at 0. Both boots took the same one-time step, and the baseline then freed about 62 MB inside its window.
  - The limits are unchanged (mod PR #54, `dde57de`).

## Notes

- **mod-test's report isn't kept here,** as in `../mod-core-v1/`: Unreal's `index.json` names the runner machine. The
  run link is the evidence.
- **Three failed runs are left out:** the crash run (40241942772) and the first two `tick-cost-native` runs
  (40247280125, 40256047941). They are linked above as the reason for each decision.

## Sprint S2: factory, rates, trains and the train routes layer

Evidence for ADR-0058's Sprint S2: R2a, the factory machines; R2b, the production rates; and R3, trains and stations,
with the `trainRoutes` layer built from them. Same folder layout, method and clean room as S1 above.

Source: the mod's Sprint S2 PRs #58 (S2-A) and #59 (S2-B), merged on the mod's `main`, and PR #60, the
switch that makes the factory and trains native by default (open when this was written). The parity run is pinned to
https://github.com/Sour-Dev-Home/satisfactory-dash-mod/commit/6e3330d

The headers the S2 readers use are surveyed in the S2 header survey (dash PR #700).

### The S2 runs

| Run | Run id | Started (UTC) | Verdict | What it proves |
| --- | --- | --- | --- | --- |
| native-parity | [40403583987](https://github.com/Sour-Dev-Home/satisfactory-dash-mod/actions/runs/40403583987) | 2026-10-26T21:36:07Z | pass | Mod commit `6e3330d`, world `Test2` (a copy of the owner's test save), 30 minutes with the native readers on against FRM's endpoints. R0: 356 rounds within 3%. R1: 356 rounds, lists equal. R4: the posted layer equal to FRM's (608 nodes, 55 exploited). R2a factory: machine ids and static fields equal in 60 rounds, and the dynamic flags matched in 99.44% of 33,660 machine-rounds (the owner's 99% rule). R2b rates: 0 of 12,840 item-class checks outside FRM's range, and 100.0% of 33,660 building-rounds within 5%. R3 trains and stations: 60 rounds, ids, name hashes and status equal, positions within FRM's own reads. R3 trainRoutes: 2 posted layers valid against the contract and equal to FRM's (16 records) |
| tick-cost-native | [40396146628](https://github.com/Sour-Dev-Home/satisfactory-dash-mod/actions/runs/40396146628) | 2026-10-26T20:42:11Z | pass | With the native readers on: no tick-rate cost (median 29.89 without the mod, 29.87 with it). Longest game-thread step: Factory read 1 ms, Trains read 0.1 ms, node scan 0.34 ms, so the 2 ms step ceiling held. Run at `ebe03f2`; the mod code is identical at `6e3330d`, which changed the judge only |

### What the test world did not exercise (S2)

The judge reports these as NOT EXERCISED and does not fail on them:

- **R0:** a battery (`batteryCapacityMWh`, `batteryPercent`, `batteryDifferentialMW`), a tripped fuse and a merged circuit group.
- **R1:** any online player.
- **R3:** a parked train, and a stationary train. Every train moved, so the 1 m check that would expose a position-source
  bias (the last vehicle, or a stale position) never ran.

### Decisions taken during the sprint (S2)

- **Two parity failures, both fixed (2026-10-26).** The first S2 `native-parity` run (40378567334) failed R2b rates, because
  the Somersloop production boost was not applied to products, and R3 `trainRoutes`, because empty platforms were left out.
  Both were fixed in the mod (`ebe03f2`).
- **The item-class rule (owner, 2026-10-26).** A second run (40388387353) missed 2 of 12,840 rate item-class checks. The
  owner ruled that the item-class rule holds for 99% of class-checks, like the factory flags' 1% allowance (mod `6e3330d`).
  The passing run above is at 100.00% against that 99%.

### Notes (S2)

- **Two failed runs are left out:** 40378567334 and 40388387353. They are linked above as the reason for each decision;
  their `result.json` files are not copied.

## Sprint S3: rails and conveyors

Evidence for ADR-0058's Sprint S3: R5, the rail tracks (`getTrainRails` was the last FRM read the mod made), and R6, the
conveyors layer (belts, lifts and pipes as a graph; the bridge never sent it). Same folder layout, method and clean room as
S1 above.

Source: the mod's Sprint S3 PRs #61 (S3-A), #63 (S3-B), #64 (S3-C) and #65 (S3-D), and PR #66, the switch that makes rails
and conveyors native by default, all merged on the mod's `main` (`d94db1e`). With the switch every reader is native by
default, and a host on the defaults needs FRM for nothing. The parity run is pinned to
https://github.com/Sour-Dev-Home/satisfactory-dash-mod/commit/f02e1ee

The headers the S3 readers use are surveyed in the S3 header survey (dash PR #715).

### The S3 runs

| Run | Run id | Started (UTC) | Verdict | What it proves |
| --- | --- | --- | --- | --- |
| native-parity | [40447299909](https://github.com/Sour-Dev-Home/satisfactory-dash-mod/actions/runs/40447299909) | 2026-10-27T04:01:12Z | pass | Mod commit `f02e1ee`, world `Test3` (a copy of the owner's larger test save), 30 minutes with every native reader on against FRM's endpoints. All ten readers pass. R0: 355 rounds within 3%. R1: 355 rounds, lists equal. R4: the posted layer equal to FRM's (608 nodes, 55 exploited). R2a factory: 59 rounds, dynamic flags matched in 99.46% of 33,099 machine-rounds. R2b rates: 2 of 12,626 item-class checks outside FRM's range (99.98%, the rule is 99%). R3 trains and stations: 59 rounds, equal, positions within FRM's own reads. R3 trainRoutes: 2 posted layers equal to FRM's apart from reported cargo (16 records). R5 rails: 320 tracks, ids equal, farthest point 1.08 m mod to FRM (a track end, under the end rule below) and 0.54 m FRM to mod. R6 conveyors: 4,877 edges, ids, kind, ends, end kinds, tier and capacity equal, `at` within 1 m; 149 open ends agreed with FRM |
| tick-cost-native | [40442596123](https://github.com/Sour-Dev-Home/satisfactory-dash-mod/actions/runs/40442596123) | 2026-10-27T03:23:58Z | pass | With every native reader on, on `Test3`: no tick-rate cost (median 29.87 without the mod, 29.82 with it); working set 7.3 MB above the baseline at the end (limit 100). Longest game-thread step: Logistics read (rails and conveyors) 1.01 ms, Factory read 1 ms, Trains read 0.12 ms, node scan 0.35 ms, so the 2 ms step ceiling held. Run at `6f92ee0`; `f02e1ee` changed the judges and the train-routes mapping of a Parked train only (no new game read) |
| s3-census | [40437494703](https://github.com/Sour-Dev-Home/satisfactory-dash-mod/actions/runs/40437494703) | 2026-10-27T02:17:24Z | pass | What the capacity and end-kind rules rest on, measured on `Test3` (13,236 buildables): belt and lift capacity is speed / 2 for Mk.1-Mk.4 (Mk.5 is present, 144 belts and 5 lifts, and was judged by the parity run's capacity equality); pipe capacity is the flow limit x 60 for Mk.1 (300) and Mk.2 (600); 6 of 9,593 ends differ from the kind table, all `Build_Valve_C` (reported); drone ports: 12 edges end at one, 1 starts at one |

### What the test world did not exercise (S3)

The judge reports these as NOT EXERCISED and does not fail on them:

- **R0:** a battery, a tripped fuse and a merged circuit group (as in S1 and S2).
- **R1:** any online player.
- **R5:** a track over 999 m (the point clamp), and a track the contract cannot hold.
- **R6:** a hypertube filtered by FRM.

`Test3` does exercise the S2 gaps: it has a Parked train and a stationary train.

### Decisions taken during the sprint (S3)

- **The rules (owner, 2026-10-27).** Rails: the same track ids, and every point of each track within 1 m of the other side's
  line, measured against FRM's unrounded values. Conveyors: the exact graph, with `at` within 1 m. An open end both sides
  agree on passes; one they disagree on fails.
- **One parity failure, fixed (2026-10-27).** The first S3 `native-parity` run (40439238142, at `6f92ee0`) failed two readers:
  - **rails:** one track end was 1.08 m from FRM's line, because FRM's line stops short of the track's end (its last segment
    was about 0.75 m). The owner ruled that a track's two end points pass within 1 m plus FRM's own end segment; the mod caps
    that extra at 1 m, so a two-point track cannot wave through a far-off end (mod `d29c66c`, `f02e1ee`).
  - **trainRoutes:** FRM lists a Parked train with no stops, and one station's cargo drifted between reads. The owner ruled
    that cargo-only differences are reported and never fail (`68be831`), and the mod now sends no stops for a Parked train,
    as FRM does (`35f4be7`).

### Notes (S3)

- **Two failed runs are left out:** 40439238142 (linked above as the reason for both rulings) and 40433998294, a census
  dispatched outside the backend wrapper, which stopped before the game started because the backend's host file was missing. Their
  `result.json` files are not copied.
