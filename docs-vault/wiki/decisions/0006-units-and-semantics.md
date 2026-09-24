# ADR-0006: Units and semantics are normalized by the backend and documented in the schema

Status: accepted, 2026-09-22

## Context

Several fields in packages/shared/src/index.ts had undocumented units, ranges or
signs. FRM's docs often omit units (frm-getPower.md:15-23). Live captures against a populated
tier-6 save on 2026-09-22, compared with the in-game UI (captures + in-game observations), settled
most of them.

## Decision

The backend normalizes; the frontend never rescales. Every schema field gets
.describe() with its unit/range, or [NEEDS VERIFICATION]. Unit suffixes go into field names only
where the unit is verified and ambiguous without it (the power fields). Field-by-field inventory
of index.ts (the target name follows the arrow):

| Field (index.ts) | Unit / range / sign / null | Source |
|---|---|---|
| status.healthy -> tickHealth | "healthy" \| "slow"; healthy = tick rate above 10/s | dedicated-server-api.md:310 |
| status.isGameRunning | true = a save is loaded | dedicated-server-api.md:386 |
| status.isPaused -> gamePaused | game sim paused (e.g. auto-pause with 0 players); not building.isPaused | :388; captures 00-paused / 01-running |
| status.sessionName | save's session name; value when no game is running [NEEDS VERIFICATION] | :380 |
| status.connectedPlayers | integer >= 0 | :381 |
| status.playerLimit | integer | :382 |
| status.tickRate | ticks per second, server average | :389 |
| status.totalGameDurationSeconds | seconds, cumulative save play time (NOT time since load, contrary to doc :387); across a restart [NEEDS VERIFICATION] | capture 00-paused (96589 s right after load) |
| production.name / className | item display name / class | frm-getFactory.md:31-32 |
| production.currentPerMinute | per minute, averaged; items/min for solids, m3/min for fluids; no per-item solid/fluid source yet | frm-getFactory.md:34; captures F-panel + observations |
| production.maxPerMinute | per minute, already includes clock speed; Somersloop effect [NEEDS VERIFICATION] | :35; capture 01-running (Stator 5 @100%, 8 @160%) |
| production.percent | 0-100; can exceed 100 by float noise, so no max constraint | :36; capture 01-running |
| building.id | opaque string, unique within a response; stable across restarts [NEEDS VERIFICATION], so don't persist it yet | frm-getFactory.md:20 |
| building.recipe | string, or null <=> no recipe configured (FRM sends "Unassigned"; B2) | :28, :57; capture CJ |
| building.isProducing | instantaneous flag; can be false at 40% average, so the UI shows percent, not this | :58; capture 01-running |
| building.isPaused | machine paused by a player (standby) [NEEDS VERIFICATION: standby toggle] | :59 |
| building.isBackedUp | backend-derived: any output slot at MaxAmount AND !isPaused AND recipe != null. FRM lists only non-empty slots, and fluid slots do appear (refinery Fuel 3.2/50), so fluid-output machines are covered; blocked-refinery case [NEEDS VERIFICATION] | frm-getFactory.md:49-53; captures 01-running, CJ |
| building.production | [] when unconfigured | B2 |
| power.circuitGroupId | circuit GROUP id (AssociatedCircuits lists member circuits); buildings' CircuitID differs (B3) | frm-getPower.md:14, :26; captures CJ, H |
| power.powerProduction -> productionMW | MW; 0 when fuse tripped | :15; captures F-panel + observations, CJ |
| power.powerConsumed -> consumptionMW | MW, excludes battery charging; 0 when tripped | :16; captures F-panel, H, CJ |
| power.powerCapacity -> capacityMW | MW; 0 when tripped | :17; captures F-panel, CJ |
| (new) maxConsumptionMW | MW; > capacityMW means the grid could overload | :18; capture F-panel (4606.5 > 4083.3) |
| power.fuseTriggered | true = fuse tripped | :27; capture CJ |
| (new) batteryCapacityMWh | MWh, 0 = no batteries | :23; capture H (arithmetic check) |
| power.batteryPercent | 0-100; reads 0 with no batteries (use capacity to tell apart) | :22; captures H, 00-paused |
| power.batteryDifferential -> batteryDifferentialMW | MW, positive = charging | :21; capture H |
| power.status | backend classification (see power.ts .describe) | services/powerService.ts:53-84 |

The 0-100 battery range is now verified, which resolves the [NEEDS VERIFICATION] on
AT_RISK_BATTERY_PERCENT (services/powerService.ts:13-17).
A production `unit: "items/min" | "m3/min"` field is added only once a per-item solid/fluid source
is found (MaxAmount doesn't distinguish them: Motor and Smart Plating slots also have 50). Until
then the frontend must not guess. The source is now found (the game's own item data, ADR-0015),
which also settles Polymer Resin: it is solid, so items/min.

## Consequences

The contract doubles as the unit reference. The renames are breaking, but with no
consumer yet they land in one step in PR 2b (ADR-0007).

## Revisit when

Any [NEEDS VERIFICATION] above is resolved. Update the describe text, and add the
unit field when a source exists.
