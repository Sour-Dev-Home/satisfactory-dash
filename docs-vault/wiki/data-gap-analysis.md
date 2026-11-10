# Data gap analysis

Tracks which player-facing metrics the SatisDashAgent mod sends, and which it does not yet send. Since ADR-0066 the mod is
the only data source: the backend never calls the game's HTTPS API or FicsitRemoteMonitoring (FRM), and a server reaches
the dashboard only through `/agent/v1`. A **gap** here means "the mod does not yet send it"; closing one is a mod change
(CLAUDE.md ground rule 4), not a new API call in the backend.

The source for every row is the mod's native reader, as inventoried in ADR-0058 Decision 1 (rows 1-10) and shipped in mod
**0.2.0** (ADR-0058 "Done", 2026-11-06: no FRM code, settings or traffic; SML `^3.12.0` its one dependency). The game-side
facts behind each reader are in `mod-claims.md` and the `raw-sources/` files ADR-0058 cites; the per-reader evidence (parity,
tick cost, soak) is in ADR-0058. The FRM and vanilla API pages (`frm-api.md`, `vanilla-dedicated-server-api.md`) are kept
as historical reference and as the parity record.

## What the mod sends

| Metric | Mod reader (ADR-0058 Decision 1 row) | Contract | Status |
|---|---|---|---|
| Server health, running, paused, session, players and limit, tick rate | Status (row 1) | `status.ts` | **Sent.** Proven in S6 (ADR-0058 row 1). |
| Auto-pause setting, and the `set_auto_pause` command | Server options (row 2) | `agent.ts` settings | **Sent.** Proven (ADR-0058 row 2). |
| Power: production, consumption, capacity, max consumption, batteries, fuse | Power circuits (row 3) | `power.ts` | **Sent** (R0). Whether `productionMW` is the circuit's total produced or base production on the native path is [NEEDS VERIFICATION]; see the historical note below. |
| Production rate per building, machine states, clock speed, inventory fullness | Factory machines (row 4, R2a and R2b) | `factory.ts` | **Sent.** Derived values (`state`, backed-up thresholds) stay in the backend (ADR-0058 Decision 1). |
| Overflow (output backed up) | Factory machines (row 4): inventory slot fullness | `factory.ts` | **Sent, indirectly**, as before: no direct "belt full" fact; the backend derives it from slot fullness. Fluid overflow (a blocked refinery) is still an open item. |
| Who is connected | Players (row 5): name and online only (ADR-0029) | `players.ts` | **Sent.** |
| Map: live trains and stations; planner train routes | Trains (rows 6 and 7) | `map.ts` | **Sent.** |
| Map: resource nodes; planner extractors | Resource nodes (row 8) | `map.ts` | **Sent.** |
| Map: rails | Rails (row 9) | `map.ts` | **Sent.** |
| Planner and bottleneck finder: belts, lifts, pipes | Conveyors (row 10) | `map.ts` | **Sent.** |

## Gaps (the mod does not yet send it)

| Gap | Notes |
|---|---|
| Any Linux dedicated server | Mod 0.2.0 is a Windows server build only; the Linux build is mod #86. A Linux or unmodded host has no path to the dashboard until then (ADR-0066). |
| Storage contents, drone routes, truck routes | Planned layers (ADR-0055 PRs 11-12), not parity; ADR-0058 Decision 7 assigns them to the mod. The header facts are in `raw-sources/factorygame-drone-truck-classes-2026-10-25.md`; whether and how the mod reads them is [NEEDS VERIFICATION] until a reader passes its gate. |
| Fluid overflow (blocked refinery) | Open since the 2026-09-21 spike; no source names a native fact for it yet [NEEDS VERIFICATION]. |
| A per-item solid/fluid source for labelling units | Open since the 2026-09-21 spike [NEEDS VERIFICATION]. |

## Historical: the FRM path's power production (#620, before ADR-0066)

Owner decision (2026-10-24, option A): the dash's circuit "production" (`productionMW`) is the TOTAL produced, as the
in-game power graph shows "Produced". On the FRM path it was derived as `max(PowerProduction, PowerConsumed)` per circuit
group, in `packages/game-adapter` (removed by ADR-0066 PR 7). Nothing reads FRM now; the evidence below is kept because the
owner's decision (total, not base) still holds for whatever the mod sends.

Evidence (none of it is in `raw-sources/` yet, so all of it is [NEEDS VERIFICATION]):

- FRM 1.5.4 `Power.cpp:47`: `PowerProduction = mBaseProduction`, the generators' base output only. [NEEDS VERIFICATION]
  `raw-sources/frm-getPower.md` only says "Power production of the circuit."
- SML 3.12.0 `FGPowerCircuit.h:426-433` and `:104` (`PowerProduced`): the circuit's total produced, which FRM does not
  forward. [NEEDS VERIFICATION]
- Test-server observation from the mod session (2026-10-23): a demand-following grid read 0 MW base production with 4 MW
  consumed, while the game showed 4 MW produced. The owner's grid read 3,633 base with 1,314 used (base above draw, so
  the total equals base). [NEEDS VERIFICATION: no capture file]

Battery caveat [NEEDS VERIFICATION]: with batteries, discharge may be counted as production in the game's figure.

Before ADR-0066, the 2026-09-21 Phase 2 spike (game 1.2.4.0, CL 502094, SML 3.12.0, FRM 1.5.3) found every stated metric
covered by the vanilla API or FRM; that table is in this file's git history and in `frm-api.md` and
`vanilla-dedicated-server-api.md`.
