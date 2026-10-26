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
