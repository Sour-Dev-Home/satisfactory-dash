# Machine states (ADR-0027 PR 2)

How the backend derives a machine's `state` (`backend/src/modules/telemetry/services/classifyBuilding.ts`),
and how much evidence stands behind each rule. Decision: [ADR-0027](./decisions/0027-history-and-alerts.md)
(decision 2 and its 2026-09-24 amendment: per snapshot, no window).

## The rules, in order

1. **paused**: `IsPaused`.
2. **unpowered**: `CircuitGroupID` is -1 (not connected), or the building's `PowerInfo.FuseTriggered` is
   true (the whole circuit is dead). The fuse flag is read from the building itself, not from a
   `getPower` lookup: the 2026-09-22 CJ capture shows it true for a building on the tripped grid, so no
   second upstream call or circuit join is needed and the classifier stays a pure function of one building
   (architect-accepted deviation from the ADR's "building, circuit" signature).
3. **idle**: no recipe (FRM reports an unconfigured machine as recipe "Unassigned"; the adapter maps it to null).
4. **backedUp**: the existing overflow signal (`isBackedUp`: an output slot is at capacity).
5. **starved**: powered, configured, not backed up, and the best averaged output percent is below
   `STARVED_BELOW_PERCENT`. `missingInput` is the ingredient with the lowest `ConsPercent`.
6. **producing**: otherwise.

`isProducing` is never used (it is instantaneous and noisy); FRM's `ProdPercent` is already an average, which
is why one snapshot is enough. No state is returned, never a guess, when the data needed is missing: no fuse
information for a connected machine, or no finite output percent.

## The provisional values, and their evidence

| Constant | Value | Evidence |
|---|---|---|
| `STARVED_BELOW_PERCENT` | 5 | Two trimmed getFactory snapshots (2026-09-22, 10 buildings). Running machines read 100, 100, 24.7 and 9.4 percent; every 0 percent machine in them is backed up or unpowered; **no captured machine was truly starved**. 5 sits below the lowest running machine (9.4) so a slow but working machine is not flagged. |

Known limits, so nobody over-trusts it:

- `state` and the existing `isBackedUp` / `backedUpCount` are different questions. `isBackedUp` is "an
  output slot is full" (and the machine is neither paused nor unconfigured); `state` puts paused and unpowered
  first. A backed-up machine that is unpowered has `isBackedUp` true and state `unpowered`, and one whose fuse
  information is missing has `isBackedUp` true and no state. So `stateCounts.backedUp` can be lower than
  `backedUpCount`: do not mix the two numbers in one total. A negative percent counts as starved; NaN and
  Infinity give no state.
- The capture script writes the file once at the end (Ctrl+C saves nothing, up to 2 hours of samples lost)
  and refuses to overwrite a file that appeared meanwhile.

- The machine at 9.4 percent has full input buffers and an output buffer 98 of 100 full: it is throttled by its
  output, not starved of input. A percent-only rule cannot tell that from starvation once the percent is low
  enough; the threshold is what keeps it out. Input-buffer data (FRM's `InputInventory`) could sharpen the
  rule; it is not read today.
- Nothing here is time-based. "Held for N minutes" and hysteresis belong to the alert engine (ADR-0027 PR 5).
- The golden file `telemetry/services/__golden__/machineStates.golden.json` pins the outcome for the 10
  captured buildings; a rule or threshold change shows up there as a reviewed diff.

## Tuning it

`npm run capture-factory -w backend -- --minutes 15 --interval 30` (dev only, game up, owner's go-ahead) polls
getFactory and getPower and writes one trimmed, timestamped series under
`docs-vault/raw-sources/captured-responses/`. The trimming keeps only what a state replay needs and never
writes the host, port or token. Replay that series through the classifier, adjust the constant with the new
evidence, and update this table.
